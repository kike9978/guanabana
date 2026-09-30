import { planExtraPayment, type ExtraMode, type ScheduleRow } from '../lib/loans'
import { newRecord, writeAcross } from './db'
import { draftTransaction, recordWithInstallments } from './ledger'
import type { Loan, LoanInstallment, RecurringItem, RecurringOverride, Transaction } from './types'

type RecurringFields = Omit<RecurringItem, 'uuid' | 'updated_at'>

export async function createRecurring(fields: RecurringFields): Promise<void> {
  await writeAcross([{ store: 'recurring_items', put: [newRecord<RecurringItem>(fields)] }])
}

export async function updateRecurring(item: RecurringItem, fields: Partial<RecurringFields>, dropOverrides: string[] = []): Promise<void> {
  const updated: RecurringItem = { ...item, ...fields, updated_at: new Date().toISOString() }
  await writeAcross([
    { store: 'recurring_items', put: [updated] },
    { store: 'recurring_overrides', delete: dropOverrides },
  ])
}

export async function deleteRecurring(item: RecurringItem, overrides: RecurringOverride[]): Promise<void> {
  await writeAcross([
    { store: 'recurring_items', delete: [item.uuid] },
    { store: 'recurring_overrides', delete: overrides.filter((row) => row.recurring_id === item.uuid).map((row) => row.uuid) },
  ])
}

/** One override per occurrence: an existing row is updated in place. */
export async function setOverride(existing: RecurringOverride | undefined, fields: Omit<RecurringOverride, 'uuid' | 'updated_at'>): Promise<void> {
  const row = existing ? { ...existing, amount: fields.amount, updated_at: new Date().toISOString() } : newRecord<RecurringOverride>(fields)
  await writeAcross([{ store: 'recurring_overrides', put: [row] }])
}

export async function removeOverride(existing: RecurringOverride): Promise<void> {
  await writeAcross([{ store: 'recurring_overrides', delete: [existing.uuid] }])
}

export async function createLoan(
  fields: Omit<Loan, 'uuid' | 'updated_at' | 'status'>,
  rows: ScheduleRow[],
  settledCount = 0,
): Promise<void> {
  const loan = newRecord<Loan>({ ...fields, status: 'active' })
  const installments = rows.map((row, index) =>
    newRecord<LoanInstallment>({ ...row, loan_id: loan.uuid, status: index < settledCount ? 'settled' : 'scheduled' }),
  )
  await writeAcross([
    { store: 'loans', put: [loan] },
    { store: 'loan_installments', put: installments },
  ])
}

export async function recordExtraPayment(
  loan: Loan,
  data: { installments: LoanInstallment[]; transactions: Transaction[] },
  fields: {
    amount: number
    date: string
    account_id: string
    payment_method: Transaction['payment_method']
    category_id: string | null
    mode: ExtraMode
  },
): Promise<void> {
  const plan = planExtraPayment(loan, data.installments, data.transactions, fields.amount, fields.mode)
  const record = draftTransaction({
    type: loan.direction === 'borrowed' ? 'expense' : 'income',
    amount: fields.amount,
    date: fields.date,
    account_id: fields.account_id,
    payment_method: loan.direction === 'borrowed' ? fields.payment_method : null,
    category_id: fields.category_id,
    notes: `Abono extra ${loan.name}`,
    loan_extra_id: loan.uuid,
  })
  const now = new Date().toISOString()
  const replaced = plan.replaced.map((row) => ({ ...row, status: 'superseded' as const, replaced_by: record.uuid, updated_at: now }))
  const created = plan.rows.map((row) =>
    newRecord<LoanInstallment>({ ...row, loan_id: loan.uuid, status: 'scheduled', created_by: record.uuid }),
  )
  await recordWithInstallments(record, [...replaced, ...created])
}

export async function deleteLoan(loan: Loan, installments: LoanInstallment[]): Promise<void> {
  await writeAcross([
    { store: 'loans', delete: [loan.uuid] },
    { store: 'loan_installments', delete: installments.filter((row) => row.loan_id === loan.uuid).map((row) => row.uuid) },
  ])
}

export async function setLoanStatus(loan: Loan, status: Loan['status']): Promise<void> {
  const updated: Loan = { ...loan, status, updated_at: new Date().toISOString() }
  await writeAcross([{ store: 'loans', put: [updated] }])
}
