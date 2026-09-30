import { describe, expect, test } from 'bun:test'
import type { Account, Budget, Category, RecurringItem, Transaction } from '../db/types'
import { budgetForWindow, expenseStats, windowRanges } from './stats'

const stamp = '2026-09-01T00:00:00.000Z'
const today = new Date(2026, 8, 29, 12)

const payday = (uuid: string, due_day: number) =>
  ({ uuid, updated_at: stamp, name: uuid, type: 'income', amount: 20000, due_day, account_id: null, category_id: null, start_date: '2026-01-01', active: true }) as RecurringItem
const paydays = [payday('mid', 15), payday('late', 30)]

const category = (uuid: string): Category => ({ uuid, updated_at: stamp, key: uuid, name: uuid, kind: 'expense' })
const categories = [category('food'), category('fun'), category('uncategorized')]
const accounts = [
  { uuid: 'bank', type: 'checking' },
  { uuid: 'cash', type: 'cash' },
] as Account[]

let seq = 0
const tx = (date: string, amount: number, fields: Partial<Transaction> = {}) =>
  ({ uuid: `t${seq++}`, updated_at: stamp, type: 'expense', date, amount, account_id: 'bank', cc_id: null, category_id: 'food', ...fields }) as Transaction

describe('stats windows', () => {
  test('the income cycle runs from the last payday to the next, and the previous cycle before it', () => {
    const ranges = windowRanges('cycle', paydays, today)
    expect(ranges.current).toEqual({ from: '2026-09-15', to: '2026-09-30' })
    expect(ranges.previous).toEqual({ from: '2026-08-30', to: '2026-09-15' })
    expect(ranges.buckets.map((b) => b.range.from)).toEqual(['2026-09-15', '2026-09-22', '2026-09-29'])
  })

  test('month uses week buckets; 3 and 12 months use month buckets', () => {
    const month = windowRanges('month', paydays, today)
    expect(month.current).toEqual({ from: '2026-09-01', to: '2026-10-01' })
    expect(month.previous.from).toBe('2026-08-01')
    expect(month.buckets).toHaveLength(5)
    expect(month.buckets[4].range).toEqual({ from: '2026-09-29', to: '2026-10-01' })
    const year = windowRanges('year', paydays, today)
    expect(year.current).toEqual({ from: '2025-10-01', to: '2026-10-01' })
    expect(year.buckets).toHaveLength(12)
    expect(year.buckets[11].previous).toEqual({ from: '2025-09-01', to: '2025-10-01' })
  })

  test('without paydays the cycle is the last 15 days', () => {
    expect(windowRanges('cycle', [], today).current).toEqual({ from: '2026-09-15', to: '2026-09-30' })
  })
})

describe('expense stats', () => {
  const transactions = [
    tx('2026-09-02', 1000),
    tx('2026-09-10', 400, { category_id: 'fun', cc_id: 'card' }),
    tx('2026-09-12', -150),
    tx('2026-09-20', 300, { category_id: null, account_id: 'cash' }),
    tx('2026-09-21', 5000, { type: 'transfer' }),
    tx('2026-09-22', 700, { type: 'cc_payment' }),
    tx('2026-09-23', 90, { type: 'adjustment' }),
    tx('2026-09-24', 2000, { type: 'income' }),
    tx('2026-08-05', 800),
  ]
  const budgets = [{ uuid: 'b', updated_at: stamp, category_id: 'fun', month: null, limit_mxn: 300 }] as Budget[]
  const stats = expenseStats({ transactions, categories, accounts, budgets }, windowRanges('month', paydays, today), 'uncategorized')

  test('only expenses count, refunds lower their category, and the longest bar is first', () => {
    expect(stats.total).toBe(1550)
    expect(stats.byCategory.map((row) => [row.category.uuid, row.amount])).toEqual([
      ['food', 850],
      ['fun', 400],
      ['uncategorized', 300],
    ])
  })

  test('a category over its budget is flagged', () => {
    expect(stats.byCategory.find((row) => row.category.uuid === 'fun')).toMatchObject({ budget: 300, over: true })
    expect(stats.byCategory.find((row) => row.category.uuid === 'food')?.over).toBe(false)
  })

  test('payment method splits bank, cash and card; the previous window compares', () => {
    expect(stats.byMethod.map((m) => m.amount)).toEqual([850, 300, 400])
    expect(stats.previousTotal).toBe(800)
    expect(stats.series[0]).toMatchObject({ amount: 1000, previous: 800 })
  })

  test('a budget over part of a month is prorated by days', () => {
    expect(budgetForWindow(budgets, 'fun', { from: '2026-09-15', to: '2026-09-30' })).toBe(150)
    expect(budgetForWindow(budgets, 'food', { from: '2026-09-01', to: '2026-10-01' })).toBeNull()
  })
})
