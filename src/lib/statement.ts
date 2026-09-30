import type { CreditCard, Transaction } from '../db/types'
import { dateToIso, dayInMonth, nextDateForDay } from './dates'
import { balanceEffects } from './ledger'
import { roundMoney } from './money'
import { msiPendingByCard, msiPlans, msiPurchase, msiUnbilled, payableBalance } from './msi'

export interface NextPayment {
  /** The cut this payment settles. */
  cut: Date
  due: Date
  /** False while the statement is still open: the whole payable balance is the estimate. */
  closed: boolean
  statement: number
  minimum: number | null
  amount: number
  /** Reserved, but paid after this due date. */
  rest: number
}

function nextDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 12)
}

const clamp = (value: number, max: number) => roundMoney(Math.min(Math.max(0, value), Math.max(0, max)))

export function lastCut(statementDay: number, on: Date): Date {
  const next = nextDateForDay(statementDay, on)
  if (dateToIso(next) === dateToIso(on)) return next
  return dayInMonth(next.getFullYear(), next.getMonth() - 1, statementDay)
}

export function dueAfterCut(card: Pick<CreditCard, 'due_day'>, cut: Date): Date {
  return nextDateForDay(card.due_day, nextDay(cut))
}

/** True while the last statement can still be paid on time, so its balance and minimum matter. */
export function statementOpenForPayment(card: Pick<CreditCard, 'statement_day' | 'due_day'>, today: Date): boolean {
  return dateToIso(dueAfterCut(card, lastCut(card.statement_day, today))) >= dateToIso(today)
}

export function nextPayment(card: CreditCard, transactions: Transaction[], today: Date): NextPayment {
  const payable = payableBalance(card, msiPendingByCard(transactions, [card], today))
  const cut = lastCut(card.statement_day, today)
  const cutIso = dateToIso(cut)
  const due = dueAfterCut(card, cut)

  if (dateToIso(due) < dateToIso(today)) {
    const nextCut = nextDateForDay(card.statement_day, today)
    return { cut: nextCut, due: dueAfterCut(card, nextCut), closed: false, statement: payable, minimum: null, amount: payable, rest: 0 }
  }

  let debits = 0
  let credits = 0
  for (const tx of transactions) {
    if (tx.cc_id !== card.uuid || tx.date <= cutIso) continue
    for (const effect of balanceEffects(tx)) {
      if (effect.store !== 'credit_cards' || effect.uuid !== card.uuid) continue
      if (effect.delta > 0) debits += effect.delta
      else credits -= effect.delta
    }
  }
  const msiAtCut = msiPlans(transactions, card)
    .filter((tx) => tx.date <= cutIso)
    .reduce((sum, tx) => sum + msiUnbilled(msiPurchase(tx), card.statement_day, cut), 0)
  const entered = card.statement_date === cutIso
  const billed = entered && card.statement_balance != null ? card.statement_balance : card.current_balance - debits + credits - msiAtCut
  const statement = clamp(billed - credits, payable)
  const minimum = entered && card.minimum_payment != null ? clamp(card.minimum_payment - credits, statement) : null

  const amount = card.payment_strategy === 'full' ? payable : card.payment_strategy === 'minimum' && minimum !== null ? minimum : statement
  return { cut, due, closed: true, statement, minimum, amount, rest: roundMoney(Math.max(0, payable - amount)) }
}

export function paymentLabel(card: CreditCard, payment: NextPayment): string {
  if (card.payment_strategy === 'minimum' && payment.minimum !== null) return 'mínimo'
  return payment.closed ? 'saldo al corte' : 'pago'
}

export function nextPayments(cards: CreditCard[], transactions: Transaction[], today: Date): Record<string, NextPayment> {
  return Object.fromEntries(cards.map((card) => [card.uuid, nextPayment(card, transactions, today)]))
}
