import { describe, expect, test } from 'bun:test'
import type { Loan, LoanInstallment, Transaction } from '../db/types'
import { buildSchedule, planExtraPayment, summarizeLoan } from './loans'

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
