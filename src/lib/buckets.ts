import type { Account, BucketMove, RecurringItem, SavingsBucket } from '../db/types'
import { isLiquid } from './accounts'
import { FALLBACK_CYCLE_DAYS, incomeCycle, occurrencesBetween } from './cycle'
import { dateToIso, daysBetween, isoToDate } from './dates'
import { roundMoney } from './money'

export function bucketBalance(bucket: SavingsBucket, moves: BucketMove[]): number {
  return roundMoney(moves.filter((move) => move.bucket_id === bucket.uuid).reduce((sum, move) => sum + move.amount, 0))
}

export function isHeldInLiquid(bucket: Pick<SavingsBucket, 'account_id'>, accounts: Account[]): boolean {
  return homeAccount(bucket, accounts) === undefined
}

/** The savings or investment account an apartado lives in. Undefined when it sits in bank or cash. */
export function homeAccount(bucket: Pick<SavingsBucket, 'account_id'>, accounts: Account[]): Account | undefined {
  if (!bucket.account_id) return undefined
  const account = accounts.find((a) => a.uuid === bucket.account_id)
  return account && !isLiquid(account) ? account : undefined
}

export interface HeldBucket {
  bucket: SavingsBucket
  balance: number
}

export function bucketsInAccount(accountId: string, buckets: SavingsBucket[], moves: BucketMove[]): HeldBucket[] {
  return buckets
    .filter((bucket) => !bucket.archived && bucket.account_id === accountId)
    .map((bucket) => ({ bucket, balance: bucketBalance(bucket, moves) }))
}

/** Money in the account that no apartado claims. Negative when the apartados add up to more than the account. */
export function unassignedIn(account: Account, buckets: SavingsBucket[], moves: BucketMove[]): number {
  const held = bucketsInAccount(account.uuid, buckets, moves).reduce((sum, row) => sum + row.balance, 0)
  return roundMoney(account.current_balance - held)
}

/** Splits `amount` by weight, in cents. The rounding remainder lands on the heaviest line. Without weight, nothing is split. */
export function proportionalSplit(amount: number, weights: { id: string; weight: number }[]): Record<string, number> {
  const positive = weights.filter((row) => row.weight > 0)
  const total = positive.reduce((sum, row) => sum + row.weight, 0)
  const split: Record<string, number> = Object.fromEntries(weights.map((row) => [row.id, 0]))
  if (total <= 0 || amount === 0) return split
  const cents = Math.round(amount * 100)
  let assigned = 0
  for (const row of positive) {
    const share = Math.trunc((cents * row.weight) / total)
    split[row.id] = share / 100
    assigned += share
  }
  const heaviest = positive.reduce((best, row) => (row.weight > best.weight ? row : best))
  split[heaviest.id] = roundMoney(split[heaviest.id] + (cents - assigned) / 100)
  return split
}

/** Money recorded with Fijar saldo. It is part of the apartado and not part of the bank. */
export function openingBalance(bucketId: string, moves: BucketMove[]): number {
  return roundMoney(moves.filter((move) => move.bucket_id === bucketId && move.source === 'opening').reduce((sum, move) => sum + move.amount, 0))
}

/** The part reserved from bank, cash, or Saldo sin origen: Apartar, income rules, and moves between apartados. */
export function reservedBalance(bucket: SavingsBucket, moves: BucketMove[]): number {
  return roundMoney(bucketBalance(bucket, moves) - openingBalance(bucket.uuid, moves))
}

export function bucketsInLiquid(buckets: SavingsBucket[], moves: BucketMove[], accounts: Account[]): number {
  return roundMoney(
    buckets
      .filter((bucket) => isHeldInLiquid(bucket, accounts))
      .reduce((sum, bucket) => sum + Math.max(0, reservedBalance(bucket, moves)), 0),
  )
}

/** Gap to append as one opening move. Refuses a total under the reserved part. */
export function fijarGap(balance: number, reserved: number, nextTotal: number): { gap: number } | { error: 'below_reserved' } {
  if (nextTotal < reserved) return { error: 'below_reserved' }
  return { gap: roundMoney(nextTotal - balance) }
}

/** Fijar saldo on an apartado in a savings account: a higher total claims the account's unassigned pesos first, then adds the rest. */
export function fijarInAccountSplit(gap: number, unassigned: number): { fromUnassigned: number; added: number } {
  if (gap <= 0) return { fromUnassigned: 0, added: 0 }
  const fromUnassigned = roundMoney(Math.min(gap, Math.max(0, unassigned)))
  return { fromUnassigned, added: roundMoney(gap - fromUnassigned) }
}

/** Reserved pesos are released first. Only what remains comes out of the opening part. */
export function withdrawSplit(reserved: number, amount: number): { fromReserved: number; fromOpening: number } {
  const fromReserved = roundMoney(Math.min(Math.max(0, reserved), amount))
  return { fromReserved, fromOpening: roundMoney(amount - fromReserved) }
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
    .filter((move) => move.amount > 0 && move.source !== 'bucket_transfer' && move.source !== 'opening' && !move.reverses_id)
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
    if (bucket.archived || !account || account.archived || isLiquid(account) || account.uuid === payFrom.uuid) return []
    const amount = roundMoney(Math.min(needed, bucketBalance(bucket, moves), account.current_balance))
    return amount > 0 ? [{ bucket, account, amount }] : []
  })
}

export function bucketHistory(bucket: SavingsBucket, moves: BucketMove[]): BucketMove[] {
  return moves
    .filter((move) => move.bucket_id === bucket.uuid)
    .sort((a, b) => b.date.localeCompare(a.date) || b.updated_at.localeCompare(a.updated_at))
}
