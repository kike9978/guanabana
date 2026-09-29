import { todayIso } from '../lib/dates'
import { reconcileBalance } from './accounts'
import { newRecord, putMany, writeAcross } from './db'
import { draftTransaction, recordWithBucketMoves } from './ledger'
import type { Account, BucketMove, BucketMoveSource, SavingsBucket, Settings } from './types'

export const BUCKET_SOURCE_LABEL: Record<BucketMoveSource, string> = {
  manual: 'Manual',
  first_income: 'Regla del primer ingreso',
  second_income: 'Regla del segundo ingreso',
  bucket_transfer: 'Entre apartados',
}

export function isSystemBucket(bucket: SavingsBucket): boolean {
  return bucket.rule_type !== 'custom'
}

export async function createBucket(
  existing: SavingsBucket[],
  fields: Pick<SavingsBucket, 'name' | 'target' | 'target_date' | 'account_id'>,
): Promise<SavingsBucket> {
  const order = Math.max(0, ...existing.filter((b) => b.rule_type === 'custom').map((b) => b.sort_order ?? 0)) + 1
  const bucket = newRecord<SavingsBucket>({ ...fields, rule_type: 'custom', sort_order: order, archived: false })
  await putMany('savings_buckets', [bucket])
  return bucket
}

export async function setBucketArchived(bucket: SavingsBucket, archived: boolean): Promise<void> {
  const updated: SavingsBucket = { ...bucket, archived, updated_at: new Date().toISOString() }
  await writeAcross([{ store: 'savings_buckets', put: [updated] }])
}

export async function swapBucketOrder(a: SavingsBucket, b: SavingsBucket): Promise<void> {
  const now = new Date().toISOString()
  const first: SavingsBucket = { ...a, sort_order: b.sort_order ?? 0, updated_at: now }
  const second: SavingsBucket = { ...b, sort_order: a.sort_order ?? 0, updated_at: now }
  await writeAcross([{ store: 'savings_buckets', put: [first, second] }])
}

export async function transferBetweenBuckets(from: SavingsBucket, to: SavingsBucket, amount: number, reason: string): Promise<void> {
  const transfer_id = crypto.randomUUID()
  const date = todayIso()
  const move = (bucket: SavingsBucket, signed: number) =>
    newRecord<BucketMove>({ bucket_id: bucket.uuid, amount: signed, reason, source: 'bucket_transfer', date, income_tx_id: null, transfer_id })
  await putMany('bucket_moves', [move(from, -amount), move(to, amount)])
}

export async function fundFromBucket(fields: { bucket: SavingsBucket; from: Account; to: Account; amount: number; reason: string }): Promise<void> {
  const date = todayIso()
  const transfer = draftTransaction({
    type: 'transfer',
    amount: fields.amount,
    date,
    account_id: fields.from.uuid,
    to_account_id: fields.to.uuid,
    bucket_id: fields.bucket.uuid,
    notes: `Desde el apartado ${fields.bucket.name}`,
  })
  const move = newRecord<BucketMove>({
    bucket_id: fields.bucket.uuid,
    amount: -fields.amount,
    reason: fields.reason,
    source: 'manual',
    date,
    income_tx_id: null,
    tx_id: transfer.uuid,
  })
  await recordWithBucketMoves(transfer, [move])
}

export async function moveToBucket(
  bucket: SavingsBucket,
  fields: { amount: number; reason: string; source?: BucketMoveSource; date?: string; income_tx_id?: string | null },
): Promise<void> {
  await putMany('bucket_moves', [
    newRecord<BucketMove>({
      bucket_id: bucket.uuid,
      amount: fields.amount,
      reason: fields.reason,
      source: fields.source ?? 'manual',
      date: fields.date ?? todayIso(),
      income_tx_id: fields.income_tx_id ?? null,
    }),
  ])
}

export interface RuleMove {
  bucket: SavingsBucket
  amount: number
  reason: string
}

export async function applyIncomeRule(fields: {
  source: Exclude<BucketMoveSource, 'manual'>
  incomeTxId: string
  reconcile: { account: Account; actual: number } | null
  moves: RuleMove[]
}): Promise<void> {
  if (fields.reconcile) await reconcileBalance({ account: fields.reconcile.account }, fields.reconcile.actual)
  const moves = fields.moves.filter((move) => move.amount > 0)
  if (moves.length === 0) return
  const date = todayIso()
  await putMany(
    'bucket_moves',
    moves.map((move) =>
      newRecord<BucketMove>({
        bucket_id: move.bucket.uuid,
        amount: move.amount,
        reason: move.reason,
        source: fields.source,
        date,
        income_tx_id: fields.incomeTxId,
      }),
    ),
  )
}

export async function updateBucket(
  bucket: SavingsBucket,
  fields: Pick<SavingsBucket, 'name' | 'target' | 'target_date' | 'account_id'>,
): Promise<void> {
  const updated: SavingsBucket = { ...bucket, ...fields, updated_at: new Date().toISOString() }
  await writeAcross([{ store: 'savings_buckets', put: [updated] }])
}

export async function updateSettings(settings: Settings, fields: Partial<Omit<Settings, 'uuid' | 'updated_at'>>): Promise<void> {
  const updated: Settings = { ...settings, ...fields, updated_at: new Date().toISOString() }
  await writeAcross([{ store: 'settings', put: [updated] }])
}
