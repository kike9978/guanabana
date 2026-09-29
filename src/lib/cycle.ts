import type { Loan, LoanInstallment, RecurringItem, Transaction } from '../db/types'
import { dateToIso, daysBetween, isoToDate } from './dates'
import { paidInstallmentIds } from './loans'

export const FALLBACK_CYCLE_DAYS = 15

export interface IncomeCycle {
  start: Date
  nextIncome: Date | null
  end: Date
  hasSchedule: boolean
}

function occurrenceIn(year: number, month: number, day: number): Date {
  const last = new Date(year, month + 1, 0).getDate()
  return new Date(year, month, Math.min(day, last), 12)
}

function noon(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12)
}

export function occurrencesBetween(day: number, from: Date, to: Date): Date[] {
  const result: Date[] = []
  const start = noon(from)
  const end = noon(to)
  for (let cursor = new Date(start.getFullYear(), start.getMonth() - 1, 1); cursor <= end; cursor.setMonth(cursor.getMonth() + 1)) {
    const date = occurrenceIn(cursor.getFullYear(), cursor.getMonth(), day)
    if (date >= start && date < end) result.push(date)
  }
  return result
}

export function incomeCycle(recurring: RecurringItem[], today: Date): IncomeCycle {
  const days = recurring.filter((item) => item.active && item.type === 'income').map((item) => item.due_day)
  const now = noon(today)

  if (days.length === 0) {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + FALLBACK_CYCLE_DAYS, 12)
    return { start: now, nextIncome: null, end, hasSchedule: false }
  }

  const back = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate(), 12)
  const ahead = new Date(now.getFullYear(), now.getMonth() + 2, now.getDate(), 12)
  const dates = days.flatMap((day) => occurrencesBetween(day, back, ahead)).sort((a, b) => a.getTime() - b.getTime())
  const previous = dates.filter((date) => date <= now).at(-1) ?? back
  const next = dates.find((date) => date > now) ?? ahead
  return { start: previous, nextIncome: next, end: next, hasSchedule: true }
}

export function cycleProgress(cycle: IncomeCycle, today: Date): number {
  const total = daysBetween(cycle.start, cycle.end)
  return total > 0 ? Math.min(1, Math.max(0, daysBetween(cycle.start, today) / total)) : 0
}

export type CommitmentKind = 'bill' | 'loan'

export interface Commitment {
  key: string
  kind: CommitmentKind
  date: Date
  label: string
  amount: number
  overdue: boolean
  recurringId?: string
  occurrence?: string
  installmentId?: string
  categoryId?: string | null
  accountId?: string | null
}

export function billCommitments(
  recurring: RecurringItem[],
  transactions: Transaction[],
  cycle: IncomeCycle,
  today: Date,
): Commitment[] {
  const paid = new Set(
    transactions.filter((tx) => tx.recurring_id && tx.occurrence).map((tx) => `${tx.recurring_id}|${tx.occurrence}`),
  )
  const now = noon(today)

  return recurring
    .filter((item) => item.active && item.type === 'bill' && item.amount !== null && item.amount > 0)
    .flatMap((item) =>
      occurrencesBetween(item.due_day, cycle.start, cycle.end)
        .filter((date) => dateToIso(date) >= item.start_date)
        .filter((date) => !paid.has(`${item.uuid}|${dateToIso(date)}`))
        .map<Commitment>((date) => ({
          key: `${item.uuid}-${dateToIso(date)}`,
          kind: 'bill',
          date,
          label: item.name,
          amount: item.amount ?? 0,
          overdue: date < now,
          recurringId: item.uuid,
          occurrence: dateToIso(date),
          categoryId: item.category_id,
          accountId: item.account_id,
        })),
    )
}

export function loanCommitments(
  loans: Loan[],
  installments: LoanInstallment[],
  transactions: Transaction[],
  until: Date,
  today: Date,
): Commitment[] {
  const paid = paidInstallmentIds(transactions)
  const active = new Map(loans.filter((loan) => loan.status === 'active' && loan.direction === 'borrowed').map((loan) => [loan.uuid, loan]))
  const now = noon(today)
  const end = dateToIso(until)

  return installments
    .filter((row) => active.has(row.loan_id) && row.status === 'scheduled' && !paid.has(row.uuid) && row.due_date < end)
    .map<Commitment>((row) => {
      const loan = active.get(row.loan_id)!
      const date = isoToDate(row.due_date)
      return {
        key: row.uuid,
        kind: 'loan',
        date,
        label: `Cuota ${loan.name}`,
        amount: row.amount,
        overdue: date < now,
        installmentId: row.uuid,
        accountId: loan.pay_from_account_id,
      }
    })
}

export function sumCommitments(items: Commitment[]): number {
  return Math.round(items.reduce((sum, item) => sum + item.amount, 0) * 100) / 100
}
