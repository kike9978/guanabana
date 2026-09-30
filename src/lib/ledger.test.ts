import { describe, expect, test } from 'bun:test'
import type { Account, CreditCard, Transaction } from '../db/types'
import { balanceEffects } from './ledger'
import { computeRealAvailable } from './realAvailable'
import { nextDateForDay } from './dates'

const base = { updated_at: '2026-09-29T00:00:00.000Z' }

function tx(fields: Partial<Transaction>): Transaction {
  return {
    ...base,
    uuid: 'tx',
    date: '2026-09-29',
    type: 'expense',
    amount: 100,
    currency: 'MXN',
    account_id: null,
    to_account_id: null,
    cc_id: null,
    category_id: null,
    place_id: null,
    payment_method: null,
    notes: '',
    source: 'manual',
    ...fields,
  }
}

function account(uuid: string, type: Account['type'], balance: number): Account {
  return { ...base, uuid, name: uuid, type, currency: 'MXN', current_balance: balance, balance_date: '2026-09-29' }
}

function card(balance: number, strategy: CreditCard['payment_strategy'] = 'full'): CreditCard {
  return {
    ...base,
    uuid: 'card',
    name: 'TDC',
    limit: 20000,
    current_balance: balance,
    statement_day: 5,
    due_day: 25,
    payment_strategy: strategy,
  }
}

describe('balanceEffects', () => {
  test('card expense raises card debt and leaves the bank untouched', () => {
    expect(balanceEffects(tx({ cc_id: 'card', payment_method: 'credit_card' }))).toEqual([
      { store: 'credit_cards', uuid: 'card', delta: 100 },
    ])
  })

  test('bank expense lowers the account', () => {
    expect(balanceEffects(tx({ account_id: 'bank' }))).toEqual([{ store: 'accounts', uuid: 'bank', delta: -100 }])
  })

  test('card refund lowers card debt and is not income', () => {
    expect(balanceEffects(tx({ cc_id: 'card', amount: -40 }))).toEqual([
      { store: 'credit_cards', uuid: 'card', delta: -40 },
    ])
  })

  test('transfer moves money between accounts', () => {
    expect(balanceEffects(tx({ type: 'transfer', account_id: 'a', to_account_id: 'b' }))).toEqual([
      { store: 'accounts', uuid: 'a', delta: -100 },
      { store: 'accounts', uuid: 'b', delta: 100 },
    ])
  })

  test('card payment lowers bank and card debt together', () => {
    expect(balanceEffects(tx({ type: 'cc_payment', account_id: 'bank', cc_id: 'card' }))).toEqual([
      { store: 'accounts', uuid: 'bank', delta: -100 },
      { store: 'credit_cards', uuid: 'card', delta: -100 },
    ])
  })
})

describe('computeRealAvailable', () => {
  test('every payment strategy reserves the whole card balance', () => {
    for (const strategy of ['full', 'statement', 'minimum'] as const) {
      const result = computeRealAvailable({ accounts: [account('bank', 'checking', 10000)], cards: [card(2500, strategy)], buffer: 0 })
      expect(result.ccReserve).toBe(2500)
    }
  })

  test('subtracts card debt and buffer from liquid money', () => {
    const result = computeRealAvailable({
      accounts: [account('bank', 'checking', 10000), account('cash', 'cash', 500), account('s', 'savings', 9000)],
      cards: [card(2500)],
      buffer: 1000,
    })
    expect(result.total).toBe(7000)
    expect(result.ccReserve).toBe(2500)
  })

  test('opening balance counts as liquid money', () => {
    const result = computeRealAvailable({ accounts: [account('o', 'unassigned', 12500.5)], cards: [], buffer: 0 })
    expect(result.total).toBe(12500.5)
  })

  test('card with a credit balance never adds money', () => {
    const result = computeRealAvailable({ accounts: [account('bank', 'checking', 100)], cards: [card(-50)], buffer: 0 })
    expect(result.total).toBe(100)
  })
})

describe('adjustment', () => {
  test('a signed gap moves only the reconciled account', () => {
    expect(balanceEffects(tx({ type: 'adjustment', amount: -250, account_id: 'bank' }))).toEqual([
      { store: 'accounts', uuid: 'bank', delta: -250 },
    ])
  })

  test('a card adjustment moves the debt, not the bank', () => {
    expect(balanceEffects(tx({ type: 'adjustment', amount: 80, cc_id: 'card' }))).toEqual([
      { store: 'credit_cards', uuid: 'card', delta: 80 },
    ])
  })
})

describe('nextDateForDay', () => {
  test('clamps day 31 to the end of a short month', () => {
    expect(nextDateForDay(31, new Date(2026, 1, 10)).getDate()).toBe(28)
  })

  test('rolls to next month once the day has passed', () => {
    const next = nextDateForDay(5, new Date(2026, 8, 29))
    expect([next.getMonth(), next.getDate()]).toEqual([9, 5])
  })
})
