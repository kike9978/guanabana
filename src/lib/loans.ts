import type { IncomeSlot, Loan, LoanFrequency, LoanInstallment, LoanInterest, Transaction } from '../db/types'
import { dateToIso, isoToDate } from './dates'
import { roundMoney } from './money'

export interface ScheduleInput {
  principal: number
  interest: LoanInterest
  rate_annual: number | null
  installment_amount: number | null
  frequency: LoanFrequency
  income_slot?: IncomeSlot | null
  first_due_date: string
  installment_count: number
}

export interface ScheduleRow {
  due_date: string
  amount: number
  principal_part: number
  interest_part: number
}

function periodsPerYear(input: Pick<ScheduleInput, 'frequency' | 'income_slot'>): number {
  if (input.frequency === 'per_income') return input.income_slot === 'both' ? 24 : 12
  return input.frequency === 'biweekly' ? 26 : 12
}

/** Paydays on or after `first`, one per installment. Days past a month's end fall on its last day. */
export function incomeDueDates(first: string, incomeDays: number[], count: number): string[] {
  const days = [...new Set(incomeDays)].sort((a, b) => a - b)
  if (days.length === 0) return []
  const start = isoToDate(first)
  const dates: string[] = []
  for (let month = 0; dates.length < count; month++) {
    const year = start.getFullYear()
    const index = start.getMonth() + month
    const last = new Date(year, index + 1, 0).getDate()
    for (const day of days) {
      const date = dateToIso(new Date(year, index, Math.min(day, last), 12))
      if (date >= first && !dates.includes(date) && dates.length < count) dates.push(date)
    }
  }
  return dates
}

function dueDate(first: string, index: number, frequency: LoanFrequency): string {
  const start = isoToDate(first)
  if (frequency === 'biweekly') {
    return dateToIso(new Date(start.getFullYear(), start.getMonth(), start.getDate() + index * 14, 12))
  }
  const month = start.getMonth() + index
  const last = new Date(start.getFullYear(), month + 1, 0).getDate()
  return dateToIso(new Date(start.getFullYear(), month, Math.min(start.getDate(), last), 12))
}

/** `incomeDays` are the paydays a `per_income` loan follows; without them it falls back to monthly dates. */
export function buildSchedule(input: ScheduleInput, incomeDays: number[] = []): ScheduleRow[] {
  const n = input.installment_count
  if (!Number.isInteger(n) || n < 1 || input.principal <= 0) return []
  const paydays = input.frequency === 'per_income' ? incomeDueDates(input.first_due_date, incomeDays, n) : []
  const due = (i: number) => paydays[i] ?? dueDate(input.first_due_date, i, input.frequency)

  const rows: ScheduleRow[] = []
  let balance = input.principal

  if (input.interest === 'fixed_rate' && input.rate_annual && input.rate_annual > 0) {
    const r = input.rate_annual / 100 / periodsPerYear(input)
    const payment = roundMoney((input.principal * r) / (1 - (1 + r) ** -n))
    for (let i = 0; i < n; i++) {
      const interest = roundMoney(balance * r)
      const principal = i === n - 1 ? roundMoney(balance) : roundMoney(payment - interest)
      rows.push({ due_date: due(i), amount: roundMoney(principal + interest), principal_part: principal, interest_part: interest })
      balance = roundMoney(balance - principal)
    }
    return rows
  }

  const basePrincipal = roundMoney(input.principal / n)
  const fixedAmount = input.interest === 'fixed_installment' && input.installment_amount ? input.installment_amount : null
  const interestPerRow = fixedAmount === null ? 0 : Math.max(0, fixedAmount - basePrincipal)
  for (let i = 0; i < n; i++) {
    const principal = i === n - 1 ? roundMoney(balance) : basePrincipal
    const amount = fixedAmount === null ? principal : principal + interestPerRow
    rows.push({
      due_date: due(i),
      amount: roundMoney(amount),
      principal_part: principal,
      interest_part: roundMoney(Math.max(0, amount - principal)),
    })
    balance = roundMoney(balance - principal)
  }
  return rows
}

export function paidInstallmentIds(transactions: Transaction[]): Set<string> {
  return new Set(transactions.map((tx) => tx.loan_installment_id).filter((id): id is string => Boolean(id)))
}

export function isInstallmentPaid(row: LoanInstallment, paidIds: Set<string>): boolean {
  return row.status === 'settled' || paidIds.has(row.uuid)
}

export function loanRows(loan: Loan, installments: LoanInstallment[]): LoanInstallment[] {
  return installments
    .filter((row) => row.loan_id === loan.uuid && row.status !== 'skipped' && row.status !== 'superseded')
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
}

export function extraPayments(loan: Loan, transactions: Transaction[]): number {
  return roundMoney(transactions.filter((tx) => tx.loan_extra_id === loan.uuid).reduce((sum, tx) => sum + tx.amount, 0))
}

export interface LoanSummary {
  remaining: number
  paid: number
  interestPaid: number
  installmentsLeft: number
  installmentsTotal: number
  next: LoanInstallment | undefined
  payoffDate: string | undefined
  progress: number
}

export function summarizeLoan(loan: Loan, installments: LoanInstallment[], transactions: Transaction[]): LoanSummary {
  const paidIds = paidInstallmentIds(transactions)
  const rows = loanRows(loan, installments)
  const paidRows = rows.filter((row) => isInstallmentPaid(row, paidIds))
  const open = rows.filter((row) => !isInstallmentPaid(row, paidIds))
  const extra = extraPayments(loan, transactions)
  const principalPaid = paidRows.reduce((sum, row) => sum + row.principal_part, 0) + extra

  return {
    remaining: roundMoney(Math.max(0, loan.principal - principalPaid)),
    paid: roundMoney(paidRows.reduce((sum, row) => sum + row.amount, 0) + extra),
    interestPaid: roundMoney(paidRows.reduce((sum, row) => sum + row.interest_part, 0)),
    installmentsLeft: open.length,
    installmentsTotal: rows.length,
    next: open[0],
    payoffDate: rows.at(-1)?.due_date,
    progress: loan.principal > 0 ? Math.min(1, principalPaid / loan.principal) : 0,
  }
}

export interface RowEdit {
  due_date?: string
  amount?: number | null
}

export type ScheduleProblem =
  | { kind: 'missing' }
  | { kind: 'below_principal'; principal: number }
  | { kind: 'total'; principal: number; remaining: number }

export interface ScheduleEdit {
  rows: LoanInstallment[]
  changed: LoanInstallment[]
  problem: ScheduleProblem | null
}

/**
 * Applies edits to the unpaid rows only. With an annual rate only dates change. Without interest the
 * amount is all principal, so the open rows must still add up to what is left.
 */
export function editOpenRows(loan: Loan, open: LoanInstallment[], remaining: number, edits: Record<string, RowEdit>): ScheduleEdit {
  let problem: ScheduleProblem | null = null
  const rows = open.map((row) => {
    const edit = edits[row.uuid]
    if (!edit) return row
    const next = { ...row, due_date: edit.due_date ?? row.due_date }
    if (edit.amount === undefined || loan.interest === 'fixed_rate') return next
    if (edit.amount === null || edit.amount <= 0) {
      problem ??= { kind: 'missing' }
      return next
    }
    if (loan.interest === 'none') return { ...next, amount: edit.amount, principal_part: edit.amount, interest_part: 0 }
    if (edit.amount < row.principal_part) problem ??= { kind: 'below_principal', principal: row.principal_part }
    return { ...next, amount: edit.amount, interest_part: roundMoney(Math.max(0, edit.amount - row.principal_part)) }
  })
  if (rows.some((row) => !row.due_date)) problem ??= { kind: 'missing' }
  const principal = roundMoney(rows.reduce((sum, row) => sum + row.principal_part, 0))
  if (!problem && Math.abs(principal - remaining) > 0.01) problem = { kind: 'total', principal, remaining }
  const changed = rows.filter((row, index) => row.due_date !== open[index].due_date || row.amount !== open[index].amount)
  return { rows, changed, problem }
}

/** A loan with no dates: only a balance that payments lower. Nothing is reserved and nothing shows on Tiempo. */
export function isUnscheduled(loan: Pick<Loan, 'frequency'>): boolean {
  return loan.frequency === 'unscheduled'
}

/** What is left on active loans in one direction. Lent money is shown, never counted as available. */
export function outstanding(direction: Loan['direction'], loans: Loan[], installments: LoanInstallment[], transactions: Transaction[]): number {
  return roundMoney(
    loans
      .filter((loan) => loan.direction === direction && loan.status === 'active')
      .reduce((sum, loan) => sum + summarizeLoan(loan, installments, transactions).remaining, 0),
  )
}

export type ExtraMode = 'shorten' | 'lower'

export interface ExtraPlan {
  remaining: number
  replaced: LoanInstallment[]
  rows: ScheduleRow[]
}

export function planExtraPayment(
  loan: Loan,
  installments: LoanInstallment[],
  transactions: Transaction[],
  amount: number,
  mode: ExtraMode,
): ExtraPlan {
  const paidIds = paidInstallmentIds(transactions)
  const open = loanRows(loan, installments).filter((row) => !isInstallmentPaid(row, paidIds))
  const remaining = roundMoney(summarizeLoan(loan, installments, transactions).remaining - amount)
  if (open.length === 0 || remaining <= 0) return { remaining: Math.max(0, remaining), replaced: open, rows: [] }
  return { remaining, replaced: open, rows: reschedule(loan, open, remaining, mode) }
}

export function reschedule(loan: Loan, open: ScheduleRow[], remaining: number, mode: ExtraMode): ScheduleRow[] {
  if (open.length === 0 || remaining <= 0) return []
  const first = open[0]
  let count = open.length
  if (mode === 'shorten') {
    if (loan.interest === 'fixed_rate' && loan.rate_annual) {
      const r = loan.rate_annual / 100 / periodsPerYear(loan)
      const ratio = (remaining * r) / first.amount
      if (ratio < 1) count = Math.ceil(-Math.log(1 - ratio) / Math.log(1 + r) - 1e-9)
    } else if (first.principal_part > 0) {
      count = Math.ceil(remaining / first.principal_part - 1e-9)
    }
    count = Math.max(1, Math.min(count, open.length))
  }

  return buildSchedule({
    principal: remaining,
    interest: loan.interest,
    rate_annual: loan.rate_annual,
    installment_amount: loan.interest === 'fixed_installment' ? roundMoney(remaining / count + first.interest_part) : null,
    frequency: loan.frequency,
    income_slot: loan.income_slot,
    first_due_date: first.due_date,
    installment_count: count,
  }).map((row, index) => ({ ...row, due_date: open[index].due_date }))
}
