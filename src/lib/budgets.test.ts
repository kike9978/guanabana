import { describe, expect, test } from 'bun:test'
import type { Budget, Category, RecurringItem, Transaction } from '../db/types'
import { budgetRows, budgetTone, budgetTotals, expectedIncome, limitFor, monthPace, shiftMonth, spentByCategory } from './budgets'

const stamp = '2026-09-01T00:00:00.000Z'

const category = (uuid: string, kind: Category['kind'] = 'expense'): Category => ({ uuid, updated_at: stamp, key: uuid, name: uuid, kind })
const budget = (category_id: string, limit_mxn: number, month: string | null = null): Budget => ({
  uuid: `${category_id}-${month}`,
  updated_at: stamp,
  category_id,
  month,
  limit_mxn,
})
const tx = (type: Transaction['type'], date: string, amount: number, category_id: string | null) =>
  ({ uuid: `${type}-${date}-${amount}`, type, date, amount, category_id }) as Transaction
const payday = (due_day: number, amount: number | null): RecurringItem => ({
  uuid: `pay-${due_day}`,
  updated_at: stamp,
  name: 'Quincena',
  type: 'income',
  amount,
  due_day,
  account_id: null,
  category_id: null,
  start_date: '2026-01-01',
  active: true,
})

const food = category('food')
const fun = category('fun')
const rent = category('rent')
const unc = category('unc')
const transactions = [
  tx('expense', '2026-09-03', 1200, 'food'),
  tx('expense', '2026-09-10', 800, 'food'),
  tx('expense', '2026-09-12', -200, 'food'),
  tx('expense', '2026-08-30', 999, 'food'),
  tx('expense', '2026-09-05', 300, null),
  tx('adjustment', '2026-09-06', -500, null),
  tx('transfer', '2026-09-06', 5000, null),
  tx('expense', '2026-09-20', 2500, 'fun'),
]

describe('budgets', () => {
  test('spending counts expenses of the month only; refunds lower it and uncategorized falls back', () => {
    const spent = spentByCategory(transactions, '2026-09', 'unc')
    expect(spent.get('food')).toBe(1800)
    expect(spent.get('unc')).toBe(300)
    expect(spent.get('fun')).toBe(2500)
  })

  test('a month-specific limit wins over the standing one', () => {
    const budgets = [budget('food', 3000), budget('food', 5000, '2026-12')]
    expect(limitFor(budgets, 'food', '2026-09')?.limit_mxn).toBe(3000)
    expect(limitFor(budgets, 'food', '2026-12')?.limit_mxn).toBe(5000)
    expect(limitFor(budgets, 'fun', '2026-09')).toBeNull()
  })

  test('pace is the share of the month elapsed', () => {
    expect(monthPace('2026-09', new Date(2026, 8, 15, 12))).toBe(0.5)
    expect(monthPace('2026-08', new Date(2026, 8, 15, 12))).toBe(1)
    expect(monthPace('2026-10', new Date(2026, 8, 15, 12))).toBe(0)
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })

  test('cyan under pace, amber over pace, heat over the limit', () => {
    expect(budgetTone(1000, 4000, 0.5)).toBe('safe')
    expect(budgetTone(2500, 4000, 0.5)).toBe('tight')
    expect(budgetTone(4100, 4000, 0.5)).toBe('shortfall')
    expect(budgetTone(0, 4000, 0.5)).toBe('empty')
  })

  test('rows list budgeted categories first, then spending without a limit', () => {
    const rows = budgetRows([budget('food', 3000), budget('rent', 8000)], [food, fun, rent, unc, category('salary', 'income')], transactions, '2026-09', new Date(2026, 8, 15, 12), 'unc')
    expect(rows.map((r) => r.category.uuid)).toEqual(['food', 'rent', 'fun', 'unc'])
    expect(rows[0]).toMatchObject({ spent: 1800, limit: 3000, remaining: 1200, tone: 'tight' })
    expect(budgetTotals(rows)).toEqual({ budgeted: 11000, spentInBudgets: 1800, spentTotal: 4600, remaining: 9200 })
  })

  test('expected income comes from paydays with an amount, or from what was received', () => {
    expect(expectedIncome([payday(15, 20000), payday(30, 20000)], [], '2026-09')).toEqual({ amount: 40000, source: 'schedule', unknownItems: 0 })
    expect(expectedIncome([payday(30, 20000)], [], '2026-02').amount).toBe(20000)
    expect(expectedIncome([payday(15, null)], [tx('income', '2026-09-15', 18000, null)], '2026-09')).toEqual({
      amount: 18000,
      source: 'received',
      unknownItems: 1,
    })
  })
})
