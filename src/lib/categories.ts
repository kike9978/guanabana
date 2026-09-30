import type { Budget, Category, CategoryKind, RecurringItem, Transaction } from '../db/types'
import { roundMoney } from './money'

export const UNCATEGORIZED_KEY = 'uncategorized'

/** Money handed over when lending. Written only with its loan, so it stays out of the pickers. */
export const DISBURSEMENT_KEY = 'loan_disbursement'

const INDENT = '\u00a0\u00a0\u00a0· '

export function isTopLevel(category: Category): boolean {
  return !category.parent_id
}

export function canHaveChildren(category: Category): boolean {
  return isTopLevel(category) && category.key !== UNCATEGORIZED_KEY && category.key !== DISBURSEMENT_KEY
}

/** The top-level category an id rolls up to: itself, or its parent. */
export function topCategoryId(id: string, categories: Category[]): string {
  return categories.find((c) => c.uuid === id)?.parent_id ?? id
}

export function childrenOf(parentId: string, categories: Category[], includeArchived = false): Category[] {
  return categories
    .filter((c) => c.parent_id === parentId && (includeArchived || !c.archived))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

export function categoryLabel(id: string | null | undefined, categories: Category[]): string | undefined {
  const category = categories.find((c) => c.uuid === id)
  if (!category) return undefined
  const parent = category.parent_id ? categories.find((c) => c.uuid === category.parent_id) : undefined
  return parent ? `${parent.name} · ${category.name}` : category.name
}

/** Top-level categories of a kind, each followed by its active subcategories, indented. */
export function categoryOptions(categories: Category[], kind: CategoryKind, keep: (string | null | undefined)[] = []): { value: string; label: string }[] {
  const kept = (c: Category) => (!c.archived && c.key !== DISBURSEMENT_KEY) || keep.includes(c.uuid)
  return categories
    .filter((c) => c.kind === kind && isTopLevel(c) && kept(c))
    .flatMap((parent) => [
      { value: parent.uuid, label: parent.name },
      ...childrenOf(parent.uuid, categories, true)
        .filter(kept)
        .map((child) => ({ value: child.uuid, label: `${INDENT}${child.name}` })),
    ])
}

/** A transaction matches a category filter if it is booked on it or, for a top-level one, on one of its subcategories. */
export function matchesCategory(categoryId: string | null, filterId: string, categories: Category[]): boolean {
  if (!categoryId) return false
  if (categoryId === filterId) return true
  const filter = categories.find((c) => c.uuid === filterId)
  return Boolean(filter && isTopLevel(filter) && topCategoryId(categoryId, categories) === filterId)
}

export interface CategoryUsage {
  transactions: number
  recurring: number
  budgets: number
}

export function categoryUsage(id: string, data: { transactions: Transaction[]; recurring: RecurringItem[]; budgets: Budget[] }): CategoryUsage {
  return {
    transactions: data.transactions.filter((tx) => tx.category_id === id).length,
    recurring: data.recurring.filter((item) => item.category_id === id).length,
    budgets: data.budgets.filter((b) => b.category_id === id).length,
  }
}

/** What moves between parent totals when a subcategory changes parent: its own movements, never its siblings'. */
export function moveImpact(id: string, transactions: Transaction[]): { count: number; amount: number } {
  const booked = transactions.filter((tx) => tx.category_id === id)
  return { count: booked.length, amount: roundMoney(booked.reduce((sum, tx) => sum + tx.amount, 0)) }
}

export function subcategoryNameError(name: string, parent: Category, categories: Category[], self?: Category): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Ponle un nombre a la subcategoría.'
  const taken = childrenOf(parent.uuid, categories).some((c) => c.uuid !== self?.uuid && c.name.trim().toLowerCase() === trimmed.toLowerCase())
  return taken ? `Ya hay una subcategoría con ese nombre en ${parent.name}.` : null
}
