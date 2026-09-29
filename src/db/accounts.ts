import { todayIso } from '../lib/dates'
import { getAll, newRecord, putMany } from './db'
import type { Account, AccountType, CreditCard, PaymentStrategy } from './types'

export const OPENING_ACCOUNT_NAME = 'Saldo sin origen'

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  checking: 'Banco',
  cash: 'Efectivo',
  savings: 'Ahorro',
  unassigned: 'Sin origen',
}

export const STRATEGY_LABEL: Record<PaymentStrategy, string> = {
  full: 'Pago total',
  statement: 'Saldo al corte',
  minimum: 'Pago mínimo',
}

export function findOpeningAccount(accounts: Account[]): Account | undefined {
  return accounts.find((account) => account.type === 'unassigned')
}

export function isLiquid(account: Account): boolean {
  return account.type !== 'savings'
}

export async function saveOpeningBalance(amount: number, balanceDate: string): Promise<void> {
  const existing = findOpeningAccount(await getAll<Account>('accounts'))

  const record: Account = existing
    ? { ...existing, current_balance: amount, balance_date: balanceDate, updated_at: new Date().toISOString() }
    : newRecord<Account>({
        name: OPENING_ACCOUNT_NAME,
        type: 'unassigned',
        currency: 'MXN',
        current_balance: amount,
        balance_date: balanceDate,
      })

  await putMany('accounts', [record])
}

export async function createAccount(fields: { name: string; type: Exclude<AccountType, 'unassigned'>; balance: number }) {
  await putMany('accounts', [
    newRecord<Account>({
      name: fields.name,
      type: fields.type,
      currency: 'MXN',
      current_balance: fields.balance,
      balance_date: todayIso(),
    }),
  ])
}

export async function createCard(fields: Omit<CreditCard, 'uuid' | 'updated_at'>) {
  await putMany('credit_cards', [newRecord<CreditCard>(fields)])
}
