import { describe, expect, test } from 'bun:test'
import type { Account, BucketMove, SavingsBucket, Transaction } from '../db/types'
import { bucketFundingOptions } from './buckets'
import { cashReviewDue } from './reconcile'

const stamp = '2026-09-01T00:00:00.000Z'

const account = (uuid: string, type: Account['type'], balance: number, balance_date = '2026-09-01'): Account => ({
  uuid,
  updated_at: stamp,
  name: uuid,
  type,
  currency: 'MXN',
  current_balance: balance,
  balance_date,
})

const bucket = (uuid: string, account_id: string | null): SavingsBucket => ({
  uuid,
  updated_at: stamp,
  name: uuid,
  rule_type: 'custom',
  target: null,
  account_id,
})

const move = (bucket_id: string, amount: number): BucketMove => ({
  uuid: `${bucket_id}-${amount}`,
  updated_at: stamp,
  bucket_id,
  amount,
  date: '2026-09-01',
  reason: '',
  source: 'manual',
})

describe('cash review', () => {
  const cash = account('cash', 'cash', 800)
  const today = new Date(2026, 8, 29, 12)

  test('is due a week after the last review', () => {
    expect(cashReviewDue([cash], [], { cash_reviewed_at: '2026-09-22' }, today)).toHaveLength(1)
    expect(cashReviewDue([cash], [], { cash_reviewed_at: '2026-09-23' }, today)).toHaveLength(0)
  })

  test('a cash adjustment counts as a review', () => {
    const adjusted = { type: 'adjustment', account_id: 'cash', date: '2026-09-25' } as Transaction
    expect(cashReviewDue([cash], [adjusted], null, today)).toHaveLength(0)
  })

  test('only active cash accounts are reviewed', () => {
    expect(cashReviewDue([account('bank', 'checking', 1000), { ...cash, archived: true }], [], null, today)).toHaveLength(0)
  })

  test('a new cash account waits a week from its balance date', () => {
    expect(cashReviewDue([account('cash', 'cash', 800, '2026-09-28')], [], null, today)).toHaveLength(0)
  })
})

describe('bucket funding for a card payment', () => {
  const bank = account('bank', 'checking', 1000)
  const savings = account('savings', 'savings', 3000)
  const buckets = [bucket('retiro', 'savings'), bucket('viajes', null), bucket('auto', 'bank')]
  const moves = [move('retiro', 5000), move('viajes', 2000), move('auto', 500)]

  test('only buckets held in a savings account can bring money over', () => {
    const options = bucketFundingOptions(buckets, moves, [bank, savings], bank, 2500)
    expect(options.map((o) => [o.bucket.uuid, o.amount])).toEqual([['retiro', 2500]])
  })

  test('the offer is capped by the bucket and by the savings account', () => {
    expect(bucketFundingOptions(buckets, moves, [bank, savings], bank, 9000)[0].amount).toBe(3000)
    expect(bucketFundingOptions(buckets, [move('retiro', 400)], [bank, savings], bank, 9000)[0].amount).toBe(400)
  })

  test('nothing is offered when the bank covers the payment', () => {
    expect(bucketFundingOptions(buckets, moves, [bank, savings], bank, 0)).toEqual([])
  })
})
