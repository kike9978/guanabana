import type { Transaction } from '../db/types'

export interface BalanceEffect {
  store: 'accounts' | 'credit_cards'
  uuid: string
  delta: number
}

/** Spending is `expense` rows, minus money handed over as a loan: that is a receivable, not a purchase. */
export function isSpending(tx: Transaction): boolean {
  return tx.type === 'expense' && !tx.loan_id
}

function required(id: string | null, field: string): string {
  if (!id) throw new Error(`Transaction is missing ${field}`)
  return id
}

export function balanceEffects(tx: Transaction): BalanceEffect[] {
  switch (tx.type) {
    case 'expense':
      return tx.cc_id
        ? [{ store: 'credit_cards', uuid: tx.cc_id, delta: tx.amount }]
        : [{ store: 'accounts', uuid: required(tx.account_id, 'account_id'), delta: -tx.amount }]
    case 'income':
      return [{ store: 'accounts', uuid: required(tx.account_id, 'account_id'), delta: tx.amount }]
    case 'transfer':
      return [
        { store: 'accounts', uuid: required(tx.account_id, 'account_id'), delta: -tx.amount },
        { store: 'accounts', uuid: required(tx.to_account_id, 'to_account_id'), delta: tx.amount },
      ]
    case 'cc_payment':
      return [
        { store: 'accounts', uuid: required(tx.account_id, 'account_id'), delta: -tx.amount },
        { store: 'credit_cards', uuid: required(tx.cc_id, 'cc_id'), delta: -tx.amount },
      ]
    case 'adjustment':
      return tx.cc_id
        ? [{ store: 'credit_cards', uuid: tx.cc_id, delta: tx.amount }]
        : [{ store: 'accounts', uuid: required(tx.account_id, 'account_id'), delta: tx.amount }]
  }
}
