import { UNCATEGORIZED_KEY } from '../lib/categories'
import { count, getAll, newRecord, putMany } from './db'
import type { BucketRule, Category, CategoryKind, SavingsBucket, Settings } from './types'

export { UNCATEGORIZED_KEY }

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
  ['loan_payment', 'Pago de préstamo', 'expense'],
  [UNCATEGORIZED_KEY, 'Sin categoría', 'expense'],
  ['contract_income', 'Ingreso principal', 'income'],
  ['other_income', 'Otros ingresos', 'income'],
  ['loan_repayment', 'Cobro de préstamo', 'income'],
]

const RENAMED_SEEDS: Array<[key: string, previous: string]> = [['contract_income', 'Ingreso por contrato']]

const BUCKET_SEEDS: Array<[rule: BucketRule, name: string]> = [
  ['emergency', 'Emergencia'],
  ['retirement', 'Retiro'],
  ['travel', 'Viajes'],
]

async function seedDefaults(): Promise<void> {
  const categories = await getAll<Category>('categories')
  const existing = new Set(categories.map((category) => category.key))
  const missing = CATEGORY_SEEDS.filter(([key]) => !existing.has(key))
  if (missing.length > 0) {
    await putMany(
      'categories',
      missing.map(([key, name, kind]) => newRecord<Category>({ key, name, kind })),
    )
  }
  const renamed = categories.flatMap((category) => {
    const previous = RENAMED_SEEDS.find(([key, name]) => key === category.key && name === category.name)
    const next = previous && CATEGORY_SEEDS.find(([key]) => key === previous[0])
    return next ? [{ ...category, name: next[1], updated_at: new Date().toISOString() }] : []
  })
  if (renamed.length > 0) await putMany('categories', renamed)

  const buckets = new Set<string>((await getAll<SavingsBucket>('savings_buckets')).map((bucket) => bucket.rule_type))
  const missingBuckets = BUCKET_SEEDS.filter(([rule]) => !buckets.has(rule))
  if (missingBuckets.length > 0) {
    await putMany(
      'savings_buckets',
      missingBuckets.map(([rule_type, name]) => newRecord<SavingsBucket>({ rule_type, name, target: null, account_id: null })),
    )
  }

  if ((await count('settings')) === 0) {
    await putMany('settings', [
      newRecord<Settings>({
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
