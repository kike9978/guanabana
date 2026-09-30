import { describe, expect, test } from 'bun:test'
import type { Loan, LoanInstallment, RecurringItem, Transaction } from '../db/types'
import { scheduledMonthlyIncome } from './budgets'
import { billCommitments, incomeCycle, invoiceCommitments, itemOccurrences, loanCommitments, nextOccurrences } from './cycle'
import { dateToIso } from './dates'
import { incomeRank } from './incomeRules'
import { buildSchedule, summarizeLoan } from './loans'
import { repeatLabel, startChoices } from './repeat'

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

  test('an adjusted occurrence reserves its own amount, and 0 reserves nothing', () => {
    const adjust = (amount: number) => [{ ...base, uuid: 'o', recurring_id: 'r', occurrence: '2026-10-01', amount }]
    expect(billCommitments([recurring({ due_day: 1 })], [], cycle, today, adjust(9100)).map((c) => c.amount)).toEqual([9100])
    expect(billCommitments([recurring({ due_day: 1 })], [], cycle, today, adjust(0))).toEqual([])
  })

  test('a bill without a usual amount reserves only the adjusted date', () => {
    const variable = recurring({ due_day: 1, amount: null })
    expect(billCommitments([variable], [], cycle, today)).toEqual([])
    const adjusted = [{ ...base, uuid: 'o', recurring_id: 'r', occurrence: '2026-10-01', amount: 1340 }]
    expect(billCommitments([variable], [], cycle, today, adjusted).map((c) => c.amount)).toEqual([1340])
  })

  test('a one-time bill reserves from the day it was generated, not only before the next income', () => {
    const invoice = recurring({ frequency: 'once', issued_on: '2026-09-29', start_date: '2026-11-17', due_day: 17, amount: 4000 })
    expect(billCommitments([invoice], [], cycle, today)).toEqual([])
    expect(invoiceCommitments([invoice], [], today).map((item) => [item.occurrence, item.amount, item.overdue])).toEqual([['2026-11-17', 4000, false]])
    expect(invoiceCommitments([invoice], [], new Date(2026, 10, 20, 12))[0].overdue).toBe(true)
  })

  test('a one-time bill does not reserve before it is generated, and stops once it is paid', () => {
    const invoice = recurring({ frequency: 'once', issued_on: '2026-11-01', start_date: '2026-11-17', due_day: 17, amount: 4000 })
    expect(invoiceCommitments([invoice], [], today)).toEqual([])
    const paid = { recurring_id: 'r', occurrence: '2026-11-17' } as Transaction
    expect(invoiceCommitments([{ ...invoice, issued_on: '2026-09-29' }], [paid], today)).toEqual([])
    expect(itemOccurrences(invoice, today, new Date(2026, 11, 1, 12)).map(dateToIso)).toEqual(['2026-11-17'])
    expect(nextOccurrences(invoice, today, 1).map(dateToIso)).toEqual(['2026-11-17'])
  })

  test('an unpaid bill earlier in the cycle stays reserved as overdue', () => {
    const items = billCommitments([recurring({ due_day: 20 })], [], cycle, today)
    expect(items).toHaveLength(1)
    expect(items[0].overdue).toBe(true)
  })
})

describe('repeat rules', () => {
  const iso = (dates: Date[]) => dates.map(dateToIso)
  const fridays = recurring({ frequency: 'weekly', interval: 1, start_date: '2026-10-02' })
  const everyOther = recurring({ frequency: 'weekly', interval: 2, start_date: '2026-10-09' })

  test('weekly runs on the weekday of its start, both ways', () => {
    expect(iso(itemOccurrences(fridays, new Date(2026, 8, 20, 12), new Date(2026, 9, 10, 12)))).toEqual([
      '2026-09-25',
      '2026-10-02',
      '2026-10-09',
    ])
  })

  test('every 2 weeks keeps the phase of its start date', () => {
    expect(iso(itemOccurrences(everyOther, new Date(2026, 8, 1, 12), new Date(2026, 9, 31, 12)))).toEqual([
      '2026-09-11',
      '2026-09-25',
      '2026-10-09',
      '2026-10-23',
    ])
  })

  test('every 2 months counts months from the start and clamps day 31', () => {
    const cfe = recurring({ frequency: 'monthly', interval: 2, due_day: 31, start_date: '2026-10-31' })
    expect(iso(itemOccurrences(cfe, new Date(2026, 9, 1, 12), new Date(2027, 3, 1, 12)))).toEqual(['2026-10-31', '2026-12-31', '2027-02-28'])
  })

  test('next occurrences never fall before the start date', () => {
    expect(iso(nextOccurrences(everyOther, new Date(2026, 8, 30, 12), 2))).toEqual(['2026-10-09', '2026-10-23'])
  })

  test('a weekly bill can reserve twice in one cycle', () => {
    const cycle = incomeCycle([recurring({ uuid: 'i', type: 'income', due_day: 15 })], today)
    const weeklyBill = recurring({ frequency: 'weekly', interval: 1, start_date: '2026-09-04', amount: 500 })
    expect(billCommitments([weeklyBill], [], cycle, today).map((c) => c.occurrence)).toEqual([
      '2026-09-18',
      '2026-09-25',
      '2026-10-02',
      '2026-10-09',
    ])
  })

  test('a weekly income makes a one-week cycle', () => {
    const pay = recurring({ uuid: 'p', type: 'income', frequency: 'weekly', interval: 1, start_date: '2026-09-04' })
    const cycle = incomeCycle([pay], today)
    expect(dateToIso(cycle.start)).toBe('2026-09-25')
    expect(dateToIso(cycle.end)).toBe('2026-10-02')
  })

  test('weekly paydays alternate 1st and 2nd from the first one', () => {
    const pay = recurring({ uuid: 'p', type: 'income', frequency: 'weekly', interval: 1, start_date: '2026-09-04' })
    const income = (date: string, occurrence?: string) => ({ type: 'income' as const, date, category_id: null, recurring_id: occurrence ? 'p' : null, occurrence })
    expect(incomeRank(income('2026-09-04'), [pay])).toBe('first')
    expect(incomeRank(income('2026-09-11'), [pay])).toBe('second')
    expect(incomeRank(income('2026-09-19'), [pay])).toBe('first')
    expect(incomeRank(income('2026-09-26', '2026-09-25'), [pay])).toBe('second')
  })

  test('the monthly income average uses paydays per year', () => {
    const pay = recurring({ type: 'income', amount: 1200, frequency: 'weekly', interval: 2, start_date: '2026-09-04' })
    expect(scheduledMonthlyIncome([pay])).toBe(2600)
    expect(scheduledMonthlyIncome([recurring({ type: 'income', amount: 1200 })])).toBe(1200)
  })

  test('labels and start choices read the rule in words', () => {
    expect(repeatLabel(fridays)).toBe('Cada viernes')
    expect(repeatLabel(everyOther)).toBe('Cada 2 viernes')
    expect(repeatLabel(recurring({ due_day: 15 }))).toBe('Día 15 de cada mes')
    expect(repeatLabel(recurring({ due_day: 31 }))).toBe('Último día de cada mes')
    expect(repeatLabel(recurring({ frequency: 'monthly', interval: 2, due_day: 10, start_date: '2026-10-10' }))).toBe('Cada 2 meses · día 10')
    expect(repeatLabel(recurring({ frequency: 'once', issued_on: '2026-09-30', start_date: '2026-11-17', due_day: 17 }))).toBe('Una vez · generado 30 sep')
    expect(iso(startChoices('w2', 5, 1, new Date(2026, 8, 30, 12)))).toEqual(['2026-10-02', '2026-10-09'])
    expect(iso(startChoices('m2', 0, 10, new Date(2026, 8, 30, 12)))).toEqual(['2026-10-10', '2026-11-10'])
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
