import { describe, expect, test } from 'bun:test'
import type { Account, BucketMove, CreditCard, PlanItem, PlannedContribution, RecurringItem, SavingsBucket, Settings, Transaction } from '../db/types'
import type { MoneyData } from '../db/useMoneyData'
import { roundMoney } from './money'
import { cardDrawsLeft, planDelta, projectPlan, type PlanInput } from './plan'
import { projectedAvailable } from './projection'
import { projectedAvailable } from './projection'

const base = { updated_at: '2026-09-01T00:00:00.000Z' }
const bank: Account = { ...base, uuid: 'bbva', name: 'BBVA', type: 'checking', currency: 'MXN', current_balance: 10000, balance_date: '2026-09-01' }
const recurring = (uuid: string, type: RecurringItem['type'], due_day: number, amount: number): RecurringItem => ({
  ...base,
  uuid,
  name: uuid,
  type,
  amount,
  due_day,
  account_id: 'bbva',
  category_id: null,
  start_date: '2026-01-01',
  active: true,
})
const bucket = (uuid: string, rule_type: SavingsBucket['rule_type'], extra: Partial<SavingsBucket> = {}): SavingsBucket => ({
  ...base,
  uuid,
  name: uuid,
  rule_type,
  target: null,
  account_id: null,
  ...extra,
})
const card: CreditCard = { ...base, uuid: 'tdc', name: 'TDC', limit: 50000, current_balance: 0, statement_day: 10, due_day: 25, payment_strategy: 'full' }

function data(extra: Partial<MoneyData> = {}): MoneyData {
  return {
    loaded: true,
    accounts: [bank],
    cards: [card],
    categories: [],
    transactions: [],
    recurring: [recurring('q1', 'income', 15, 20000), recurring('q2', 'income', 30, 20000), recurring('rent', 'bill', 1, 8000)],
    overrides: [],
    loans: [],
    installments: [],
    buckets: [bucket('retiro', 'retirement'), bucket('viajes', 'travel'), bucket('emergencia', 'emergency')],
    bucketMoves: [],
    budgets: [],
    settings: { buffer_mxn: 1000 } as Settings,
    lines: [],
    items: [],
    places: [],
    ...extra,
  }
}

let order = 0
const wish = (fields: Partial<PlanItem>): PlanItem => ({
  ...base,
  uuid: `wish-${++order}`,
  name: 'Deseo',
  amount: 0,
  target_date: null,
  enabled: true,
  sort_order: order,
  payment_method: 'bank',
  card_id: null,
  msi_months: null,
  category_id: null,
  bucket_draws: [],
  status: 'planned',
  tx_id: null,
  notes: '',
  source: 'manual',
  ...fields,
})

const today = new Date(2026, 8, 29, 12)
const on = (month: number, day: number) => new Date(2026, month - 1, day, 12)
const input = (fields: Partial<PlanInput> = {}): PlanInput => ({ items: [], contributions: [], includeRules: false, ...fields })
const at = (result: ReturnType<typeof projectPlan>, date: Date) => result.points.find((p) => p.date.getTime() === date.getTime())!

describe('plan', () => {
  test('without wishes or contributions it is the plain projection', () => {
    const result = projectPlan(data(), today, input())
    for (const point of result.points) expect(point.available).toBe(projectedAvailable(data(), today, point.date))
    expect(at(result, today).available).toBe(9000)
  })

  test('the second income projects Retiro and Viajes, which leave Disponible real and fill the apartados', () => {
    const result = projectPlan(data(), today, input({ includeRules: true }))
    expect(at(result, on(9, 30)).available).toBe(21000 - 4000 - 5000)
    expect(result.buckets.find((b) => b.bucket.uuid === 'retiro')!.contributed).toBeGreaterThanOrEqual(4000)
    expect(result.contributions.filter((c) => c.date.getTime() === on(9, 30).getTime()).map((c) => c.amount)).toEqual([4000, 5000])
  })

  test('rule contributions fit what is left, custom shares first to go', () => {
    const tight = data({
      accounts: [{ ...bank, current_balance: -9000 }],
      buckets: [bucket('retiro', 'retirement'), bucket('viajes', 'travel'), bucket('auto', 'custom', { income_share: { income: 'second', amount: 2000 } })],
    })
    const result = projectPlan(tight, today, input({ includeRules: true }))
    expect(result.contributions.filter((c) => c.date.getTime() === on(9, 30).getTime()).map((c) => [c.bucketId, c.amount])).toEqual([
      ['retiro', 2000],
    ])
  })

  test('a draw lowers what the wish takes from Disponible real', () => {
    const laptop = wish({ amount: 15000, target_date: '2026-10-05', bucket_draws: [{ bucket_id: 'viajes', amount: 3000 }] })
    const result = projectPlan(data(), today, input({ includeRules: true, items: [laptop] }))
    const item = result.items[0]
    expect(item.fromBuckets).toBe(3000)
    expect(item.before).toBe(12000)
    expect(item.after).toBe(0)
    expect(item.status).toBe('tight')
    expect(result.buckets.find((b) => b.bucket.uuid === 'viajes')!.drawn).toBe(3000)
  })

  test('a draw is capped by the projected apartado balance', () => {
    const laptop = wish({ amount: 9000, target_date: '2026-10-05', bucket_draws: [{ bucket_id: 'viajes', amount: 8000 }] })
    const item = projectPlan(data(), today, input({ includeRules: true, items: [laptop] })).items[0]
    expect(item.draws[0].granted).toBe(5000)
    expect(item.drawCapped).toBe(true)
    expect(item.after).toBe(12000 - 4000)
  })

  test('lo antes posible lands on the first payday that keeps every later one above zero', () => {
    const bike = wish({ amount: 30000 })
    const item = projectPlan(data(), today, input({ items: [bike] })).items[0]
    expect(item.asap).toBe(true)
    expect(item.date).toEqual(on(10, 15))
    expect(item.lowest!.available).toBeGreaterThanOrEqual(0)
  })

  test('each wish sees the ones above it, never the ones below', () => {
    const first = wish({ amount: 15000, target_date: '2026-10-05' })
    const second = wish({ amount: 10000, target_date: '2026-10-05' })
    const result = projectPlan(data(), today, input({ items: [second, first].map((w, i) => ({ ...w, sort_order: i === 0 ? 2 : 1 })) }))
    expect(result.items.map((r) => r.item.uuid)).toEqual([first.uuid, second.uuid])
    expect(result.items[0].status).not.toBe('short')
    expect(result.items[1].before).toBe(21000 - 15000)
    expect(result.items[1].status).toBe('short')
    expect(result.items[1].short).toBe(4000)
  })

  test('disabled, dropped, and bought wishes do not count', () => {
    const tx = { uuid: 'bought', type: 'expense', date: '2026-09-20', amount: 500 } as never
    const items = [
      wish({ amount: 5000, target_date: '2026-10-05', enabled: false }),
      wish({ amount: 5000, target_date: '2026-10-05', status: 'dropped' }),
      wish({ amount: 5000, target_date: '2026-10-05', tx_id: 'bought' }),
    ]
    const result = projectPlan(data({ transactions: [tx] }), today, input({ items }))
    expect(result.items).toHaveLength(0)
  })

  test('a planned contribution stops at the apartado target', () => {
    const auto = bucket('auto', 'custom', { target: 1500 })
    const planned: PlannedContribution = { ...base, uuid: 'p', bucket_id: 'auto', amount: 1000, income_slot: 'both', enabled: true }
    const result = projectPlan(data({ buckets: [auto] }), today, input({ contributions: [planned] }))
    const row = result.buckets.find((b) => b.bucket.uuid === 'auto')!
    expect(row.contributed).toBe(1500)
    expect(row.reachedOn).toEqual(on(10, 15))
    expect(at(result, on(9, 30)).available).toBe(21000 - 1000)
  })

  test('with a card and MSI, the draw covers the charges as they post', () => {
    const phone = wish({
      amount: 6000,
      target_date: '2026-10-05',
      payment_method: 'credit_card',
      card_id: 'tdc',
      msi_months: 3,
      bucket_draws: [{ bucket_id: 'viajes', amount: 2000 }],
    })
    const withRules = projectPlan(data(), today, input({ includeRules: true, items: [phone] }))
    const item = withRules.items[0]
    expect(item.after).toBe(item.before)
    expect(at(withRules, on(10, 15)).available).toBe(at(withRules, on(10, 15)).base - 2000)
    expect(item.card!.debtAfter).toBe(6000)
  })

  test('the daily delta is the gap between the plan and the projection without wishes', () => {
    const laptop = wish({ amount: 15000, target_date: '2026-10-05', bucket_draws: [{ bucket_id: 'viajes', amount: 3000 }] })
    const result = projectPlan(data(), today, input({ includeRules: true, items: [laptop] }))
    for (const point of result.points) {
      expect(roundMoney(projectedAvailable(data(), today, point.date) + planDelta(result, point.date))).toBe(point.available)
    }
    expect(planDelta(result, today)).toBe(0)
  })

  test('a bought card wish still has the draw that the purchase did not use', () => {
    const phone = wish({
      payment_method: 'credit_card',
      card_id: 'tdc',
      tx_id: 'bought',
      bucket_draws: [{ bucket_id: 'viajes', amount: 2000 }],
    })
    const tx = { uuid: 'bought', plan_item_id: phone.uuid } as Transaction
    const move = { uuid: 'm', bucket_id: 'viajes', amount: -500, tx_id: 'bought' } as BucketMove
    expect(cardDrawsLeft([phone], [tx], [move])).toEqual([{ item: phone, bucketId: 'viajes', cardId: 'tdc', left: 1500 }])
    const back = { uuid: 'back', bucket_id: 'viajes', amount: 500, reverses_id: 'm' } as BucketMove
    expect(cardDrawsLeft([phone], [tx], [move, back])[0].left).toBe(2000)
  })
})
