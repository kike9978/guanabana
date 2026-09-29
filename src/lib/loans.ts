import type { Loan, LoanFrequency, LoanInstallment, LoanInterest, Transaction } from '../db/types'
import { dateToIso, isoToDate } from './dates'
import { roundMoney } from './money'

export interface ScheduleInput {
  principal: number
  interest: LoanInterest
  rate_annual: number | null
  installment_amount: number | null
  frequency: LoanFrequency
  first_due_date: string
  installment_count: number
}

export interface ScheduleRow {
  due_date: string
  amount: number
  principal_part: number
  interest_part: number
}

const PERIODS_PER_YEAR: Record<LoanFrequency, number> = { monthly: 12, biweekly: 26 }

function dueDate(first: string, index: number, frequency: LoanFrequency): string {
  const start = isoToDate(first)
  if (frequency === 'biweekly') {
    return dateToIso(new Date(start.getFullYear(), start.getMonth(), start.getDate() + index * 14, 12))
  }
  const month = start.getMonth() + index
  const last = new Date(start.getFullYear(), month + 1, 0).getDate()
  return dateToIso(new Date(start.getFullYear(), month, Math.min(start.getDate(), last), 12))
}

export function buildSchedule(input: ScheduleInput): ScheduleRow[] {
  const n = input.installment_count
  if (!Number.isInteger(n) || n < 1 || input.principal <= 0) return []

  const rows: ScheduleRow[] = []
  let balance = input.principal

  if (input.interest === 'fixed_rate' && input.rate_annual && input.rate_annual > 0) {
    const r = input.rate_annual / 100 / PERIODS_PER_YEAR[input.frequency]
    const payment = roundMoney((input.principal * r) / (1 - (1 + r) ** -n))
    for (let i = 0; i < n; i++) {
      const interest = roundMoney(balance * r)
      const principal = i === n - 1 ? roundMoney(balance) : roundMoney(payment - interest)
      rows.push({ due_date: dueDate(input.first_due_date, i, input.frequency), amount: roundMoney(principal + interest), principal_part: principal, interest_part: interest })
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
      due_date: dueDate(input.first_due_date, i, input.frequency),
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

  const first = open[0]
  let count = open.length
  if (mode === 'shorten') {
    if (loan.interest === 'fixed_rate' && loan.rate_annual) {
      const r = loan.rate_annual / 100 / PERIODS_PER_YEAR[loan.frequency]
      const ratio = (remaining * r) / first.amount
      if (ratio < 1) count = Math.ceil(-Math.log(1 - ratio) / Math.log(1 + r) - 1e-9)
    } else if (first.principal_part > 0) {
      count = Math.ceil(remaining / first.principal_part - 1e-9)
    }
    count = Math.max(1, Math.min(count, open.length))
  }

  const rows = buildSchedule({
    principal: remaining,
    interest: loan.interest,
    rate_annual: loan.rate_annual,
    installment_amount: loan.interest === 'fixed_installment' ? roundMoney(remaining / count + first.interest_part) : null,
    frequency: loan.frequency,
    first_due_date: first.due_date,
    installment_count: count,
  }).map((row, index) => ({ ...row, due_date: open[index].due_date }))
  return { remaining, replaced: open, rows }
}
