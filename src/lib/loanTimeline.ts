import type { Loan, LoanInstallment } from '../db/types'
import type { MoneyData } from '../db/useMoneyData'
import { FALLBACK_CYCLE_DAYS } from './cycle'
import { dateToIso, isoToDate } from './dates'
import { isInstallmentPaid, loanRows, paidInstallmentIds, reschedule, summarizeLoan, type ScheduleRow } from './loans'
import { roundMoney } from './money'
import { projectedAvailable, type ProjectionAssumptions } from './projection'
import { timeline } from './timeline'

export type PayoffOptionId = 'scheduled' | 'extra' | 'now'

export interface PlannedRow extends ScheduleRow {
  extra?: boolean
}

export interface PayoffOption {
  id: PayoffOptionId
  rows: PlannedRow[]
  payoffDate: string | null
  futureInterest: number
}

function noon(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12)
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12)
}

export function openRows(loan: Loan, data: Pick<MoneyData, 'installments' | 'transactions'>): LoanInstallment[] {
  const paid = paidInstallmentIds(data.transactions)
  return loanRows(loan, data.installments).filter((row) => row.status === 'scheduled' && !isInstallmentPaid(row, paid))
}

function option(id: PayoffOptionId, rows: PlannedRow[]): PayoffOption {
  return {
    id,
    rows,
    payoffDate: rows.at(-1)?.due_date ?? null,
    futureInterest: roundMoney(rows.reduce((sum, row) => sum + row.interest_part, 0)),
  }
}

export function payoffOptions(loan: Loan, data: MoneyData, today: Date, extraPerIncome: number, incomeDates: Date[]): PayoffOption[] {
  const open = openRows(loan, data)
  const remaining = summarizeLoan(loan, data.installments, data.transactions).remaining
  const todayIso = dateToIso(today)

  let rows: ScheduleRow[] = open
  let left = remaining
  const withExtra: PlannedRow[] = []
  if (extraPerIncome > 0) {
    for (const date of incomeDates.map(dateToIso)) {
      while (rows.length > 0 && rows[0].due_date < date) {
        left = roundMoney(left - rows[0].principal_part)
        withExtra.push(rows[0])
        rows = rows.slice(1)
      }
      if (rows.length === 0 || left <= 0) break
      const pay = roundMoney(Math.min(extraPerIncome, left))
      withExtra.push({ due_date: date, amount: pay, principal_part: pay, interest_part: 0, extra: true })
      left = roundMoney(left - pay)
      rows = left > 0 ? reschedule(loan, rows, left, 'shorten') : []
      if (rows.length === 0) break
    }
  }
  withExtra.push(...rows)

  return [
    option('scheduled', open),
    option('extra', extraPerIncome > 0 ? withExtra : open),
    option('now', remaining > 0 ? [{ due_date: todayIso, amount: remaining, principal_part: remaining, interest_part: 0, extra: true }] : []),
  ]
}

export function withSchedule(data: MoneyData, loan: Loan, rows: PlannedRow[]): MoneyData {
  const replaced = new Set(openRows(loan, data).map((row) => row.uuid))
  const planned: LoanInstallment[] = rows.map((row, index) => ({
    uuid: `planned-${loan.uuid}-${index}`,
    updated_at: '',
    loan_id: loan.uuid,
    due_date: row.due_date,
    amount: row.amount,
    principal_part: row.principal_part,
    interest_part: row.interest_part,
    status: 'scheduled',
  }))
  return { ...data, installments: [...data.installments.filter((row) => !replaced.has(row.uuid)), ...planned] }
}

export function incomeDatesBetween(data: MoneyData, from: Date, to: Date): Date[] {
  const dates = timeline(data, addDays(from, 1), addDays(to, 1))
    .filter((event) => event.kind === 'income')
    .map((event) => noon(event.date))
  const unique = dates.filter((date, index) => dates.findIndex((d) => d.getTime() === date.getTime()) === index)
  if (unique.length > 0 || data.recurring.some((item) => item.active && item.type === 'income')) return unique
  const fallback: Date[] = []
  for (let date = addDays(from, FALLBACK_CYCLE_DAYS); date <= to; date = addDays(date, FALLBACK_CYCLE_DAYS)) fallback.push(date)
  return fallback
}

export interface TimelinePoint {
  date: Date
  available: number
  installments: number
  payoffs: string[]
  freed: number
}

export function loanSeries(
  data: MoneyData,
  loans: Loan[],
  today: Date,
  assumptions: ProjectionAssumptions = {},
  extraCycles = 1,
): TimelinePoint[] {
  const borrowed = loans.filter((loan) => loan.direction === 'borrowed' && loan.status === 'active')
  const last = new Map(borrowed.map((loan) => [loan.uuid, openRows(loan, data)]))
  const payoff = new Map(borrowed.map((loan) => [loan.uuid, last.get(loan.uuid)!.at(-1)?.due_date ?? null]))
  const finalIso = [...payoff.values()].reduce<string>((max, iso) => (iso && iso > max ? iso : max), dateToIso(today))
  const end = isoToDate(finalIso)
  const after = incomeDatesBetween(data, end, addDays(end, 40 * extraCycles)).slice(0, extraCycles)
  const dates = [noon(today), ...incomeDatesBetween(data, today, end), ...after]

  return dates.map((date, index) => {
    const from = dateToIso(date)
    const until = dates[index + 1] ? dateToIso(dates[index + 1]) : dateToIso(addDays(date, FALLBACK_CYCLE_DAYS))
    let installments = 0
    const payoffs: string[] = []
    let freed = 0
    for (const loan of borrowed) {
      const rows = last.get(loan.uuid)!
      installments += rows.filter((row) => row.due_date >= from && row.due_date < until).reduce((sum, row) => sum + row.amount, 0)
      const end = payoff.get(loan.uuid)
      if (end && end >= from && end < until) payoffs.push(loan.name)
      if (end && end < from) freed += rows[0]?.amount ?? 0
    }
    return {
      date,
      available: roundMoney(projectedAvailable(data, today, date, assumptions)),
      installments: roundMoney(installments),
      payoffs,
      freed: roundMoney(freed),
    }
  })
}

export const NEW_LOAN_ID = 'new-loan'
export const NEW_LOAN_CHECKPOINTS = 48

export interface NewLoanPoint {
  date: Date
  installments: number
  without: number
  with: number
}

export interface NewLoanPreview {
  points: NewLoanPoint[]
  lowest: NewLoanPoint
  payoffDate: string | null
  truncated: boolean
}

export function newLoanPreview(
  data: MoneyData,
  today: Date,
  name: string,
  rows: ScheduleRow[],
  assumptions: ProjectionAssumptions = {},
): NewLoanPreview | null {
  const open = rows.filter((row) => row.due_date >= dateToIso(today)).sort((a, b) => a.due_date.localeCompare(b.due_date))
  if (open.length === 0) return null
  const loan = { uuid: NEW_LOAN_ID, name, direction: 'borrowed', status: 'active' } as Loan
  const planned = withSchedule({ ...data, loans: [...data.loans, loan] }, loan, open)
  const payoffDate = open.at(-1)!.due_date
  const dates = [noon(today), ...incomeDatesBetween(data, today, isoToDate(payoffDate))]
  const shown = dates.slice(0, NEW_LOAN_CHECKPOINTS)
  const points = shown.map((date, index) => {
    const from = dateToIso(date)
    const until = dates[index + 1] ? dateToIso(dates[index + 1]) : dateToIso(addDays(isoToDate(payoffDate), 1))
    return {
      date,
      installments: roundMoney(open.filter((row) => row.due_date >= from && row.due_date < until).reduce((sum, row) => sum + row.amount, 0)),
      without: roundMoney(projectedAvailable(data, today, date, assumptions)),
      with: roundMoney(projectedAvailable(planned, today, date, assumptions)),
    }
  })
  return {
    points,
    lowest: points.reduce((min, point) => (point.with < min.with ? point : min)),
    payoffDate,
    truncated: dates.length > shown.length,
  }
}

export function lowestAlong(data: MoneyData, today: Date, dates: Date[], assumptions: ProjectionAssumptions = {}): { date: Date; available: number } {
  return dates
    .map((date) => ({ date, available: roundMoney(projectedAvailable(data, today, date, assumptions)) }))
    .reduce((min, point) => (point.available < min.available ? point : min))
}
