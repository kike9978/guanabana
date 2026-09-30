import { describe, expect, test } from 'bun:test'
import type { Category, RecurringItem, SavingsBucket, Transaction } from '../db/types'
import { customShares, fitInOrder, incomeRank, isRuleIncome, planFirstIncome, planSecondIncome, scheduledIncomeMatches } from './incomeRules'

const stamp = '2026-09-01T00:00:00.000Z'

const slot = (uuid: string, due_day: number): RecurringItem => ({
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

const main: Category = { uuid: 'main', updated_at: stamp, key: 'contract_income', name: 'Ingreso principal', kind: 'income' }
const repay: Category = { uuid: 'repay', updated_at: stamp, key: 'loan_repayment', name: 'Cobro de préstamo', kind: 'income' }

const income = (date: string, fields: Partial<Transaction> = {}) =>
  ({ type: 'income', date, category_id: 'main', recurring_id: null, ...fields }) as const

const slots = [slot('late', 30), slot('mid', 15)]

describe('income rank', () => {
  test('the earlier payday is the first income, the later one the second', () => {
    expect(incomeRank(income('2026-09-15'), slots)).toBe('first')
    expect(incomeRank(income('2026-09-30'), slots)).toBe('second')
  })

  test('an income a couple of days off still matches the nearest payday', () => {
    expect(incomeRank(income('2026-09-13'), slots)).toBe('first')
    expect(incomeRank(income('2026-10-01'), slots)).toBe('second')
  })

  test('a linked recurring income uses its own slot', () => {
    expect(incomeRank(income('2026-09-20', { recurring_id: 'late' }), slots)).toBe('second')
  })

  test('one payday a month is always the first income, no schedule means ask', () => {
    expect(incomeRank(income('2026-09-28'), [slot('only', 1)])).toBe('first')
    expect(incomeRank(income('2026-09-28'), [])).toBeNull()
  })

  test('only the main income or a scheduled income triggers the rules', () => {
    expect(isRuleIncome(income('2026-09-15'), [main, repay], [])).toBe(true)
    expect(isRuleIncome(income('2026-09-15', { category_id: 'repay' }), [main, repay], [])).toBe(false)
    expect(isRuleIncome(income('2026-09-15', { category_id: 'repay', recurring_id: 'mid' }), [main, repay], slots)).toBe(true)
  })
})

describe('first-income rule', () => {
  test('the leftover is what was there before this income, minus reserved money and card debt', () => {
    const plan = planFirstIncome({ liquid: 30000, income: 20000, reserved: 2000, cardReserve: 3000 })
    expect(plan.remainder).toBe(5000)
    expect(plan.suggested).toBe(5000)
  })

  test('a negative leftover suggests nothing', () => {
    const plan = planFirstIncome({ liquid: 18000, income: 20000, reserved: 0, cardReserve: 0 })
    expect(plan.remainder).toBe(-2000)
    expect(plan.suggested).toBe(0)
  })
})

describe('second-income rule', () => {
  test('retirement is a share of the income, travel is capped by what is left of it', () => {
    const plan = planSecondIncome({ income: 20000, retirementPct: 0.2, travelMax: 5000, available: 15000 })
    expect(plan.retirement).toBe(4000)
    expect(plan.travel).toBe(5000)
    expect(plan.short).toBe(0)
  })

  test('a small income caps travel at what remains', () => {
    const plan = planSecondIncome({ income: 5000, retirementPct: 0.2, travelMax: 5000, available: 10000 })
    expect(plan.travel).toBe(4000)
  })

  test('short when the moves exceed Real Available, and fitting lowers travel first', () => {
    const plan = planSecondIncome({ income: 20000, retirementPct: 0.2, travelMax: 5000, available: 6000 })
    expect(plan.short).toBe(3000)
    expect(fitInOrder([plan.retirement, plan.travel], 6000)).toEqual([4000, 2000])
    expect(fitInOrder([plan.retirement, plan.travel], 3000)).toEqual([3000, 0])
    expect(fitInOrder([plan.retirement, plan.travel], -500)).toEqual([0, 0])
  })

  test('custom buckets join the rule of their income, and fitting cuts them after the system buckets', () => {
    const custom = (uuid: string, sort_order: number, income_share: SavingsBucket['income_share'], archived = false) =>
      ({ uuid, updated_at: stamp, name: uuid, rule_type: 'custom', target: null, account_id: null, sort_order, archived, income_share }) as SavingsBucket
    const buckets = [
      custom('gifts', 2, { income: 'both', amount: 300 }),
      custom('car', 1, { income: 'second', amount: 1000 }),
      custom('pet', 3, { income: 'first', amount: 200 }),
      custom('old', 4, { income: 'both', amount: 500 }, true),
      custom('none', 5, null),
      { ...custom('travel', 0, { income: 'both', amount: 900 }), rule_type: 'travel' } as SavingsBucket,
    ]
    expect(customShares(buckets, 'second').map((s) => [s.bucket.uuid, s.amount])).toEqual([['car', 1000], ['gifts', 300]])
    expect(customShares(buckets, 'first').map((s) => s.bucket.uuid)).toEqual(['gifts', 'pet'])
    expect(fitInOrder([4000, 1000, 1000, 300], 5500)).toEqual([4000, 1000, 500, 0])
  })
})

describe('scheduled income link', () => {
  const recorded = { uuid: 'tx1', recurring_id: 'mid', occurrence: '2026-09-15' } as Transaction

  test('suggests the nearest unrecorded payday first', () => {
    const matches = scheduledIncomeMatches(slots, [], '2026-09-14')
    expect(matches[0]).toMatchObject({ item: { uuid: 'mid' }, occurrence: '2026-09-15' })
  })

  test('skips paydays that already have an income, unless it is the one being edited', () => {
    expect(scheduledIncomeMatches(slots, [recorded], '2026-09-14').some((m) => m.occurrence === '2026-09-15')).toBe(false)
    expect(scheduledIncomeMatches(slots, [recorded], '2026-09-14', 'tx1')[0].occurrence).toBe('2026-09-15')
  })

  test('ignores paydays far from the date', () => {
    expect(scheduledIncomeMatches([slot('mid', 15)], [], '2026-09-01')).toEqual([])
  })
})
