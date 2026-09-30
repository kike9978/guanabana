import { describe, expect, test } from 'bun:test'
import type { Budget, Category, Transaction } from '../db/types'
import { budgetRows, budgetTotals, spentByCategory } from './budgets'
import {
  canHaveChildren,
  categoryLabel,
  categoryOptions,
  DISBURSEMENT_KEY,
  matchesCategory,
  moveImpact,
  subcategoryNameError,
  topCategoryId,
  UNCATEGORIZED_KEY,
} from './categories'
import { expenseStats, windowRanges } from './stats'

const stamp = '2026-09-01T00:00:00.000Z'
const today = new Date(2026, 8, 20, 12)

const category = (uuid: string, fields: Partial<Category> = {}): Category => ({ uuid, updated_at: stamp, key: uuid, name: uuid, kind: 'expense', ...fields })
const fun = category('fun', { name: 'Entretenimiento' })
const movies = category('movies', { name: 'Cine', parent_id: 'fun' })
const games = category('games', { name: 'Juegos', parent_id: 'fun' })
const old = category('old', { name: 'Conciertos', parent_id: 'fun', archived: true })
const food = category('food', { name: 'Comida' })
const unc = category('unc', { key: UNCATEGORIZED_KEY, name: 'Sin categoría' })
const salary = category('salary', { kind: 'income', name: 'Sueldo' })
const categories = [fun, movies, games, old, food, unc, salary]

let seq = 0
const tx = (date: string, amount: number, category_id: string | null) =>
  ({ uuid: `t${seq++}`, updated_at: stamp, type: 'expense', date, amount, account_id: 'bank', cc_id: null, category_id }) as Transaction

const transactions = [
  tx('2026-09-02', 300, 'movies'),
  tx('2026-09-05', 200, 'games'),
  tx('2026-09-06', 100, 'fun'),
  tx('2026-09-08', 500, 'food'),
]
const budget = (category_id: string, limit_mxn: number) => ({ uuid: `b-${category_id}`, updated_at: stamp, category_id, month: null, limit_mxn }) as Budget

describe('category tree', () => {
  test('subcategories roll up to their parent and label as "Parent · Child"', () => {
    expect(topCategoryId('movies', categories)).toBe('fun')
    expect(topCategoryId('fun', categories)).toBe('fun')
    expect(categoryLabel('movies', categories)).toBe('Entretenimiento · Cine')
    expect(categoryLabel('food', categories)).toBe('Comida')
  })

  test('options indent children under the parent and hide archived ones unless kept', () => {
    const labels = categoryOptions(categories, 'expense').map((o) => o.value)
    expect(labels).toEqual(['fun', 'movies', 'games', 'food', 'unc'])
    expect(categoryOptions(categories, 'expense', ['old']).map((o) => o.value)).toContain('old')
    expect(categoryOptions(categories, 'income').map((o) => o.value)).toEqual(['salary'])
  })

  test('Préstamo otorgado stays out of the picker unless kept, and budgets do not count it', () => {
    const lent = category('lent', { key: DISBURSEMENT_KEY, name: 'Préstamo otorgado' })
    const all = [...categories, lent]
    expect(categoryOptions(all, 'expense').map((o) => o.value)).not.toContain('lent')
    expect(categoryOptions(all, 'expense', ['lent']).map((o) => o.value)).toContain('lent')
    expect(canHaveChildren(lent)).toBe(false)
    const handedOver = { ...tx('2026-09-09', 4000, 'lent'), loan_id: 'l' }
    expect(spentByCategory([...transactions, handedOver], '2026-09', 'unc', all).get('lent')).toBeUndefined()
  })

  test('Sin categoría and subcategories take no children', () => {
    expect(canHaveChildren(unc)).toBe(false)
    expect(canHaveChildren(movies)).toBe(false)
    expect(canHaveChildren(fun)).toBe(true)
  })

  test('a parent filter matches its subcategories; a subcategory filter matches only itself', () => {
    expect(matchesCategory('movies', 'fun', categories)).toBe(true)
    expect(matchesCategory('fun', 'movies', categories)).toBe(false)
    expect(matchesCategory('games', 'movies', categories)).toBe(false)
  })

  test('names are unique within a parent, ignoring case', () => {
    expect(subcategoryNameError(' cine ', fun, categories)).not.toBeNull()
    expect(subcategoryNameError('Cine', fun, categories, movies)).toBeNull()
    expect(subcategoryNameError('', fun, categories)).not.toBeNull()
  })

  test('moving a subcategory moves only its own movements', () => {
    expect(moveImpact('movies', transactions)).toEqual({ count: 1, amount: 300 })
  })
})

describe('subcategory roll-up', () => {
  test('sub spend counts for the sub and for its parent', () => {
    const spent = spentByCategory(transactions, '2026-09', 'unc', categories)
    expect(spent.get('fun')).toBe(600)
    expect(spent.get('movies')).toBe(300)
  })

  test('budget rows are top-level; sub limits sit on the child and never add to the month total', () => {
    const rows = budgetRows([budget('fun', 1000), budget('movies', 1500)], categories, transactions, '2026-09', today, 'unc')
    expect(rows.map((r) => r.category.uuid).sort()).toEqual(['food', 'fun'])
    const funRow = rows.find((r) => r.category.uuid === 'fun')!
    expect(funRow.spent).toBe(600)
    expect(funRow.unassigned).toBe(100)
    expect(funRow.children.find((c) => c.category.uuid === 'movies')?.limit).toBe(1500)
    expect(budgetTotals(rows).budgeted).toBe(1000)
    expect(budgetTotals(rows).spentTotal).toBe(1100)
  })

  test('stats roll up to the parent, with sub bars plus Sin subcategoría summing to it', () => {
    const stats = expenseStats({ transactions, categories, budgets: [], accounts: [] }, windowRanges('month', [], today), 'unc')
    expect(stats.byCategory.map((r) => r.category.uuid)).toEqual(['fun', 'food'])
    const funRow = stats.byCategory[0]
    expect(funRow.amount).toBe(600)
    expect(funRow.children.map((c) => [c.category?.uuid ?? null, c.amount])).toEqual([
      ['movies', 300],
      ['games', 200],
      [null, 100],
    ])
    expect(funRow.children.reduce((sum, c) => sum + c.amount, 0)).toBe(funRow.amount)
    expect(stats.byCategory[1].children).toEqual([])
    expect(stats.total).toBe(1100)
  })
})
