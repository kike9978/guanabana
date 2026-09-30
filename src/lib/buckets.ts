import type { Account, BucketMove, RecurringItem, SavingsBucket } from '../db/types'
import { FALLBACK_CYCLE_DAYS, incomeCycle, occurrencesBetween } from './cycle'
import { dateToIso, daysBetween, isoToDate } from './dates'
import { roundMoney } from './money'

export function bucketBalance(bucket: SavingsBucket, moves: BucketMove[]): number {
  return roundMoney(moves.filter((move) => move.bucket_id === bucket.uuid).reduce((sum, move) => sum + move.amount, 0))
}

export function isHeldInLiquid(bucket: Pick<SavingsBucket, 'account_id'>, accounts: Account[]): boolean {
  if (!bucket.account_id) return true
  const account = accounts.find((a) => a.uuid === bucket.account_id)
  return !account || account.type !== 'savings'
}

export function bucketsInLiquid(buckets: SavingsBucket[], moves: BucketMove[], accounts: Account[]): number {
  return roundMoney(
    buckets
      .filter((bucket) => isHeldInLiquid(bucket, accounts))
      .reduce((sum, bucket) => sum + Math.max(0, bucketBalance(bucket, moves)), 0),
  )
}

export function incomeEventsUntil(recurring: RecurringItem[], today: Date, until: Date): number {
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 12)
  const end = new Date(until.getFullYear(), until.getMonth(), until.getDate() + 1, 12)
  if (end <= from) return 0
  const days = recurring.filter((item) => item.active && item.type === 'income').map((item) => item.due_day)
  if (days.length === 0) return Math.ceil(daysBetween(from, end) / FALLBACK_CYCLE_DAYS)
  return days.reduce((sum, day) => sum + occurrencesBetween(day, from, end).length, 0)
}

export interface TargetPace {
  remaining: number
  events: number
  perIncome: number | null
  overdue: boolean
}

export function targetPace(bucket: SavingsBucket, balance: number, recurring: RecurringItem[], today: Date): TargetPace | null {
  if (!bucket.target || bucket.target <= 0 || !bucket.target_date) return null
  const remaining = roundMoney(Math.max(0, bucket.target - balance))
  const events = incomeEventsUntil(recurring, today, isoToDate(bucket.target_date))
  return {
    remaining,
    events,
    perIncome: remaining > 0 && events > 0 ? Math.ceil((remaining / events) * 100) / 100 : null,
    overdue: remaining > 0 && events === 0,
  }
}

export interface CycleSetAside {
  since: Date
  amount: number
  required: number | null
}

export function setAsideThisCycle(bucket: SavingsBucket, moves: BucketMove[], recurring: RecurringItem[], today: Date): CycleSetAside {
  const since = incomeCycle(recurring, today).start
  const from = dateToIso(since)
  const cycleMoves = moves.filter((move) => move.bucket_id === bucket.uuid && move.date >= from)
  const amount = cycleMoves
    .filter((move) => move.amount > 0 && move.source !== 'bucket_transfer' && !move.reverses_id)
    .reduce((sum, move) => sum + move.amount, 0)
  const startBalance = bucketBalance(bucket, moves) - cycleMoves.reduce((sum, move) => sum + move.amount, 0)
  const dayBefore = new Date(since.getFullYear(), since.getMonth(), since.getDate() - 1, 12)
  const required = targetPace(bucket, roundMoney(startBalance), recurring, dayBefore)?.perIncome ?? null
  return { since, amount: roundMoney(amount), required }
}

export interface BucketFunding {
  bucket: SavingsBucket
  account: Account
  amount: number
}

export function bucketFundingOptions(
  buckets: SavingsBucket[],
  moves: BucketMove[],
  accounts: Account[],
  payFrom: Account,
  needed: number,
): BucketFunding[] {
  if (needed <= 0) return []
  return buckets.flatMap((bucket) => {
    const account = accounts.find((a) => a.uuid === bucket.account_id)
    if (bucket.archived || !account || account.archived || account.type !== 'savings' || account.uuid === payFrom.uuid) return []
    const amount = roundMoney(Math.min(needed, bucketBalance(bucket, moves), account.current_balance))
    return amount > 0 ? [{ bucket, account, amount }] : []
  })
}

export function bucketHistory(bucket: SavingsBucket, moves: BucketMove[]): BucketMove[] {
  return moves
    .filter((move) => move.bucket_id === bucket.uuid)
    .sort((a, b) => b.date.localeCompare(a.date) || b.updated_at.localeCompare(a.updated_at))
}
