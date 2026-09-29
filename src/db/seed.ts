import { count, newRecord, putMany } from './db'
import type { Category, CategoryKind, Settings } from './types'

export const UNCATEGORIZED_KEY = 'uncategorized'

const CATEGORY_SEEDS: Array<[key: string, name: string, kind: CategoryKind]> = [
  ['groceries', 'Supermercado', 'expense'],
  ['food', 'Comida', 'expense'],
  ['restaurants', 'Restaurantes', 'expense'],
  ['transport', 'Transporte', 'expense'],
  ['rent', 'Renta', 'expense'],
  ['utilities', 'Servicios', 'expense'],
  ['health', 'Salud', 'expense'],
  ['entertainment', 'Entretenimiento', 'expense'],
  ['personal', 'Personal', 'expense'],
  [UNCATEGORIZED_KEY, 'Sin categoría', 'expense'],
  ['contract_income', 'Ingreso por contrato', 'income'],
]

async function seedDefaults(): Promise<void> {
  if ((await count('categories')) === 0) {
    await putMany(
      'categories',
      CATEGORY_SEEDS.map(([key, name, kind]) => newRecord<Category>({ key, name, kind })),
    )
  }

  if ((await count('settings')) === 0) {
    await putMany('settings', [
      newRecord<Settings>({
        cad_day_rate: null,
        fx_rate: null,
        fx_source: null,
        buffer_mxn: 0,
        first_income_rule: { target_bucket: 'emergency' },
        second_income_rule: { retirement_pct: 0.2, travel_mxn: 5000 },
      }),
    ])
  }
}

export interface DbSummary {
  categories: number
}

let ready: Promise<DbSummary> | null = null

export function initDb(): Promise<DbSummary> {
  ready ??= (async () => {
    await seedDefaults()
    void navigator.storage?.persist?.()
    return { categories: await count('categories') }
  })().catch((error: unknown) => {
    ready = null
    throw error
  })

  return ready
}
