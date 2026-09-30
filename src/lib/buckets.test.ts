import { describe, expect, test } from 'bun:test'
import type { Account, BucketMove, RecurringItem, SavingsBucket } from '../db/types'
import {
  bucketBalance,
  bucketHistory,
  bucketsInAccount,
  bucketsInLiquid,
  fijarGap,
  fijarInAccountSplit,
  homeAccount,
  incomeEventsUntil,
  isHeldInLiquid,
  openingBalance,
  proportionalSplit,
  reservedBalance,
  setAsideThisCycle,
  targetPace,
  unassignedIn,
  withdrawSplit,
} from './buckets'
import { computeRealAvailable } from './realAvailable'

const stamp = '2026-09-01T00:00:00.000Z'

const account = (uuid: string, type: Account['type'], balance: number): Account => ({
  uuid,
  updated_at: stamp,
  name: uuid,
  type,
  currency: 'MXN',
  current_balance: balance,
  balance_date: '2026-09-01',
})

const bucket = (uuid: string, rule_type: SavingsBucket['rule_type'], account_id: string | null = null): SavingsBucket => ({
  uuid,
  updated_at: stamp,
  name: uuid,
  rule_type,
  target: null,
  account_id,
})

const move = (bucket_id: string, amount: number, date: string, updated_at = stamp): BucketMove => ({
  uuid: `${bucket_id}-${date}-${amount}`,
  updated_at,
  bucket_id,
  amount,
  date,
  reason: '',
  source: 'manual',
})

const bank = account('bank', 'checking', 20000)
const savings = account('savings', 'savings', 5000)

describe('buckets', () => {
  const emergency = bucket('emergency', 'emergency')
  const retirement = bucket('retirement', 'retirement', savings.uuid)
  const moves = [move('emergency', 3000, '2026-09-01'), move('emergency', -500, '2026-09-10'), move('retirement', 4000, '2026-09-02')]

  test('balance is the sum of its moves', () => {
    expect(bucketBalance(emergency, moves)).toBe(2500)
    expect(bucketBalance(retirement, moves)).toBe(4000)
  })

  test('a bucket with no account or a non-savings account is held in liquid', () => {
    expect(isHeldInLiquid(emergency, [bank, savings])).toBe(true)
    expect(isHeldInLiquid(bucket('b', 'travel', bank.uuid), [bank, savings])).toBe(true)
    expect(isHeldInLiquid(retirement, [bank, savings])).toBe(false)
  })

  test('only liquid buckets reduce Real Available', () => {
    const held = bucketsInLiquid([emergency, retirement], moves, [bank, savings])
    expect(held).toBe(2500)
    const result = computeRealAvailable({ accounts: [bank, savings], cards: [], buffer: 1000, bucketsInLiquid: held })
    expect(result.total).toBe(20000 - 2500 - 1000)
  })

  test('a negative bucket never adds to Real Available', () => {
    expect(bucketsInLiquid([emergency], [move('emergency', -100, '2026-09-01')], [bank])).toBe(0)
  })

  test('opening money counts in the apartado and not in Real Available', () => {
    const opening = { ...move('emergency', 6000, '2026-09-03'), source: 'opening' as const }
    const all = [...moves, opening]
    expect(bucketBalance(emergency, all)).toBe(8500)
    expect(openingBalance(emergency.uuid, all)).toBe(6000)
    expect(reservedBalance(emergency, all)).toBe(2500)
    expect(bucketsInLiquid([emergency], all, [bank])).toBe(2500)
    expect(fijarGap(8500, 2500, 9000)).toEqual({ gap: 500 })
    expect(fijarGap(8500, 2500, 2000)).toEqual({ error: 'below_reserved' })
    expect(fijarGap(8500, 2500, 2500)).toEqual({ gap: -6000 })
    expect(withdrawSplit(2500, 3000)).toEqual({ fromReserved: 2500, fromOpening: 500 })
    expect(withdrawSplit(0, 400)).toEqual({ fromReserved: 0, fromOpening: 400 })
    expect(bucketsInLiquid([retirement], [{ ...move('retirement', 1000, '2026-09-01'), source: 'opening' }], [savings])).toBe(0)
  })

  test('history is newest first', () => {
    expect(bucketHistory(emergency, moves).map((m) => m.amount)).toEqual([-500, 3000])
  })
})

describe('apartados in a savings account', () => {
  const gbm = account('gbm', 'savings', 5000)
  const trips = bucket('trips', 'travel', gbm.uuid)
  const car = bucket('car', 'custom', gbm.uuid)
  const old = { ...bucket('old', 'custom', gbm.uuid), archived: true }
  const inBank = bucket('inBank', 'custom', bank.uuid)

  test('the home account is the savings account, never bank or cash', () => {
    expect(homeAccount(trips, [bank, gbm])?.uuid).toBe('gbm')
    expect(homeAccount(inBank, [bank, gbm])).toBeUndefined()
    expect(homeAccount(bucket('x', 'custom'), [bank, gbm])).toBeUndefined()
  })

  test('sin apartar is the account balance minus its active apartados', () => {
    const moves = [move('trips', 3000, '2026-09-01'), move('car', 1500, '2026-09-02'), move('old', 900, '2026-09-03')]
    expect(bucketsInAccount(gbm.uuid, [trips, car, old, inBank], moves).map((row) => row.balance)).toEqual([3000, 1500])
    expect(unassignedIn(gbm, [trips, car, old], moves)).toBe(500)
    expect(unassignedIn({ ...gbm, current_balance: 0 }, [trips], [move('trips', 5000, '2026-09-01')])).toBe(-5000)
  })

  test('a deposit from the bank lowers Real Available once', () => {
    const before = computeRealAvailable({ accounts: [bank, { ...gbm, current_balance: 0 }], cards: [], buffer: 0, bucketsInLiquid: 0 }).total
    const accounts = [{ ...bank, current_balance: 18000 }, { ...gbm, current_balance: 2000 }]
    const held = bucketsInLiquid([trips], [move('trips', 2000, '2026-09-01')], accounts)
    const after = computeRealAvailable({ accounts, cards: [], buffer: 0, bucketsInLiquid: held }).total
    expect(held).toBe(0)
    expect(before - after).toBe(2000)
  })

  test('fijar claims unassigned pesos before raising the account', () => {
    expect(fijarInAccountSplit(5000, 0)).toEqual({ fromUnassigned: 0, added: 5000 })
    expect(fijarInAccountSplit(5000, 1200)).toEqual({ fromUnassigned: 1200, added: 3800 })
    expect(fijarInAccountSplit(500, 1200)).toEqual({ fromUnassigned: 500, added: 0 })
    expect(fijarInAccountSplit(5000, -300)).toEqual({ fromUnassigned: 0, added: 5000 })
    expect(fijarInAccountSplit(-400, 1200)).toEqual({ fromUnassigned: 0, added: 0 })
  })

  test('interest splits by balance in cents and the remainder lands on the largest apartado', () => {
    expect(proportionalSplit(120, [{ id: 'trips', weight: 3000 }, { id: 'car', weight: 1500 }])).toEqual({ trips: 80, car: 40 })
    expect(proportionalSplit(100, [{ id: 'a', weight: 1 }, { id: 'b', weight: 1 }, { id: 'c', weight: 1 }])).toEqual({ a: 33.34, b: 33.33, c: 33.33 })
    expect(proportionalSplit(-90, [{ id: 'a', weight: 2000 }, { id: 'b', weight: 1000 }])).toEqual({ a: -60, b: -30 })
    expect(proportionalSplit(50, [{ id: 'a', weight: 0 }, { id: 'b', weight: 400 }])).toEqual({ a: 0, b: 50 })
    expect(proportionalSplit(50, [{ id: 'a', weight: 0 }])).toEqual({ a: 0 })
  })
})

describe('target pace', () => {
  const payday = (uuid: string, due_day: number): RecurringItem => ({
    uuid,
    updated_at: stamp,
    name: uuid,
    type: 'income',
    amount: null,
    due_day,
    account_id: null,
    category_id: null,
    start_date: '2026-01-01',
    active: true,
  })
  const paydays = [payday('mid', 15), payday('late', 30)]
  const today = new Date(2026, 8, 29, 12)
  const car = { ...bucket('car', 'custom'), target: 10000, target_date: '2026-11-30' }

  test('counts paydays after today up to and including the target date', () => {
    expect(incomeEventsUntil(paydays, today, new Date(2026, 10, 30, 12))).toBe(5)
    expect(incomeEventsUntil(paydays, new Date(2026, 8, 30, 12), new Date(2026, 10, 30, 12))).toBe(4)
  })

  test('splits what is missing across the paydays left', () => {
    expect(targetPace(car, 2000, paydays, today)).toEqual({ remaining: 8000, events: 5, perIncome: 1600, overdue: false })
  })

  test('without paydays it assumes one income every 15 days', () => {
    expect(incomeEventsUntil([], today, new Date(2026, 9, 29, 12))).toBe(2)
  })

  test('a past date with money missing is overdue; a reached target is not', () => {
    const past = { ...car, target_date: '2026-09-01' }
    expect(targetPace(past, 2000, paydays, today)).toMatchObject({ overdue: true, perIncome: null })
    expect(targetPace(past, 10000, paydays, today)).toMatchObject({ remaining: 0, overdue: false })
  })

  test('set aside this cycle counts deposits since the last payday, not moves between buckets', () => {
    const move = (uuid: string, amount: number, date: string, extra = {}) =>
      ({ uuid, updated_at: '', bucket_id: 'car', amount, date, reason: '', source: 'manual', ...extra }) as BucketMove
    const moves = [
      move('old', 900, '2026-09-14'),
      move('a', 500, '2026-09-15'),
      move('b', 300, '2026-09-20', { source: 'bucket_transfer' }),
      move('c', -200, '2026-09-21'),
      move('d', 250, '2026-09-22', { reverses_id: 'x' }),
      move('e', 700, '2026-09-28'),
    ]
    const result = setAsideThisCycle(car, moves, paydays, today)
    expect(result.since.getDate()).toBe(15)
    expect(result.amount).toBe(1200)
    expect(result.required).toBe(1516.67)
  })

  test('no target or no date means no pace', () => {
    expect(targetPace({ ...car, target_date: null }, 0, paydays, today)).toBeNull()
    expect(targetPace({ ...car, target: null }, 0, paydays, today)).toBeNull()
  })
})
