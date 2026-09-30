import type { Budget, Category, RecurringItem, Transaction } from '../db/types'
import type { Tone } from '../components/hud'
import { childrenOf, isTopLevel, topCategoryId } from './categories'
import { occurrencesBetween } from './cycle'
import { roundMoney } from './money'

export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function shiftMonth(month: string, delta: number): string {
  const [year, index] = month.split('-').map(Number)
  return monthKey(new Date(year, index - 1 + delta, 1))
}

function monthBounds(month: string): { from: Date; to: Date; days: number } {
  const [year, index] = month.split('-').map(Number)
  return { from: new Date(year, index - 1, 1), to: new Date(year, index, 1), days: new Date(year, index, 0).getDate() }
}

export function limitFor(budgets: Budget[], categoryId: string, month: string): Budget | null {
  const rows = budgets.filter((b) => b.category_id === categoryId)
  return rows.find((b) => b.month === month) ?? rows.find((b) => b.month === null) ?? null
}

/** Spend per category id. A subcategory's spend counts for itself and for its parent. */
export function spentByCategory(
  transactions: Transaction[],
  month: string,
  fallbackId: string | null,
  categories: Category[] = [],
): Map<string, number> {
  const spent = new Map<string, number>()
  const add = (id: string, amount: number) => spent.set(id, roundMoney((spent.get(id) ?? 0) + amount))
  for (const tx of transactions) {
    if (tx.type !== 'expense' || !tx.date.startsWith(month)) continue
    const id = tx.category_id ?? fallbackId
    if (!id) continue
    add(id, tx.amount)
    const top = topCategoryId(id, categories)
    if (top !== id) add(top, tx.amount)
  }
  return spent
}

export interface ExpectedIncome {
  amount: number
  source: 'schedule' | 'received' | 'none'
  unknownItems: number
}

export function expectedIncome(recurring: RecurringItem[], transactions: Transaction[], month: string): ExpectedIncome {
  const { from, to } = monthBounds(month)
  const items = recurring.filter((item) => item.active && item.type === 'income')
  const scheduled = roundMoney(
    items
      .filter((item) => item.amount !== null)
      .reduce((sum, item) => sum + (item.amount ?? 0) * occurrencesBetween(item.due_day, from, to).length, 0),
  )
  const unknownItems = items.filter((item) => item.amount === null).length
  if (scheduled > 0) return { amount: scheduled, source: 'schedule', unknownItems }
  const received = roundMoney(transactions.filter((tx) => tx.type === 'income' && tx.date.startsWith(month)).reduce((sum, tx) => sum + tx.amount, 0))
  return { amount: received, source: received > 0 ? 'received' : 'none', unknownItems }
}

export function monthPace(month: string, today: Date): number {
  const current = monthKey(today)
  if (month < current) return 1
  if (month > current) return 0
  return today.getDate() / monthBounds(month).days
}

export interface BudgetRow {
  category: Category
  budget: Budget | null
  limit: number | null
  spent: number
  remaining: number | null
  ratio: number
  tone: Tone
  children: BudgetRow[]
  /** Spend booked on the parent itself, outside any subcategory. */
  unassigned: number
}

export function budgetTone(spent: number, limit: number | null, pace: number): Tone {
  if (!limit) return spent > 0 ? 'safe' : 'empty'
  if (spent > limit) return 'shortfall'
  if (spent / limit > pace) return 'tight'
  return spent > 0 ? 'safe' : 'empty'
}

export function budgetRows(
  budgets: Budget[],
  categories: Category[],
  transactions: Transaction[],
  month: string,
  today: Date,
  fallbackId: string | null,
): BudgetRow[] {
  const spent = spentByCategory(transactions, month, fallbackId, categories)
  const pace = monthPace(month, today)
  const row = (category: Category, children: BudgetRow[]): BudgetRow => {
    const budget = limitFor(budgets, category.uuid, month)
    const limit = budget ? budget.limit_mxn : null
    const amount = spent.get(category.uuid) ?? 0
    return {
      category,
      budget,
      limit,
      spent: amount,
      remaining: limit === null ? null : roundMoney(limit - amount),
      ratio: limit ? amount / limit : 0,
      tone: budgetTone(amount, limit, pace),
      children,
      unassigned: roundMoney(amount - children.reduce((sum, child) => sum + child.spent, 0)),
    }
  }
  const rows = categories
    .filter((category) => category.kind === 'expense' && isTopLevel(category))
    .map((category) =>
      row(
        category,
        childrenOf(category.uuid, categories, true)
          .map((child) => row(child, []))
          .filter((child) => child.limit !== null || child.spent !== 0 || !child.category.archived),
      ),
    )
    .filter((row) => row.limit !== null || row.spent !== 0)
  return rows.sort(
    (a, b) => Number(a.limit === null) - Number(b.limit === null) || b.ratio - a.ratio || b.spent - a.spent,
  )
}

export interface BudgetTotals {
  budgeted: number
  spentInBudgets: number
  spentTotal: number
  remaining: number
}

export function budgetTotals(rows: BudgetRow[]): BudgetTotals {
  const budgeted = roundMoney(rows.reduce((sum, row) => sum + (row.limit ?? 0), 0))
  const spentInBudgets = roundMoney(rows.filter((row) => row.limit !== null).reduce((sum, row) => sum + row.spent, 0))
  const spentTotal = roundMoney(rows.reduce((sum, row) => sum + row.spent, 0))
  return { budgeted, spentInBudgets, spentTotal, remaining: roundMoney(budgeted - spentInBudgets) }
}
