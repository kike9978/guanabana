import { describe, expect, test } from 'bun:test'
import type { Account, Loan, LoanInstallment, RecurringItem, Settings } from '../db/types'
import type { MoneyData } from '../db/useMoneyData'
import { incomeDatesBetween, loanSeries, lowestAlong, newLoanPreview, payoffOptions, withSchedule } from './loanTimeline'

const base = { updated_at: '2026-09-01T00:00:00.000Z' }
const bank: Account = { ...base, uuid: 'bbva', name: 'BBVA', type: 'checking', currency: 'MXN', current_balance: 10000, balance_date: '2026-09-01' }
const payday = (uuid: string, due_day: number): RecurringItem => ({
  ...base,
  uuid,
  name: uuid,
  type: 'income',
  amount: 20000,
  due_day,
  account_id: 'bbva',
  category_id: null,
  start_date: '2026-01-01',
  active: true,
})
const loan = {
  ...base,
  uuid: 'car',
  name: 'Auto',
  direction: 'borrowed',
  status: 'active',
  interest: 'none',
  frequency: 'monthly',
  principal: 12000,
  pay_from_account_id: 'bbva',
} as Loan
const months = ['2026-10-10', '2026-11-10', '2026-12-10', '2027-01-10', '2027-02-10', '2027-03-10']
const installments: LoanInstallment[] = months.map((due_date, i) => ({
  ...base,
  uuid: `car-${i + 1}`,
  loan_id: 'car',
  due_date,
  amount: 2000,
  principal_part: 2000,
  interest_part: 0,
  status: 'scheduled',
}))

function data(): MoneyData {
  return {
    loaded: true,
    accounts: [bank],
    cards: [],
    categories: [],
    transactions: [],
    recurring: [payday('q1', 15), payday('q2', 30)],
    overrides: [],
    loans: [loan],
    installments,
    buckets: [],
    bucketMoves: [],
    budgets: [],
    settings: { buffer_mxn: 1000 } as Settings,
  }
}

const today = new Date(2026, 8, 29, 12)

describe('loan timeline', () => {
  const incomes = incomeDatesBetween(data(), today, new Date(2027, 2, 31, 12))

  test('paying as scheduled ends on the last installment', () => {
    const [scheduled] = payoffOptions(loan, data(), today, 2000, incomes)
    expect(scheduled.payoffDate).toBe('2027-03-10')
    expect(scheduled.futureInterest).toBe(0)
  })

  test('an extra payment each income shortens the schedule', () => {
    const extra = payoffOptions(loan, data(), today, 2000, incomes)[1]
    expect(extra.payoffDate).toBe('2026-11-15')
    expect(extra.rows.reduce((sum, row) => sum + row.principal_part, 0)).toBe(12000)
    expect(extra.rows.filter((row) => row.extra).length).toBe(4)
  })

  test('paying off now moves the whole remaining to today', () => {
    const now = payoffOptions(loan, data(), today, 0, incomes)[2]
    expect(now.rows).toEqual([{ due_date: '2026-09-29', amount: 12000, principal_part: 12000, interest_part: 0, extra: true }])
    expect(lowestAlong(withSchedule(data(), loan, now.rows), today, [today]).available).toBe(10000 - 1000 - 12000)
  })

  test('a new loan previews Disponible real with and without its installments', () => {
    const empty = { ...data(), loans: [], installments: [] }
    const rows = months.slice(0, 3).map((due_date) => ({ due_date, amount: 2000, principal_part: 2000, interest_part: 0 }))
    const preview = newLoanPreview(empty, today, 'Moto', rows)!
    expect(preview.payoffDate).toBe('2026-12-10')
    expect(preview.points[0]).toMatchObject({ installments: 0, without: 9000, with: 9000 })
    expect(preview.points[1]).toMatchObject({ installments: 2000, without: 9000 + 20000, with: 9000 + 20000 - 2000 })
    const last = preview.points.at(-1)!
    expect(last.without - last.with).toBe(6000)
    expect(preview.lowest.with).toBe(9000)
    expect(newLoanPreview(empty, today, 'Moto', [{ due_date: '2026-01-10', amount: 1, principal_part: 1, interest_part: 0 }])).toBeNull()
  })

  test('the series marks the payoff and then shows the installment coming back', () => {
    const series = loanSeries(data(), [loan], today)
    const payoff = series.find((point) => point.payoffs.includes('Auto'))
    expect(payoff?.date).toEqual(new Date(2027, 1, 28, 12))
    const last = series.at(-1)!
    expect(last.date).toEqual(new Date(2027, 2, 15, 12))
    expect(last.freed).toBe(2000)
    expect(series[0].installments).toBe(0)
    expect(series[1].installments).toBe(2000)
  })
})
