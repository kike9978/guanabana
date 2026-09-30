import { describe, expect, test } from 'bun:test'
import type { CreditCard, Transaction } from '../db/types'
import { dateToIso } from './dates'
import { lastCut, nextPayment, statementOpenForPayment } from './statement'

const base = { updated_at: '2026-09-29T00:00:00.000Z' }

function card(fields: Partial<CreditCard> = {}): CreditCard {
  return {
    ...base,
    uuid: 'card',
    name: 'TDC',
    limit: 50000,
    current_balance: 12400,
    statement_day: 5,
    due_day: 25,
    payment_strategy: 'statement',
    ...fields,
  }
}

function tx(fields: Partial<Transaction>): Transaction {
  return {
    ...base,
    uuid: fields.uuid ?? 'tx',
    date: '2026-10-10',
    type: 'expense',
    amount: 100,
    currency: 'MXN',
    account_id: null,
    to_account_id: null,
    cc_id: 'card',
    category_id: null,
    place_id: null,
    payment_method: 'credit_card',
    notes: '',
    source: 'manual',
    ...fields,
  }
}

const day = (iso: string) => new Date(`${iso}T12:00:00`)
const iso = (date: Date) => dateToIso(date)

describe('lastCut', () => {
  test('is today on the cut day, and last month before it', () => {
    expect(iso(lastCut(5, day('2026-10-05')))).toBe('2026-10-05')
    expect(iso(lastCut(5, day('2026-10-04')))).toBe('2026-09-05')
    expect(iso(lastCut(5, day('2026-10-20')))).toBe('2026-10-05')
  })

  test('clamps a day-31 cut in a short month', () => {
    expect(iso(lastCut(31, day('2026-03-10')))).toBe('2026-02-28')
  })
})

describe('nextPayment, Saldo al corte', () => {
  const today = day('2026-10-12')

  test('purchases after the cut go to the next statement', () => {
    const result = nextPayment(card(), [tx({ amount: 4200 })], today)
    expect(iso(result.due)).toBe('2026-10-25')
    expect(result.statement).toBe(8200)
    expect(result.amount).toBe(8200)
    expect(result.rest).toBe(4200)
  })

  test('payments after the cut settle the statement first', () => {
    const rows = [tx({ uuid: 'buy', amount: 4200 }), tx({ uuid: 'pay', type: 'cc_payment', amount: 8200, account_id: 'bank' })]
    const result = nextPayment(card({ current_balance: 4200 }), rows, today)
    expect(result.amount).toBe(0)
    expect(result.rest).toBe(4200)
  })

  test('opening debt without a statement figure is all due on the next due date', () => {
    const result = nextPayment(card(), [], today)
    expect(result.amount).toBe(12400)
    expect(result.rest).toBe(0)
  })

  test('an entered statement balance for the last cut wins over the computed one', () => {
    const result = nextPayment(card({ statement_balance: 7000, statement_date: '2026-10-05' }), [], today)
    expect(result.amount).toBe(7000)
    expect(result.rest).toBe(5400)
  })

  test('a statement balance entered for an older cut is ignored', () => {
    const result = nextPayment(card({ statement_balance: 7000, statement_date: '2026-09-05' }), [], today)
    expect(result.amount).toBe(12400)
  })

  test('once the due date passes, the open period is the next payment', () => {
    const result = nextPayment(card(), [tx({ amount: 4200 })], day('2026-10-27'))
    expect(result.closed).toBe(false)
    expect(iso(result.due)).toBe('2026-11-25')
    expect(result.amount).toBe(12400)
    expect(result.rest).toBe(0)
  })

  test('MSI charges not billed at the cut stay out of the statement', () => {
    const phone = tx({ uuid: 'phone', date: '2026-09-29', amount: 12000, msi_months: 12 })
    const result = nextPayment(card({ current_balance: 12000 }), [phone], today)
    expect(result.statement).toBe(1000)
    expect(result.rest).toBe(1000)
  })
})

describe('nextPayment, Pago mínimo', () => {
  const today = day('2026-10-12')
  const minimumCard = card({ payment_strategy: 'minimum', statement_balance: 8200, minimum_payment: 1150, statement_date: '2026-10-05' })

  test('pays the minimum and keeps the rest reserved', () => {
    const result = nextPayment(minimumCard, [], today)
    expect(result.minimum).toBe(1150)
    expect(result.amount).toBe(1150)
    expect(result.statement).toBe(8200)
    expect(result.rest).toBe(11250)
  })

  test('payments since the cut count toward the minimum', () => {
    const pay = tx({ type: 'cc_payment', amount: 500, account_id: 'bank' })
    const result = nextPayment({ ...minimumCard, current_balance: 11900 }, [pay], today)
    expect(result.amount).toBe(650)
  })

  test('without a minimum for this cut it falls back to the statement', () => {
    const result = nextPayment({ ...minimumCard, minimum_payment: null }, [], today)
    expect(result.minimum).toBeNull()
    expect(result.amount).toBe(8200)
  })
})

describe('statementOpenForPayment', () => {
  test('is true from the cut until the due date', () => {
    expect(statementOpenForPayment(card(), day('2026-10-05'))).toBe(true)
    expect(statementOpenForPayment(card(), day('2026-10-25'))).toBe(true)
    expect(statementOpenForPayment(card(), day('2026-10-26'))).toBe(false)
  })
})
