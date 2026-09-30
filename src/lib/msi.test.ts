import { describe, expect, test } from 'bun:test'
import type { CreditCard, Transaction } from '../db/types'
import { dateToIso } from './dates'
import { msiAmounts, msiPendingByCard, msiSchedule, msiUnbilled, payableBalance } from './msi'
import { computeRealAvailable } from './realAvailable'

const base = { updated_at: '2026-09-29T00:00:00.000Z' }

const card: CreditCard = {
  ...base,
  uuid: 'card',
  name: 'TDC',
  limit: 50000,
  current_balance: 12500,
  statement_day: 5,
  due_day: 25,
  payment_strategy: 'full',
}

function purchase(fields: Partial<Transaction>): Transaction {
  return {
    ...base,
    uuid: 'phone',
    date: '2026-09-29',
    type: 'expense',
    amount: 12000,
    currency: 'MXN',
    account_id: null,
    to_account_id: null,
    cc_id: 'card',
    category_id: null,
    place_id: null,
    payment_method: 'credit_card',
    notes: '',
    source: 'manual',
    msi_months: 12,
    ...fields,
  }
}

const day = (iso: string) => new Date(`${iso}T12:00:00`)

describe('msiAmounts', () => {
  test('splits evenly and the last charge keeps the cents', () => {
    expect(msiAmounts(1000, 3)).toEqual([333.33, 333.33, 333.34])
  })
})

describe('msiSchedule', () => {
  test('starts at the first cut on or after the purchase, one per month', () => {
    const charges = msiSchedule({ date: '2026-09-29', amount: 12000, months: 3 }, 5)
    expect(charges.map((c) => dateToIso(c.date))).toEqual(['2026-10-05', '2026-11-05', '2026-12-05'])
  })

  test('clamps a day-31 cut to short months', () => {
    const charges = msiSchedule({ date: '2026-01-31', amount: 300, months: 3 }, 31)
    expect(charges.map((c) => dateToIso(c.date))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
  })
})

describe('msiUnbilled', () => {
  const plan = { date: '2026-09-29', amount: 12000, months: 12 }

  test('only the first charge is reserved on the purchase day', () => {
    expect(msiUnbilled(plan, 5, day('2026-09-29'))).toBe(11000)
  })

  test('the next charge enters the day after a cut', () => {
    expect(msiUnbilled(plan, 5, day('2026-10-05'))).toBe(11000)
    expect(msiUnbilled(plan, 5, day('2026-10-06'))).toBe(10000)
  })

  test('nothing is left once the last period opens', () => {
    expect(msiUnbilled(plan, 5, day('2027-09-01'))).toBe(0)
  })
})

describe('Disponible real with MSI', () => {
  const bank = { ...base, uuid: 'bank', name: 'Banco', type: 'checking' as const, currency: 'MXN' as const, current_balance: 20000, balance_date: '2026-09-29' }

  test('a full card reserves the balance without MSI charges still to come', () => {
    const pending = msiPendingByCard([purchase({})], [card], day('2026-09-29'))
    expect(pending).toEqual({ card: 11000 })
    const result = computeRealAvailable({ accounts: [bank], cards: [card], buffer: 0, msiPending: pending })
    expect(result.ccReserve).toBe(1500)
    expect(result.ccMsiPending).toBe(11000)
    expect(result.total).toBe(18500)
  })

  test('paying MSI early never reserves below zero', () => {
    expect(payableBalance({ ...card, current_balance: 4000 }, { card: 11000 })).toBe(0)
  })

  test('refunds, bank expenses, and single-payment card expenses are not MSI', () => {
    const rows = [purchase({ amount: -500 }), purchase({ cc_id: null, account_id: 'bank' }), purchase({ msi_months: null })]
    expect(msiPendingByCard(rows, [card], day('2026-09-29'))).toEqual({})
  })
})
