import { todayIso } from '../lib/dates'
import { roundMoney } from '../lib/money'
import { getAll, newRecord, putMany } from './db'
import { draftTransaction, recordTransaction } from './ledger'
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

export function selectable<T extends { uuid: string; archived?: boolean }>(records: T[], keep?: (string | null | undefined)[]): T[] {
  return records.filter((record) => !record.archived || keep?.includes(record.uuid))
}

export function canArchive(record: Account | CreditCard): boolean {
  return record.current_balance === 0 && !('type' in record && record.type === 'unassigned')
}

export async function updateAccount(account: Account, fields: Pick<Account, 'name' | 'type'>): Promise<void> {
  const updated: Account = { ...account, ...fields, updated_at: new Date().toISOString() }
  await putMany('accounts', [updated])
}

export async function updateCard(
  card: CreditCard,
  fields: Pick<
    CreditCard,
    'name' | 'limit' | 'statement_day' | 'due_day' | 'payment_strategy' | 'statement_balance' | 'minimum_payment' | 'statement_date'
  >,
): Promise<void> {
  const updated: CreditCard = { ...card, ...fields, updated_at: new Date().toISOString() }
  await putMany('credit_cards', [updated])
}

export async function setAccountArchived(account: Account, archived: boolean): Promise<void> {
  if (archived && !canArchive(account)) throw new Error('Account balance must be zero to archive')
  const updated: Account = { ...account, archived, updated_at: new Date().toISOString() }
  await putMany('accounts', [updated])
}

export async function setCardArchived(card: CreditCard, archived: boolean): Promise<void> {
  if (archived && !canArchive(card)) throw new Error('Card debt must be zero to archive')
  const updated: CreditCard = { ...card, archived, updated_at: new Date().toISOString() }
  await putMany('credit_cards', [updated])
}

export async function reconcileBalance(target: { account: Account } | { card: CreditCard }, actual: number): Promise<void> {
  const current = 'account' in target ? target.account.current_balance : target.card.current_balance
  const gap = roundMoney(actual - current)
  if (gap === 0) return
  await recordTransaction(
    draftTransaction({
      type: 'adjustment',
      amount: gap,
      date: todayIso(),
      account_id: 'account' in target ? target.account.uuid : null,
      cc_id: 'card' in target ? target.card.uuid : null,
    }),
  )
}
