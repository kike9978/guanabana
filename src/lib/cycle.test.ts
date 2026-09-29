import { describe, expect, test } from 'bun:test'
import type { Loan, LoanInstallment, RecurringItem, Transaction } from '../db/types'
import { billCommitments, incomeCycle, loanCommitments } from './cycle'
import { buildSchedule, summarizeLoan } from './loans'

const base = { updated_at: '2026-09-01T00:00:00.000Z' }

function recurring(fields: Partial<RecurringItem>): RecurringItem {
  return {
    ...base,
    uuid: 'r',
    name: 'Renta',
    type: 'bill',
    amount: 8000,
    due_day: 1,
    account_id: null,
    category_id: null,
    start_date: '2026-01-01',
    active: true,
    ...fields,
  }
}

const today = new Date(2026, 8, 29, 12)

describe('incomeCycle', () => {
  test('uses the 15th and 30th as the pay window', () => {
    const cycle = incomeCycle([recurring({ uuid: 'a', type: 'income', due_day: 15 }), recurring({ uuid: 'b', type: 'income', due_day: 30 })], today)
    expect(cycle.start.getDate()).toBe(15)
    expect(cycle.nextIncome?.getDate()).toBe(30)
  })

  test('falls back to 15 days without an income schedule', () => {
    const cycle = incomeCycle([], today)
    expect(cycle.hasSchedule).toBe(false)
    expect(cycle.end.getDate()).toBe(14)
    expect(cycle.end.getMonth()).toBe(9)
  })
})

describe('billCommitments', () => {
  const cycle = incomeCycle([recurring({ uuid: 'i', type: 'income', due_day: 15 })], today)

  test('reserves a bill due before the next income', () => {
    const items = billCommitments([recurring({ due_day: 1 })], [], cycle, today)
    expect(items.map((item) => item.occurrence)).toEqual(['2026-10-01'])
  })

  test('a paid occurrence is no longer reserved', () => {
    const paid = { recurring_id: 'r', occurrence: '2026-10-01' } as Transaction
    expect(billCommitments([recurring({ due_day: 1 })], [paid], cycle, today)).toEqual([])
  })

  test('occurrences before the bill existed are ignored', () => {
    expect(billCommitments([recurring({ due_day: 20, start_date: '2026-09-25' })], [], cycle, today)).toEqual([])
  })

  test('an unpaid bill earlier in the cycle stays reserved as overdue', () => {
    const items = billCommitments([recurring({ due_day: 20 })], [], cycle, today)
    expect(items).toHaveLength(1)
    expect(items[0].overdue).toBe(true)
  })
})

describe('loans', () => {
  test('no-interest schedule splits principal and fixes the last cent', () => {
    const rows = buildSchedule({
      principal: 1000,
      interest: 'none',
      rate_annual: null,
      installment_amount: null,
      frequency: 'monthly',
      first_due_date: '2026-01-31',
      installment_count: 3,
    })
    expect(rows.map((r) => r.amount)).toEqual([333.33, 333.33, 333.34])
    expect(rows.map((r) => r.due_date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
  })

  test('fixed-rate schedule pays off the full principal', () => {
    const rows = buildSchedule({
      principal: 12000,
      interest: 'fixed_rate',
      rate_annual: 24,
      installment_amount: null,
      frequency: 'monthly',
      first_due_date: '2026-10-15',
      installment_count: 12,
    })
    const principal = rows.reduce((sum, r) => sum + r.principal_part, 0)
    expect(Math.round(principal * 100) / 100).toBe(12000)
    expect(rows[0].interest_part).toBe(240)
  })

  test('only unpaid borrowed installments before the next income are reserved', () => {
    const loan = { uuid: 'l', name: 'Auto', status: 'active', direction: 'borrowed', principal: 3000, pay_from_account_id: null } as Loan
    const row = (uuid: string, due: string): LoanInstallment => ({ ...base, uuid, loan_id: 'l', due_date: due, amount: 1000, principal_part: 1000, interest_part: 0, status: 'scheduled' })
    const installments = [row('a', '2026-09-20'), row('b', '2026-10-10'), row('c', '2026-11-10')]
    const paid = [{ loan_installment_id: 'a' } as Transaction]

    const items = loanCommitments([loan], installments, paid, new Date(2026, 9, 15, 12), today)
    expect(items.map((item) => item.installmentId)).toEqual(['b'])

    const summary = summarizeLoan(loan, installments, paid)
    expect(summary.remaining).toBe(2000)
    expect(summary.payoffDate).toBe('2026-11-10')
    expect(summary.next?.uuid).toBe('b')
  })
})
