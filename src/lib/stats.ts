import type { Account, Budget, Category, RecurringItem, Transaction } from '../db/types'
import { childrenOf, topCategoryId } from './categories'
import { FALLBACK_CYCLE_DAYS, incomeCycle } from './cycle'
import { dateToIso, isoToDate } from './dates'
import { formatDate } from './format'
import { limitFor, monthKey } from './budgets'
import { isSpending } from './ledger'
import { roundMoney } from './money'

export type StatsWindow = 'cycle' | 'month' | 'quarter' | 'year'

export const STATS_WINDOWS: { id: StatsWindow; label: string }[] = [
  { id: 'cycle', label: 'Ciclo de ingreso' },
  { id: 'month', label: 'Mes' },
  { id: 'quarter', label: '3 meses' },
  { id: 'year', label: '12 meses' },
]

export type SpendMethod = 'bank' | 'cash' | 'credit_card'

export const METHOD_LABEL: Record<SpendMethod, string> = { bank: 'Banco', cash: 'Efectivo', credit_card: 'TDC' }

/** A date range as ISO days, `to` exclusive. */
export interface Range {
  from: string
  to: string
}

export interface WindowRanges {
  current: Range
  previous: Range
  buckets: { label: string; range: Range; previous: Range }[]
}

function day(year: number, month: number, date: number): Date {
  return new Date(year, month, date, 12)
}

function shift(date: Date, days: number): Date {
  return day(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function range(from: Date, to: Date): Range {
  return { from: dateToIso(from), to: dateToIso(to) }
}

const SHORT_MONTH = (date: Date) => date.toLocaleDateString('es-MX', { month: 'short' }).replace('.', '')

function weekBuckets(from: Date, to: Date, previousFrom: Date): WindowRanges['buckets'] {
  const buckets: WindowRanges['buckets'] = []
  for (let start = from, index = 0; start < to; start = shift(start, 7), index++) {
    const end = shift(start, 7) < to ? shift(start, 7) : to
    const length = Math.round((end.getTime() - start.getTime()) / 86_400_000)
    const prevStart = shift(previousFrom, index * 7)
    buckets.push({ label: `${start.getDate()} ${SHORT_MONTH(start)}`, range: range(start, end), previous: range(prevStart, shift(prevStart, length)) })
  }
  return buckets
}

function monthBuckets(first: Date, months: number): WindowRanges['buckets'] {
  return Array.from({ length: months }, (_, index) => {
    const start = day(first.getFullYear(), first.getMonth() + index, 1)
    const prev = day(first.getFullYear(), first.getMonth() + index - months, 1)
    return {
      label: SHORT_MONTH(start),
      range: range(start, day(start.getFullYear(), start.getMonth() + 1, 1)),
      previous: range(prev, day(prev.getFullYear(), prev.getMonth() + 1, 1)),
    }
  })
}

export function windowRanges(window: StatsWindow, recurring: RecurringItem[], today: Date): WindowRanges {
  if (window === 'cycle') {
    const cycle = incomeCycle(recurring, today)
    const from = cycle.hasSchedule ? cycle.start : shift(today, 1 - FALLBACK_CYCLE_DAYS)
    const to = cycle.hasSchedule ? cycle.end : shift(today, 1)
    const previousFrom = cycle.hasSchedule ? incomeCycle(recurring, shift(from, -1)).start : shift(from, -FALLBACK_CYCLE_DAYS)
    return { current: range(from, to), previous: range(previousFrom, from), buckets: weekBuckets(from, to, previousFrom) }
  }
  if (window === 'month') {
    const from = day(today.getFullYear(), today.getMonth(), 1)
    const to = day(today.getFullYear(), today.getMonth() + 1, 1)
    const previousFrom = day(today.getFullYear(), today.getMonth() - 1, 1)
    return { current: range(from, to), previous: range(previousFrom, from), buckets: weekBuckets(from, to, previousFrom) }
  }
  const months = window === 'quarter' ? 3 : 12
  const from = day(today.getFullYear(), today.getMonth() - months + 1, 1)
  const to = day(today.getFullYear(), today.getMonth() + 1, 1)
  return { current: range(from, to), previous: range(day(from.getFullYear(), from.getMonth() - months, 1), from), buckets: monthBuckets(from, months) }
}

export interface ExpenseFocus {
  label: string
  range: Range
  categoryId?: string
  /** Match categoryId only, leaving out its subcategories. */
  exact?: boolean
  method?: SpendMethod
}

export function rangeLabel(range: Range): string {
  const last = isoToDate(range.to)
  last.setDate(last.getDate() - 1)
  return `${formatDate(isoToDate(range.from))} – ${formatDate(last)}`
}

export function inRange(tx: Pick<Transaction, 'date'>, window: Range): boolean {
  return tx.date >= window.from && tx.date < window.to
}

/** Spending is `expense` rows only, without money lent; a refund is a negative expense and lowers the total. */
export function expensesIn(transactions: Transaction[], window: Range): Transaction[] {
  return transactions.filter((tx) => isSpending(tx) && inRange(tx, window))
}

export function sumAmounts(transactions: Transaction[]): number {
  return roundMoney(transactions.reduce((sum, tx) => sum + tx.amount, 0))
}

export function spendMethod(tx: Transaction, accounts: Account[]): SpendMethod {
  if (tx.cc_id) return 'credit_card'
  return accounts.find((a) => a.uuid === tx.account_id)?.type === 'cash' ? 'cash' : 'bank'
}

/** The monthly limits that apply to the window, prorated by the days of each month it covers. */
export function budgetForWindow(budgets: Budget[], categoryId: string, window: Range): number | null {
  const from = new Date(`${window.from}T12:00:00`)
  const to = new Date(`${window.to}T12:00:00`)
  let total = 0
  let any = false
  for (let cursor = day(from.getFullYear(), from.getMonth(), 1); cursor < to; cursor = day(cursor.getFullYear(), cursor.getMonth() + 1, 1)) {
    const budget = limitFor(budgets, categoryId, monthKey(cursor))
    if (!budget) continue
    const monthEnd = day(cursor.getFullYear(), cursor.getMonth() + 1, 1)
    const start = cursor > from ? cursor : from
    const end = monthEnd < to ? monthEnd : to
    const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
    total += budget.limit_mxn * (Math.round((end.getTime() - start.getTime()) / 86_400_000) / days)
    any = true
  }
  return any ? roundMoney(total) : null
}

export interface SubcategoryStat {
  /** Null is spend booked on the parent itself (“Sin subcategoría”). */
  category: Category | null
  amount: number
  share: number
  budget: number | null
  over: boolean
}

export interface CategoryStat {
  category: Category
  amount: number
  share: number
  budget: number | null
  over: boolean
  children: SubcategoryStat[]
}

export interface SeriesPoint {
  label: string
  range: Range
  amount: number
  previous: number
}

export interface ExpenseStats {
  total: number
  previousTotal: number
  count: number
  byCategory: CategoryStat[]
  byMethod: { id: SpendMethod; amount: number; share: number }[]
  series: SeriesPoint[]
}

export function expenseStats(
  data: { transactions: Transaction[]; categories: Category[]; accounts: Account[]; budgets: Budget[] },
  ranges: WindowRanges,
  fallbackId: string | null,
): ExpenseStats {
  const current = expensesIn(data.transactions, ranges.current)
  const total = sumAmounts(current)
  const share = (amount: number) => (total > 0 ? amount / total : 0)

  const perCategory = new Map<string, number>()
  const perBooked = new Map<string, number>()
  for (const tx of current) {
    const id = tx.category_id ?? fallbackId
    if (!id) continue
    const top = topCategoryId(id, data.categories)
    perCategory.set(top, (perCategory.get(top) ?? 0) + tx.amount)
    perBooked.set(id, (perBooked.get(id) ?? 0) + tx.amount)
  }
  const withBudget = (id: string, amount: number) => {
    const budget = budgetForWindow(data.budgets, id, ranges.current)
    return { budget, over: budget !== null && amount > budget }
  }
  const byCategory = [...perCategory]
    .flatMap(([id, amount]) => {
      const category = data.categories.find((c) => c.uuid === id)
      if (!category) return []
      const rounded = roundMoney(amount)
      const subs = childrenOf(id, data.categories, true)
        .map((child) => ({ category: child as Category | null, amount: roundMoney(perBooked.get(child.uuid) ?? 0) }))
        .filter((child) => child.amount !== 0)
      const children =
        subs.length === 0
          ? []
          : [...subs, { category: null, amount: roundMoney(perBooked.get(id) ?? 0) }]
              .filter((child) => child.amount !== 0)
              .map((child) => ({
                ...child,
                share: rounded > 0 ? child.amount / rounded : 0,
                ...(child.category ? withBudget(child.category.uuid, child.amount) : { budget: null, over: false }),
              }))
              .sort((a, b) => Number(a.category === null) - Number(b.category === null) || b.amount - a.amount)
      return [{ category, amount: rounded, share: share(rounded), ...withBudget(id, rounded), children }]
    })
    .filter((row) => row.amount !== 0)
    .sort((a, b) => b.amount - a.amount)

  const byMethod = (['bank', 'cash', 'credit_card'] as const).map((id) => {
    const amount = sumAmounts(current.filter((tx) => spendMethod(tx, data.accounts) === id))
    return { id, amount, share: share(amount) }
  })

  return {
    total,
    previousTotal: sumAmounts(expensesIn(data.transactions, ranges.previous)),
    count: current.length,
    byCategory,
    byMethod,
    series: ranges.buckets.map((bucket) => ({
      label: bucket.label,
      range: bucket.range,
      amount: sumAmounts(expensesIn(data.transactions, bucket.range)),
      previous: sumAmounts(expensesIn(data.transactions, bucket.previous)),
    })),
  }
}
