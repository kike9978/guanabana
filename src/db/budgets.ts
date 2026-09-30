import { newRecord, writeAcross } from './db'
import type { Budget } from './types'

export async function setBudget(existing: Budget | null, categoryId: string, limit: number): Promise<void> {
  const budget: Budget =
    existing && existing.month === null
      ? { ...existing, limit_mxn: limit, updated_at: new Date().toISOString() }
      : newRecord<Budget>({ category_id: categoryId, month: null, limit_mxn: limit })
  await writeAcross([{ store: 'budgets', put: [budget] }])
}

export async function removeBudget(budget: Budget): Promise<void> {
  await writeAcross([{ store: 'budgets', delete: [budget.uuid] }])
}
