import { describe, expect, test } from 'bun:test'
import type { Loan, LoanInstallment, RecurringItem, RecurringOverride, Transaction } from '../db/types'
import type { MoneyData } from '../db/useMoneyData'
import { timeline } from './timeline'

const base = { updated_at: '2026-09-01T00:00:00.000Z' }

const rent: RecurringItem = {
  ...base,
  uuid: 'rent',
  name: 'Renta',
  type: 'bill',
  amount: 8000,
  due_day: 1,
  account_id: 'bbva',
  category_id: 'housing',
  start_date: '2026-01-01',
  active: true,
}

const loan = { ...base, uuid: 'car', name: 'Auto', direction: 'borrowed', status: 'active', pay_from_account_id: 'bbva' } as Loan
const installment: LoanInstallment = {
  ...base,
  uuid: 'car-1',
  loan_id: 'car',
  due_date: '2026-10-05',
  amount: 2500,
  principal_part: 2500,
  interest_part: 0,
  status: 'scheduled',
}

function data(transactions: Transaction[] = [], overrides: RecurringOverride[] = []): MoneyData {
  return {
    loaded: true,
    accounts: [],
    cards: [],
    categories: [],
    transactions,
    recurring: [rent],
    overrides,
    loans: [loan],
    installments: [installment],
    buckets: [],
    bucketMoves: [],
    budgets: [],
    settings: undefined,
  }
}

const october = [new Date(2026, 9, 1), new Date(2026, 10, 1)] as const

describe('timeline', () => {
  test('lists bills and loan installments with a ready payment prefill', () => {
    const events = timeline(data(), ...october)
    expect(events.map((event) => event.key)).toEqual(['rent-2026-10-01', 'car-1'])
    expect(events[1].action).toEqual({
      type: 'expense',
      prefill: {
        amount: 2500,
        account_id: 'bbva',
        category_key: 'loan_payment',
        notes: 'Cuota Auto',
        loan_installment_id: 'car-1',
      },
    })
  })

  test('linked transactions mark events as paid', () => {
    const paid = [
      { recurring_id: 'rent', occurrence: '2026-10-01' },
      { loan_installment_id: 'car-1' },
    ] as Transaction[]
    expect(timeline(data(paid), ...october).every((event) => event.paid)).toBe(true)
  })

  test('an adjusted occurrence shows and prefills its own amount', () => {
    const override: RecurringOverride = { ...base, uuid: 'o', recurring_id: 'rent', occurrence: '2026-10-01', amount: 9100 }
    const [event] = timeline(data([], [override]), ...october)
    expect(event.amount).toBe(9100)
    expect(event.action?.prefill.amount).toBe(9100)
    expect(event.bill?.override).toBe(override)
  })

  test('the end date is exclusive', () => {
    expect(timeline(data(), new Date(2026, 9, 2), new Date(2026, 9, 5))).toEqual([])
  })
})
