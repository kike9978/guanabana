import { balanceEffects } from '../lib/ledger'
import { roundMoney } from '../lib/money'
import { complete, newRecord, notifyChange, openDb, settle, type StoreName } from './db'
import type { Account, BucketMove, CreditCard, LoanInstallment, Transaction } from './types'

const LEDGER_STORES: StoreName[] = ['transactions', 'accounts', 'credit_cards', 'loan_installments', 'bucket_moves']

export class LedgerBlockedError extends Error {}

interface LedgerChange {
  remove?: Transaction
  put?: Transaction
  installments?: LoanInstallment[]
  bucketMoves?: BucketMove[]
}

async function removeLinkedMoves(tx: IDBTransaction, record: Transaction): Promise<void> {
  const store = tx.objectStore('bucket_moves')
  const moves = await getAllIn<BucketMove>(store)
  for (const move of moves.filter((m) => m.tx_id === record.uuid)) store.delete(move.uuid)
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
    if (change.remove && !change.put) await removeLinkedMoves(tx, change.remove)
    if (change.remove && change.remove.uuid !== change.put?.uuid) transactions.delete(change.remove.uuid)
    if (change.put) transactions.put(change.put)
    for (const row of change.installments ?? []) tx.objectStore('loan_installments').put(row)
    for (const move of change.bucketMoves ?? []) tx.objectStore('bucket_moves').put(move)
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

export function updateTransaction(previous: Transaction, next: Transaction): Promise<void> {
  return applyLedger({ remove: previous, put: { ...next, uuid: previous.uuid, updated_at: new Date().toISOString() } })
}

export async function saveTransaction(editing: Transaction | undefined, fields: DraftFields): Promise<string> {
  if (editing) {
    await updateTransaction(editing, { ...editing, ...fields })
    return editing.uuid
  }
  const record = draftTransaction(fields)
  await recordTransaction(record)
  return record.uuid
}

export function deleteTransaction(record: Transaction): Promise<void> {
  return applyLedger({ remove: record })
}

export function recordWithInstallments(record: Transaction, installments: LoanInstallment[]): Promise<void> {
  return applyLedger({ put: record, installments })
}

export function recordWithBucketMoves(record: Transaction, bucketMoves: BucketMove[]): Promise<void> {
  return applyLedger({ put: record, bucketMoves })
}
