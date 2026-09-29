import { balanceEffects } from '../lib/ledger'
import { roundMoney } from '../lib/money'
import { complete, newRecord, notifyChange, openDb, settle, type StoreName } from './db'
import type { Account, CreditCard, Transaction } from './types'

const LEDGER_STORES: StoreName[] = ['transactions', 'accounts', 'credit_cards']

async function applyLedger(record: Transaction, direction: 1 | -1): Promise<void> {
  const effects = balanceEffects(record)
  const db = await openDb()
  const tx = db.transaction(LEDGER_STORES, 'readwrite')
  const done = complete(tx)
  const now = new Date().toISOString()

  try {
    for (const effect of effects) {
      const store = tx.objectStore(effect.store)
      const current = (await settle(store.get(effect.uuid))) as Account | CreditCard | undefined
      if (!current) throw new Error(`Missing ${effect.store} ${effect.uuid}`)
      store.put({
        ...current,
        current_balance: roundMoney(current.current_balance + direction * effect.delta),
        updated_at: now,
      })
    }

    const transactions = tx.objectStore('transactions')
    if (direction === 1) transactions.put(record)
    else transactions.delete(record.uuid)
  } catch (error) {
    tx.abort()
    await done.catch(() => undefined)
    throw error
  }

  await done
  for (const store of LEDGER_STORES) notifyChange(store)
}

export function draftTransaction(
  fields: Pick<Transaction, 'type' | 'amount' | 'date'> & Partial<Omit<Transaction, 'uuid' | 'updated_at'>>,
): Transaction {
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
  return applyLedger(record, 1)
}

export function deleteTransaction(record: Transaction): Promise<void> {
  return applyLedger(record, -1)
}
