import { describe, expect, test } from 'bun:test'
import type { Account, Loan, LoanInstallment, RecurringItem, Settings } from '../db/types'
import type { MoneyData } from '../db/useMoneyData'
import { roundMoney } from './money'
import { habitualDailySpend, projectedAvailable, projectPurchase } from './projection'
import { moneySnapshot } from './snapshot'

const base = { updated_at: '2026-09-01T00:00:00.000Z' }
const bank: Account = { ...base, uuid: 'bbva', name: 'BBVA', type: 'checking', currency: 'MXN', current_balance: 10000, balance_date: '2026-09-01' }
const item = (uuid: string, type: RecurringItem['type'], due_day: number, amount: number | null): RecurringItem => ({
  ...base,
  uuid,
  name: uuid,
  type,
  amount,
  due_day,
  account_id: 'bbva',
  category_id: null,
  start_date: '2026-01-01',
  active: true,
})
const loan = { ...base, uuid: 'car', name: 'Auto', direction: 'borrowed', status: 'active', pay_from_account_id: 'bbva' } as Loan
const installment: LoanInstallment = {
  ...base,
  uuid: 'car-1',
  loan_id: 'car',
  due_date: '2026-10-10',
  amount: 3000,
  principal_part: 3000,
  interest_part: 0,
  status: 'scheduled',
}

function data(extra: Partial<MoneyData> = {}): MoneyData {
  return {
    loaded: true,
    accounts: [bank],
    cards: [],
    categories: [],
    transactions: [],
    recurring: [item('q1', 'income', 15, 20000), item('q2', 'income', 30, 20000), item('rent', 'bill', 1, 8000)],
    loans: [],
    installments: [],
    buckets: [],
    bucketMoves: [],
    budgets: [],
    settings: { buffer_mxn: 1000 } as Settings,
    ...extra,
  }
}

const today = new Date(2026, 8, 29, 12)
const on = (month: number, day: number) => new Date(2026, month - 1, day, 12)

describe('projection', () => {
  test('today it matches Disponible real', () => {
    expect(projectedAvailable(data(), today, today)).toBe(moneySnapshot(data(), today).breakdown.total)
    expect(projectedAvailable(data(), today, today)).toBe(9000)
  })

  test('a payday adds the income and reserves the bills of the new cycle', () => {
    expect(projectedAvailable(data(), today, on(9, 30))).toBe(10000 + 20000 - 8000 - 1000)
    expect(projectedAvailable(data(), today, on(10, 2))).toBe(21000)
  })

  test('a loan installment is reserved in its cycle and stays spent after it', () => {
    const withLoan = data({ loans: [loan], installments: [installment] })
    expect(projectedAvailable(withLoan, today, on(10, 5))).toBe(18000)
    expect(projectedAvailable(withLoan, today, on(10, 12))).toBe(18000)
  })

  test('scenarios scale scheduled income; extra and daily spending come off', () => {
    expect(projectedAvailable(data(), today, on(9, 30), { incomeFactor: 0.9 })).toBe(19000)
    expect(projectedAvailable(data(), today, on(9, 30), { extraExpenses: 2500 })).toBe(18500)
    expect(projectedAvailable(data(), today, on(10, 9), { dailySpend: 200 })).toBe(21000 - 10 * 200)
    expect(projectedAvailable(data(), today, today, { dailySpend: 200 })).toBe(9000)
  })

  test('habitual spending averages everyday expenses, not bills or installments', () => {
    const tx = (date: string, amount: number, extra = {}) => ({ uuid: date + amount, type: 'expense', date, amount, ...extra }) as never
    const history = [
      tx('2026-07-20', 900),
      tx('2026-09-10', 3000),
      tx('2026-09-20', -500),
      tx('2026-09-25', 8000, { recurring_id: 'rent' }),
      tx('2026-09-26', 3000, { loan_installment_id: 'car-1' }),
    ]
    expect(habitualDailySpend(history, today)).toEqual({ perDay: roundMoney(2500 / 60), days: 60 })
    expect(habitualDailySpend([tx('2026-09-27', 700)], today)).toEqual({ perDay: 100, days: 7 })
  })

  test('a purchase reports what is left on the day and the lowest point after it', () => {
    const result = projectPurchase(data(), today, { amount: 15000, date: '2026-10-05', cardId: null, incomeFactor: 1, extraExpenses: 0 })
    expect(result.before).toBe(21000)
    expect(result.after).toBe(6000)
    expect(result.lowest.available).toBe(6000)
    expect(result.checkpoints[1].date).toEqual(on(10, 15))
  })

  test('buying today when the money comes tomorrow shows the gap on the day', () => {
    const result = projectPurchase(data(), today, { amount: 12000, date: '2026-09-29', cardId: null, incomeFactor: 1, extraExpenses: 0 })
    expect(result.after).toBe(-3000)
    expect(result.lowest.date).toEqual(today)
    expect(result.checkpoints[1].available).toBe(9000)
  })

  test('paid events are not counted twice', () => {
    const paidRent = { uuid: 't', type: 'expense', recurring_id: 'rent', occurrence: '2026-10-01', date: '2026-09-28', amount: 8000 }
    const paid = data({ transactions: [paidRent as never], accounts: [{ ...bank, current_balance: 2000 }] })
    expect(projectedAvailable(paid, today, on(10, 2))).toBe(2000 + 20000 - 1000)
  })
})
