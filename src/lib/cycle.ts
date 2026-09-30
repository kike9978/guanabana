import type { Loan, LoanInstallment, RecurringItem, RecurringOverride, Transaction } from '../db/types'
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

export type RepeatFields = Pick<RecurringItem, 'frequency' | 'interval' | 'due_day' | 'start_date'>

export function repeatOf(item: RepeatFields): { frequency: 'monthly' | 'weekly' | 'once'; interval: number } {
  if (item.frequency === 'once') return { frequency: 'once', interval: 1 }
  return { frequency: item.frequency ?? 'monthly', interval: Math.max(1, item.interval ?? 1) }
}

export function isPlainMonthly(item: RepeatFields): boolean {
  const { frequency, interval } = repeatOf(item)
  return frequency === 'monthly' && interval === 1
}

export function occurrencesPerYear(item: RepeatFields): number {
  const { frequency, interval } = repeatOf(item)
  if (frequency === 'once') return 0
  return frequency === 'weekly' ? 52 / interval : 12 / interval
}

function monthIndex(date: Date): number {
  return date.getFullYear() * 12 + date.getMonth()
}

/**
 * Dates in [from, to) that follow the item's repeat. The series runs in both directions from
 * `start_date`, which only sets the phase; callers decide whether dates before it count.
 */
export function itemOccurrences(item: RepeatFields, from: Date, to: Date): Date[] {
  const { frequency, interval } = repeatOf(item)
  const start = noon(from)
  const end = noon(to)
  const anchor = isoToDate(item.start_date)
  const result: Date[] = []

  if (frequency === 'once') return anchor >= start && anchor < end ? [anchor] : []

  if (frequency === 'weekly') {
    const step = 7 * interval
    const offset = Math.ceil(daysBetween(anchor, start) / step)
    for (let k = offset; ; k++) {
      const date = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + k * step, 12)
      if (date >= end) break
      if (date >= start) result.push(date)
    }
    return result
  }

  if (interval === 1) return occurrencesBetween(item.due_day, from, to)
  for (let m = monthIndex(start) - 1; m <= monthIndex(end); m++) {
    if ((((m - monthIndex(anchor)) % interval) + interval) % interval !== 0) continue
    const date = occurrenceIn(Math.floor(m / 12), m % 12, item.due_day)
    if (date >= start && date < end) result.push(date)
  }
  return result
}

/** The next `count` occurrences on or after `from`, never before `start_date`. */
export function nextOccurrences(item: RepeatFields, from: Date, count: number): Date[] {
  const { frequency, interval } = repeatOf(item)
  if (frequency === 'once') {
    const due = isoToDate(item.start_date)
    return count > 0 && due >= noon(from) ? [due] : []
  }
  const floor = isoToDate(item.start_date) > noon(from) ? isoToDate(item.start_date) : noon(from)
  const spanDays = (frequency === 'weekly' ? 7 * interval : 31 * interval) * (count + 1)
  const to = new Date(floor.getFullYear(), floor.getMonth(), floor.getDate() + spanDays, 12)
  return itemOccurrences(item, floor, to).slice(0, count)
}

export function incomeCycle(recurring: RecurringItem[], today: Date): IncomeCycle {
  const items = recurring.filter((item) => item.active && item.type === 'income')
  const now = noon(today)

  if (items.length === 0) {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + FALLBACK_CYCLE_DAYS, 12)
    return { start: now, nextIncome: null, end, hasSchedule: false }
  }

  const back = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate(), 12)
  const ahead = new Date(now.getFullYear(), now.getMonth() + 2, now.getDate(), 12)
  const dates = items.flatMap((item) => itemOccurrences(item, back, ahead)).sort((a, b) => a.getTime() - b.getTime())
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

export function overrideIndex(overrides: RecurringOverride[]): Map<string, RecurringOverride> {
  return new Map(overrides.map((row) => [`${row.recurring_id}|${row.occurrence}`, row]))
}

/** The reserve for one occurrence: its override if there is one, otherwise the item's usual amount. */
export function occurrenceAmount(item: RecurringItem, occurrence: string, overrides: Map<string, RecurringOverride>): number | null {
  return overrides.get(`${item.uuid}|${occurrence}`)?.amount ?? item.amount
}

export function billCommitments(
  recurring: RecurringItem[],
  transactions: Transaction[],
  cycle: IncomeCycle,
  today: Date,
  overrides: RecurringOverride[] = [],
): Commitment[] {
  const paid = new Set(
    transactions.filter((tx) => tx.recurring_id && tx.occurrence).map((tx) => `${tx.recurring_id}|${tx.occurrence}`),
  )
  const adjusted = overrideIndex(overrides)
  const now = noon(today)

  return recurring
    .filter((item) => item.active && item.type === 'bill' && item.frequency !== 'once')
    .flatMap((item) =>
      itemOccurrences(item, cycle.start, cycle.end)
        .map((date) => ({ date, occurrence: dateToIso(date) }))
        .filter(({ occurrence }) => occurrence >= item.start_date && !paid.has(`${item.uuid}|${occurrence}`))
        .map(({ date, occurrence }) => ({ date, occurrence, amount: occurrenceAmount(item, occurrence, adjusted) ?? 0 }))
        .filter(({ amount }) => amount > 0)
        .map<Commitment>(({ date, occurrence, amount }) => ({
          key: `${item.uuid}-${occurrence}`,
          kind: 'bill',
          date,
          label: item.name,
          amount,
          overdue: date < now,
          recurringId: item.uuid,
          occurrence,
          categoryId: item.category_id,
          accountId: item.account_id,
        })),
    )
}

/**
 * One-time bills already generated and not yet registered. They reserve from `issued_on`,
 * even when the due date is after the next income. Paying one removes the reserve.
 */
export function invoiceCommitments(
  recurring: RecurringItem[],
  transactions: Transaction[],
  today: Date,
  overrides: RecurringOverride[] = [],
): Commitment[] {
  const paid = new Set(
    transactions.filter((tx) => tx.recurring_id && tx.occurrence).map((tx) => `${tx.recurring_id}|${tx.occurrence}`),
  )
  const adjusted = overrideIndex(overrides)
  const now = noon(today)
  const todayKey = dateToIso(now)

  return recurring
    .filter((item) => item.active && item.type === 'bill' && item.frequency === 'once')
    .flatMap((item) => {
      const due = item.start_date
      const issued = item.issued_on ?? due
      if (issued > todayKey || paid.has(`${item.uuid}|${due}`)) return []
      const amount = occurrenceAmount(item, due, adjusted) ?? 0
      if (amount <= 0) return []
      const date = isoToDate(due)
      return [
        {
          key: `${item.uuid}-${due}`,
          kind: 'bill' as const,
          date,
          label: item.name,
          amount,
          overdue: date < now,
          recurringId: item.uuid,
          occurrence: due,
          categoryId: item.category_id,
          accountId: item.account_id,
        },
      ]
    })
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
