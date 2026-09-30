import { newRecord, writeAcross } from './db'
import type { Budget, Category, RecurringItem, Transaction } from './types'

const stamp = () => new Date().toISOString()

export async function createSubcategory(parent: Category, name: string): Promise<Category> {
  const category = newRecord<Category>({
    key: `sub_${crypto.randomUUID().slice(0, 8)}`,
    name: name.trim(),
    kind: parent.kind,
    parent_id: parent.uuid,
    archived: false,
  })
  await writeAcross([{ store: 'categories', put: [category] }])
  return category
}

export async function updateSubcategory(category: Category, fields: Pick<Category, 'name' | 'parent_id'>): Promise<void> {
  const updated: Category = { ...category, ...fields, name: fields.name.trim(), updated_at: stamp() }
  await writeAcross([{ store: 'categories', put: [updated] }])
}

export async function setCategoryArchived(category: Category, archived: boolean): Promise<void> {
  const updated: Category = { ...category, archived, updated_at: stamp() }
  await writeAcross([{ store: 'categories', put: [updated] }])
}

/** Removes a subcategory. Its movements and fixed payments move to the parent in the same write; its limits go away. */
export async function deleteSubcategory(
  category: Category,
  data: { transactions: Transaction[]; recurring: RecurringItem[]; budgets: Budget[] },
): Promise<void> {
  const parentId = category.parent_id
  if (!parentId) throw new Error('Only subcategories can be deleted')
  const now = stamp()
  await writeAcross([
    {
      store: 'transactions',
      put: data.transactions.filter((tx) => tx.category_id === category.uuid).map((tx) => ({ ...tx, category_id: parentId, updated_at: now })),
    },
    {
      store: 'recurring_items',
      put: data.recurring.filter((item) => item.category_id === category.uuid).map((item) => ({ ...item, category_id: parentId, updated_at: now })),
    },
    { store: 'budgets', delete: data.budgets.filter((b) => b.category_id === category.uuid).map((b) => b.uuid) },
    { store: 'categories', delete: [category.uuid] },
  ])
}
