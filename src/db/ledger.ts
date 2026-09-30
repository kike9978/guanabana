import { balanceEffects } from '../lib/ledger'
import { todayIso } from '../lib/dates'
import { roundMoney } from '../lib/money'
import { complete, newRecord, notifyChange, openDb, settle, type StoreName } from './db'
import type { Account, BucketMove, CreditCard, Item, Loan, LoanInstallment, Place, PlanItem, Transaction, TransactionLine } from './types'

const LEDGER_STORES: StoreName[] = [
  'transactions',
  'accounts',
  'credit_cards',
  'loans',
  'loan_installments',
  'bucket_moves',
  'transaction_lines',
  'items',
  'places',
  'plan_items',
]

export class LedgerBlockedError extends Error {}

/** The full set of lines for the transaction being put, plus any items and places they introduce. */
export interface LineWrite {
  lines: TransactionLine[]
  items: Item[]
  places: Place[]
}

interface LedgerChange {
  remove?: Transaction
  put?: Transaction
  putMany?: Transaction[]
  installments?: LoanInstallment[]
  loan?: Loan
  dropLoan?: { loanId: string; installmentIds: string[] }
  bucketMoves?: BucketMove[]
  lines?: LineWrite
  planItems?: PlanItem[]
}

/** Replaces a transaction's lines, and drops items left with no line so price history keeps no ghost rows. */
async function writeLines(tx: IDBTransaction, change: LedgerChange): Promise<void> {
  const replacing = change.remove && (!change.put || change.lines)
  if (!replacing && !change.lines) return
  const lineStore = tx.objectStore('transaction_lines')
  const existing = await getAllIn<TransactionLine>(lineStore)
  const dropped = replacing ? existing.filter((line) => line.transaction_id === change.remove!.uuid) : []
  for (const line of dropped) lineStore.delete(line.uuid)
  for (const place of change.lines?.places ?? []) tx.objectStore('places').put(place)
  for (const item of change.lines?.items ?? []) tx.objectStore('items').put(item)
  for (const line of change.lines?.lines ?? []) lineStore.put(line)

  const droppedIds = new Set(dropped.map((line) => line.uuid))
  const inUse = new Set([...existing.filter((line) => !droppedIds.has(line.uuid)), ...(change.lines?.lines ?? [])].map((line) => line.item_id))
  for (const itemId of new Set(dropped.map((line) => line.item_id))) {
    if (!inUse.has(itemId)) tx.objectStore('items').delete(itemId)
  }
}

async function reverseLinkedMoves(tx: IDBTransaction, record: Transaction): Promise<void> {
  const store = tx.objectStore('bucket_moves')
  const moves = await getAllIn<BucketMove>(store)
  const date = todayIso()
  for (const move of moves.filter((m) => m.tx_id === record.uuid)) {
    store.put(
      newRecord<BucketMove>({
        bucket_id: move.bucket_id,
        amount: -move.amount,
        reason: record.type === 'transfer' ? 'Se eliminó la transferencia' : 'Se eliminó el movimiento',
        source: move.source,
        date,
        income_tx_id: null,
        reverses_id: move.uuid,
      }),
    )
  }
}

function getAllIn<T>(store: IDBObjectStore): Promise<T[]> {
  return settle(store.getAll()) as Promise<T[]>
}

async function restoreSchedule(tx: IDBTransaction, extra: Transaction, now: string): Promise<void> {
  const store = tx.objectStore('loan_installments')
  const rows = await getAllIn<LoanInstallment>(store)
  const created = new Set(rows.filter((row) => row.created_by === extra.uuid).map((row) => row.uuid))
  if (created.size === 0 && !rows.some((row) => row.replaced_by === extra.uuid)) return

  const transactions = await getAllIn<Transaction>(tx.objectStore('transactions'))
  if (transactions.some((record) => record.loan_installment_id && created.has(record.loan_installment_id))) {
    throw new LedgerBlockedError('Installments created by this extra payment are already paid')
  }
  for (const uuid of created) store.delete(uuid)
  for (const row of rows.filter((row) => row.replaced_by === extra.uuid)) {
    store.put({ ...row, status: 'scheduled', replaced_by: null, updated_at: now })
  }
}

function netEffects(change: LedgerChange): Map<string, { store: 'accounts' | 'credit_cards'; uuid: string; delta: number }> {
  const net = new Map<string, { store: 'accounts' | 'credit_cards'; uuid: string; delta: number }>()
  const add = (record: Transaction, direction: 1 | -1) => {
    for (const effect of balanceEffects(record)) {
      const key = `${effect.store}:${effect.uuid}`
      const current = net.get(key) ?? { store: effect.store, uuid: effect.uuid, delta: 0 }
      net.set(key, { ...current, delta: current.delta + direction * effect.delta })
    }
  }
  if (change.remove) add(change.remove, -1)
  if (change.put) add(change.put, 1)
  for (const record of change.putMany ?? []) add(record, 1)
  return net
}

async function applyLedger(change: LedgerChange): Promise<void> {
  const effects = netEffects(change)
  const db = await openDb()
  const tx = db.transaction(LEDGER_STORES, 'readwrite')
  const done = complete(tx)
  const now = new Date().toISOString()

  try {
    for (const effect of effects.values()) {
      const delta = roundMoney(effect.delta)
      if (delta === 0) continue
      const store = tx.objectStore(effect.store)
      const current = (await settle(store.get(effect.uuid))) as Account | CreditCard | undefined
      if (!current) throw new Error(`Missing ${effect.store} ${effect.uuid}`)
      store.put({ ...current, current_balance: roundMoney(current.current_balance + delta), updated_at: now })
    }

    const transactions = tx.objectStore('transactions')
    if (change.remove && !change.put && change.remove.loan_extra_id) await restoreSchedule(tx, change.remove, now)
    if (change.remove && !change.put) await reverseLinkedMoves(tx, change.remove)
    if (change.remove && change.remove.uuid !== change.put?.uuid) transactions.delete(change.remove.uuid)
    if (change.put) transactions.put(change.put)
    for (const record of change.putMany ?? []) transactions.put(record)
    if (change.loan) tx.objectStore('loans').put(change.loan)
    for (const row of change.installments ?? []) tx.objectStore('loan_installments').put(row)
    if (change.dropLoan) {
      tx.objectStore('loans').delete(change.dropLoan.loanId)
      for (const uuid of change.dropLoan.installmentIds) tx.objectStore('loan_installments').delete(uuid)
    }
    for (const move of change.bucketMoves ?? []) tx.objectStore('bucket_moves').put(move)
    for (const item of change.planItems ?? []) tx.objectStore('plan_items').put(item)
    await writeLines(tx, change)
  } catch (error) {
    tx.abort()
    await done.catch(() => undefined)
    throw error
  }

  await done
  for (const store of LEDGER_STORES) notifyChange(store)
}

type DraftFields = Pick<Transaction, 'type' | 'amount' | 'date'> & Partial<Omit<Transaction, 'uuid' | 'updated_at'>>

export function draftTransaction(fields: DraftFields): Transaction {
  return newRecord<Transaction>({
    currency: 'MXN',
    account_id: null,
    to_account_id: null,
    cc_id: null,
    category_id: null,
    place_id: null,
    payment_method: null,
    notes: '',
    source: 'manual',
    ...fields,
  })
}

export function recordTransaction(record: Transaction): Promise<void> {
  return applyLedger({ put: record })
}

/** Several movements and their balance changes, in one write. */
export function recordTransactions(records: Transaction[]): Promise<void> {
  return applyLedger({ putMany: records })
}

export function updateTransaction(previous: Transaction, next: Transaction, lines?: LineWrite): Promise<void> {
  return applyLedger({ remove: previous, put: { ...next, uuid: previous.uuid, updated_at: new Date().toISOString() }, lines })
}

/** With `buildLines`, the transaction's lines are replaced in the same write. Without it, lines stay as they are. */
export async function saveTransaction(
  editing: Transaction | undefined,
  fields: DraftFields,
  buildLines?: (transactionId: string) => LineWrite,
): Promise<string> {
  if (editing) {
    await updateTransaction(editing, { ...editing, ...fields }, buildLines?.(editing.uuid))
    return editing.uuid
  }
  const record = draftTransaction(fields)
  await applyLedger({ put: record, lines: buildLines?.(record.uuid) })
  return record.uuid
}

export function deleteTransaction(record: Transaction): Promise<void> {
  return applyLedger({ remove: record })
}

export function recordWithInstallments(record: Transaction, installments: LoanInstallment[]): Promise<void> {
  return applyLedger({ put: record, installments })
}

/** A new loan and its schedule; for lent money, also the expense that hands it over. */
export function recordLoan(loan: Loan, installments: LoanInstallment[], disbursement?: Transaction): Promise<void> {
  return applyLedger({ loan, installments, put: disbursement })
}

/** Deletes a loan and its schedule. With `disbursement`, that expense goes too and its balance comes back. */
export function removeLoan(loan: Loan, installmentIds: string[], disbursement?: Transaction): Promise<void> {
  return applyLedger({ dropLoan: { loanId: loan.uuid, installmentIds }, remove: disbursement })
}

export function recordWithBucketMoves(record: Transaction, bucketMoves: BucketMove[]): Promise<void> {
  return applyLedger({ put: record, bucketMoves })
}

/** A wish bought: its expense, any transfers out of Ahorro apartados, the draws, and the wish's link, in one write. */
export function recordPlanPurchase(records: Transaction[], bucketMoves: BucketMove[], item: PlanItem): Promise<void> {
  return applyLedger({ putMany: records, bucketMoves, planItems: [item] })
}
