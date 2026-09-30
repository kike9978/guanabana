import { homeAccount, reservedBalance, withdrawSplit } from '../lib/buckets'
import { todayIso } from '../lib/dates'
import { roundMoney } from '../lib/money'
import { getAll, newRecord, writeAcross } from './db'
import { draftTransaction, recordPlanPurchase } from './ledger'
import type {
  Account,
  BucketMove,
  PaymentMethod,
  PlanItem,
  PlannedContribution,
  ProjectionScenario,
  SavingsBucket,
  Settings,
  Transaction,
} from './types'

export type PlanItemFields = Omit<PlanItem, 'uuid' | 'updated_at' | 'sort_order' | 'status' | 'tx_id' | 'source'>

const touch = <T extends { updated_at: string }>(record: T, fields: Partial<T> = {}): T => ({ ...record, ...fields, updated_at: new Date().toISOString() })

export function nextSortOrder(items: PlanItem[]): number {
  return Math.max(0, ...items.map((item) => item.sort_order)) + 1
}

export async function addPlanItem(existing: PlanItem[], fields: PlanItemFields): Promise<PlanItem> {
  const item = newRecord<PlanItem>({ ...fields, sort_order: nextSortOrder(existing), status: 'planned', tx_id: null, source: 'manual' })
  await writeAcross([{ store: 'plan_items', put: [item] }])
  return item
}

export function updatePlanItem(item: PlanItem, fields: Partial<PlanItemFields> & { status?: PlanItem['status'] }): Promise<void> {
  return writeAcross([{ store: 'plan_items', put: [touch(item, fields)] }])
}

export function removePlanItem(item: PlanItem): Promise<void> {
  return writeAcross([{ store: 'plan_items', delete: [item.uuid] }])
}

export function swapPlanOrder(a: PlanItem, b: PlanItem): Promise<void> {
  return writeAcross([{ store: 'plan_items', put: [touch(a, { sort_order: b.sort_order }), touch(b, { sort_order: a.sort_order })] }])
}

export async function addPlannedContribution(fields: Pick<PlannedContribution, 'bucket_id' | 'amount' | 'income_slot'>): Promise<void> {
  await writeAcross([{ store: 'planned_contributions', put: [newRecord<PlannedContribution>({ ...fields, enabled: true })] }])
}

export function setContributionEnabled(row: PlannedContribution, enabled: boolean): Promise<void> {
  return writeAcross([{ store: 'planned_contributions', put: [touch(row, { enabled })] }])
}

export function removePlannedContribution(row: PlannedContribution): Promise<void> {
  return writeAcross([{ store: 'planned_contributions', delete: [row.uuid] }])
}

export function setPlanSettings(settings: Settings, fields: Partial<NonNullable<Settings['plan']>>): Promise<void> {
  const plan = { include_rules: true, in_tiempo: false, ...settings.plan, ...fields }
  return writeAcross([{ store: 'settings', put: [touch(settings, { plan })] }])
}

/** Saved ¿Puedo comprarlo? scenarios become disabled wishes, once. Their slider values are not kept. */
export async function migrateScenarios(): Promise<void> {
  const scenarios = await getAll<ProjectionScenario>('projection_scenarios')
  if (scenarios.length === 0) return
  const existing = await getAll<PlanItem>('plan_items')
  let order = nextSortOrder(existing)
  const items = [...scenarios]
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
    .map((scenario) =>
      newRecord<PlanItem>({
        name: scenario.name,
        amount: scenario.amount,
        target_date: scenario.date,
        enabled: false,
        sort_order: order++,
        payment_method: scenario.card_id ? 'credit_card' : 'bank',
        card_id: scenario.card_id,
        msi_months: scenario.msi_months ?? null,
        category_id: null,
        bucket_draws: [],
        status: 'planned',
        tx_id: null,
        notes: '',
        source: 'manual',
      }),
    )
  await writeAcross([
    { store: 'plan_items', put: items },
    { store: 'projection_scenarios', delete: scenarios.map((s) => s.uuid) },
  ])
}

export interface PurchaseDraw {
  bucket: SavingsBucket
  amount: number
}

export interface PlanPurchase {
  item: PlanItem
  amount: number
  date: string
  /** Bank, cash, or Saldo sin origen; null with a card. */
  account: Account | null
  cardId: string | null
  msiMonths: number | null
  categoryId: string | null
  draws: PurchaseDraw[]
  /** Where money drawn from an Ahorro apartado lands. */
  bringTo: Account | null
}

function methodFor(account: Account): PaymentMethod {
  if (account.type === 'cash') return 'cash'
  if (account.type === 'unassigned') return 'unassigned'
  return 'bank'
}

/** The rows Ya lo compré writes. Draws from bank or cash are withdrawals linked to the expense; Ahorro draws are transfers in. */
export function planPurchaseRows(purchase: PlanPurchase, accounts: Account[], moves: BucketMove[]): { records: Transaction[]; moves: BucketMove[] } {
  const draws = purchase.draws.filter((draw) => draw.amount > 0)
  const liquidDraws = draws.filter((draw) => !homeAccount(draw.bucket, accounts))
  const expense = draftTransaction({
    type: 'expense',
    amount: purchase.amount,
    date: purchase.date,
    payment_method: purchase.cardId ? 'credit_card' : methodFor(purchase.account!),
    account_id: purchase.cardId ? null : purchase.account!.uuid,
    cc_id: purchase.cardId,
    category_id: purchase.categoryId,
    notes: purchase.item.name,
    msi_months: purchase.cardId && (purchase.msiMonths ?? 0) > 1 ? purchase.msiMonths : null,
    plan_item_id: purchase.item.uuid,
    bucket_id: liquidDraws[0]?.bucket.uuid ?? null,
  })
  const records: Transaction[] = [expense]
  const rows: BucketMove[] = []
  const reason = `Compra: ${purchase.item.name}`
  const move = (bucket: SavingsBucket, amount: number, txId: string, source: BucketMove['source'] = 'manual') =>
    newRecord<BucketMove>({ bucket_id: bucket.uuid, amount: -amount, reason, source, date: purchase.date, income_tx_id: null, tx_id: txId })

  for (const draw of draws) {
    const home = homeAccount(draw.bucket, accounts)
    if (!home) {
      const split = withdrawSplit(reservedBalance(draw.bucket, moves), draw.amount)
      if (split.fromReserved > 0) rows.push(move(draw.bucket, split.fromReserved, expense.uuid))
      if (split.fromOpening > 0) rows.push(move(draw.bucket, roundMoney(split.fromOpening), expense.uuid, 'opening'))
      continue
    }
    const to = purchase.bringTo
    if (!to) throw new Error('A draw from an Ahorro apartado needs an account to bring it to')
    const transfer = draftTransaction({
      type: 'transfer',
      amount: draw.amount,
      date: purchase.date,
      account_id: home.uuid,
      to_account_id: to.uuid,
      bucket_id: draw.bucket.uuid,
      notes: `Desde el apartado ${draw.bucket.name} · ${purchase.item.name}`,
      plan_item_id: purchase.item.uuid,
    })
    records.push(transfer)
    rows.push(move(draw.bucket, draw.amount, transfer.uuid))
  }
  return { records, moves: rows }
}

/** A planned contribution on a custom apartado becomes its income rule. The planned row goes, so it is not counted twice. */
export function makeContributionARule(bucket: SavingsBucket, row: PlannedContribution): Promise<void> {
  const updated: SavingsBucket = {
    ...bucket,
    income_share: { income: row.income_slot, amount: row.amount },
    updated_at: new Date().toISOString(),
  }
  return writeAcross([
    { store: 'savings_buckets', put: [updated] },
    { store: 'planned_contributions', delete: [row.uuid] },
  ])
}

export async function apartarForWish(
  buckets: SavingsBucket[],
  item: PlanItem,
  fields: { name: string; target: number; targetDate: string | null; perIncome: number | null; income: PlannedContribution['income_slot'] },
): Promise<SavingsBucket> {
  const order = Math.max(0, ...buckets.filter((b) => b.rule_type === 'custom').map((b) => b.sort_order ?? 0)) + 1
  const bucket = newRecord<SavingsBucket>({
    name: fields.name,
    rule_type: 'custom',
    target: fields.target > 0 ? fields.target : null,
    target_date: fields.targetDate,
    account_id: null,
    sort_order: order,
    archived: false,
    income_share: null,
  })
  const contribution =
    fields.perIncome && fields.perIncome > 0
      ? newRecord<PlannedContribution>({ bucket_id: bucket.uuid, amount: fields.perIncome, income_slot: fields.income, enabled: true })
      : null
  const draws = fields.target > 0 ? [...item.bucket_draws, { bucket_id: bucket.uuid, amount: fields.target }] : item.bucket_draws
  await writeAcross([
    { store: 'savings_buckets', put: [bucket] },
    ...(contribution ? [{ store: 'planned_contributions' as const, put: [contribution] }] : []),
    { store: 'plan_items', put: [touch(item, { bucket_draws: draws })] },
  ])
  return bucket
}

/** Spends part of a bought wish's apartado toward a card payment. Ahorro moves the money into the paying account. */
export async function releaseCardDraw(
  item: PlanItem,
  bucket: SavingsBucket,
  amount: number,
  accounts: Account[],
  moves: BucketMove[],
  bringTo: Account | null,
): Promise<void> {
  const reason = `Pago de tarjeta · ${item.name}`
  const date = todayIso()
  const home = homeAccount(bucket, accounts)
  if (!home) {
    const split = withdrawSplit(reservedBalance(bucket, moves), amount)
    const row = (part: number, source: BucketMove['source']) =>
      newRecord<BucketMove>({
        bucket_id: bucket.uuid,
        amount: -part,
        reason,
        source,
        date,
        income_tx_id: null,
        plan_item_id: item.uuid,
      })
    const written = [
      split.fromReserved > 0 ? row(split.fromReserved, 'manual') : null,
      split.fromOpening > 0 ? row(split.fromOpening, 'opening') : null,
    ].filter((move) => move !== null)
    await writeAcross([{ store: 'bucket_moves', put: written }])
    return
  }
  if (!bringTo) throw new Error('A draw from an Ahorro apartado needs an account')
  const transfer = draftTransaction({
    type: 'transfer',
    amount,
    date,
    account_id: home.uuid,
    to_account_id: bringTo.uuid,
    bucket_id: bucket.uuid,
    notes: `Desde el apartado ${bucket.name} · ${item.name}`,
    plan_item_id: item.uuid,
  })
  const move = newRecord<BucketMove>({
    bucket_id: bucket.uuid,
    amount: -amount,
    reason,
    source: 'manual',
    date,
    income_tx_id: null,
    tx_id: transfer.uuid,
    plan_item_id: item.uuid,
  })
  await recordPlanPurchase([transfer], [move], touch(item))
}

export function buyPlanItem(purchase: PlanPurchase, accounts: Account[], moves: BucketMove[]): Promise<void> {
  const { records, moves: rows } = planPurchaseRows(purchase, accounts, moves)
  return recordPlanPurchase(records, rows, touch(purchase.item, { tx_id: records[0].uuid }))
}
