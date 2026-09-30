import { describe, expect, test } from 'bun:test'
import type { Loan, LoanInstallment, RecurringItem, Transaction } from '../db/types'
import { slotDays } from './incomeRules'
import { buildSchedule, editOpenRows, incomeDueDates, incomePaydayDates, incomePeriodsPerYear, isUnscheduled, loanStatusAfterPayment, outstanding, periodsFromDates, planExtraPayment, summarizeLoan } from './loans'

const base = { updated_at: '2026-09-01T00:00:00.000Z' }

const loan = {
  ...base,
  uuid: 'l',
  name: 'Auto',
  direction: 'borrowed',
  status: 'active',
  principal: 12000,
  interest: 'none',
  rate_annual: null,
  installment_amount: null,
  frequency: 'monthly',
  pay_from_account_id: 'bbva',
} as Loan

function schedule(target: Loan, count: number, settled = 0): LoanInstallment[] {
  return buildSchedule({ ...target, first_due_date: '2026-10-05', installment_count: count }).map((row, index) => ({
    ...base,
    ...row,
    uuid: `r${index}`,
    loan_id: target.uuid,
    status: index < settled ? 'settled' : 'scheduled',
  }))
}

describe('loans already in progress', () => {
  test('settled installments count as paid without a transaction', () => {
    const summary = summarizeLoan(loan, schedule(loan, 12, 4), [])
    expect(summary.remaining).toBe(8000)
    expect(summary.installmentsLeft).toBe(8)
    expect(summary.next?.uuid).toBe('r4')
  })
})

describe('extra payments', () => {
  const rows = schedule(loan, 12)
  const paid = [{ loan_installment_id: 'r0' }] as Transaction[]

  test('shorten keeps the installment and drops rows at the end', () => {
    const plan = planExtraPayment(loan, rows, paid, 3000, 'shorten')
    expect(plan.remaining).toBe(8000)
    expect(plan.replaced).toHaveLength(11)
    expect(plan.rows).toHaveLength(8)
    expect(plan.rows[0]).toMatchObject({ due_date: '2026-11-05', amount: 1000 })
    expect(plan.rows.at(-1)?.due_date).toBe('2027-06-05')
  })

  test('lower keeps the dates and spreads the rest', () => {
    const plan = planExtraPayment(loan, rows, paid, 2200, 'lower')
    expect(plan.rows).toHaveLength(11)
    expect(plan.rows[0].amount).toBe(800)
    expect(plan.rows.at(-1)?.due_date).toBe('2027-09-05')
  })

  test('the remaining counts the extra payment', () => {
    const extra = { loan_extra_id: 'l', amount: 3000 } as Transaction
    expect(summarizeLoan(loan, rows, [...paid, extra]).remaining).toBe(8000)
  })

  test('paying everything leaves no pending rows', () => {
    const plan = planExtraPayment(loan, rows, paid, 11000, 'shorten')
    expect(plan.rows).toEqual([])
    expect(plan.remaining).toBe(0)
  })

  test('fixed-rate shorten keeps roughly the same payment', () => {
    const rated = { ...loan, interest: 'fixed_rate', rate_annual: 24 } as Loan
    const rated_rows = schedule(rated, 12)
    const before = rated_rows[1].amount
    const plan = planExtraPayment(rated, rated_rows, paid, 4000, 'shorten')
    expect(plan.rows.length).toBeLessThan(11)
    expect(plan.rows[0].amount).toBeLessThanOrEqual(before)
    const principal = plan.rows.reduce((sum, row) => sum + row.principal_part, 0)
    expect(Math.round(principal * 100) / 100).toBe(plan.remaining)
  })
})

describe('loans without dates', () => {
  const family = { ...loan, uuid: 'mom', frequency: 'unscheduled', installment_count: 0, principal: 5000 } as Loan

  test('the balance is the whole principal until an abono lowers it', () => {
    expect(isUnscheduled(family)).toBe(true)
    expect(summarizeLoan(family, [], []).remaining).toBe(5000)
    const abono = { loan_extra_id: 'mom', amount: 1200 } as Transaction
    const summary = summarizeLoan(family, [], [abono])
    expect(summary).toMatchObject({ remaining: 3800, paid: 1200, next: undefined, payoffDate: undefined })
  })

  test('an abono never creates installments', () => {
    const plan = planExtraPayment(family, [], [], 2000, 'shorten')
    expect(plan).toEqual({ remaining: 3000, replaced: [], rows: [] })
  })

  test('outstanding adds only active loans in one direction', () => {
    const lent = { ...family, uuid: 'sis', direction: 'lent' } as Loan
    const lost = { ...lent, uuid: 'friend', status: 'written_off' } as Loan
    const loans = [family, lent, lost]
    expect(outstanding('borrowed', loans, [], [])).toBe(5000)
    expect(outstanding('lent', loans, [], [{ loan_extra_id: 'sis', amount: 500 } as Transaction])).toBe(4500)
  })
})

describe('editing the open schedule', () => {
  const rows = schedule(loan, 12, 2)
  const open = rows.slice(2)

  test('a new date changes only that row', () => {
    const edit = editOpenRows(loan, open, 10000, { r3: { due_date: '2026-12-20' } })
    expect(edit.problem).toBeNull()
    expect(edit.changed).toHaveLength(1)
    expect(edit.changed[0]).toMatchObject({ uuid: 'r3', due_date: '2026-12-20', amount: 1000 })
  })

  test('without interest, moving money between rows keeps the principal whole', () => {
    const edit = editOpenRows(loan, open, 10000, { r2: { amount: 1500 }, r3: { amount: 500 } })
    expect(edit.problem).toBeNull()
    expect(edit.changed.map((row) => row.principal_part)).toEqual([1500, 500])
  })

  test('without interest, a total that no longer matches the remaining is blocked', () => {
    const edit = editOpenRows(loan, open, 10000, { r2: { amount: 1500 } })
    expect(edit.problem).toEqual({ kind: 'total', principal: 10500, remaining: 10000 })
  })

  test('a fixed installment changes interest, never below its principal', () => {
    const fixed = { ...loan, interest: 'fixed_installment', installment_amount: 1200 } as Loan
    const fixedOpen = schedule(fixed, 12).slice(2)
    const higher = editOpenRows(fixed, fixedOpen, 10000, { r2: { amount: 1300 } })
    expect(higher.problem).toBeNull()
    expect(higher.changed[0]).toMatchObject({ principal_part: 1000, interest_part: 300 })
    expect(editOpenRows(fixed, fixedOpen, 10000, { r2: { amount: 900 } }).problem).toEqual({ kind: 'below_principal', principal: 1000 })
  })

  test('an annual rate keeps its amounts', () => {
    const rated = { ...loan, interest: 'fixed_rate', rate_annual: 24 } as Loan
    const ratedOpen = schedule(rated, 12)
    const edit = editOpenRows(rated, ratedOpen, 12000, { r0: { amount: 50, due_date: '2026-10-10' } })
    expect(edit.changed[0]).toMatchObject({ due_date: '2026-10-10', amount: ratedOpen[0].amount })
  })

  test('an empty amount or date is blocked', () => {
    expect(editOpenRows(loan, open, 10000, { r2: { amount: null } }).problem).toEqual({ kind: 'missing' })
    expect(editOpenRows(loan, open, 10000, { r2: { due_date: '' } }).problem).toEqual({ kind: 'missing' })
  })
})

describe('installments tied to income events', () => {
  test('paydays start on or after the first date and clamp to the end of short months', () => {
    expect(incomeDueDates('2026-09-20', [15, 30], 4)).toEqual(['2026-09-30', '2026-10-15', '2026-10-30', '2026-11-15'])
    expect(incomeDueDates('2027-02-01', [30], 2)).toEqual(['2027-02-28', '2027-03-30'])
    expect(incomeDueDates('2026-10-01', [], 3)).toEqual([])
  })

  test('a per-income schedule lands on the chosen payday, and a rate splits by those periods', () => {
    const input = { ...loan, frequency: 'per_income' as const, income_slot: 'second' as const, first_due_date: '2026-10-01', installment_count: 3 }
    expect(buildSchedule(input, [30]).map((row) => row.due_date)).toEqual(['2026-10-30', '2026-11-30', '2026-12-30'])
    const both = { ...input, interest: 'fixed_rate' as const, rate_annual: 24, income_slot: 'both' as const }
    expect(buildSchedule(both, [15, 30])[0].interest_part).toBe(120)
    expect(buildSchedule({ ...both, income_slot: 'first' }, [15])[0].interest_part).toBe(240)
  })

  test('weekly paydays alternate and a rate splits by 26 or 52', () => {
    const friday = { uuid: 'p', type: 'income', active: true, frequency: 'weekly', interval: 1, start_date: '2026-09-04', due_day: 4 } as RecurringItem
    expect(incomePaydayDates([friday], 'both', '2026-10-01', 3)).toEqual(['2026-10-02', '2026-10-09', '2026-10-16'])
    expect(incomePaydayDates([friday], 'first', '2026-10-01', 2)).toEqual(['2026-10-02', '2026-10-16'])
    expect(incomePaydayDates([friday], 'second', '2026-10-01', 2)).toEqual(['2026-10-09', '2026-10-23'])
    expect(incomePeriodsPerYear([friday], 'both')).toBe(52)
    expect(incomePeriodsPerYear([friday], 'first')).toBe(26)
    const everyOther = { ...friday, interval: 2, start_date: '2026-10-09' }
    expect(incomePaydayDates([everyOther], 'both', '2026-10-01', 2)).toEqual(['2026-10-09', '2026-10-23'])
    expect(incomePeriodsPerYear([everyOther], 'both')).toBe(26)
    expect(incomePeriodsPerYear([everyOther], 'second')).toBe(13)

    const input = { ...loan, frequency: 'per_income' as const, income_slot: 'both' as const, interest: 'fixed_rate' as const, rate_annual: 24, first_due_date: '2026-10-01', installment_count: 2 }
    const plan = { dates: incomePaydayDates([friday], 'both', input.first_due_date, 2), periodsPerYear: 52 }
    expect(buildSchedule(input, plan).map((row) => row.due_date)).toEqual(plan.dates)
    expect(buildSchedule(input, plan)[0].interest_part).toBe(55.38)
    expect(periodsFromDates(plan.dates, 12)).toBe(52)
  })

  test('paying the balance off marks the loan paid, and undoing it reopens the loan', () => {
    expect(loanStatusAfterPayment('active', 0)).toBe('paid')
    expect(loanStatusAfterPayment('paid', 400)).toBe('active')
    expect(loanStatusAfterPayment('written_off', 0)).toBe('written_off')
    expect(loanStatusAfterPayment('paused', 0)).toBe('paused')
  })

  test('slot days follow the paydays sorted by day', () => {
    const payday = (uuid: string, due_day: number) => ({ uuid, type: 'income', active: true, due_day }) as RecurringItem
    const recurring = [payday('late', 30), payday('mid', 15)]
    expect(slotDays(recurring, 'first')).toEqual([15])
    expect(slotDays(recurring, 'second')).toEqual([30])
    expect(slotDays(recurring, 'both')).toEqual([15, 30])
    expect(slotDays([payday('only', 1)], 'second')).toEqual([])
  })
})
