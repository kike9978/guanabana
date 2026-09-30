import type { CreditCard, Transaction } from '../db/types'
import { dateToIso, isoToDate, nextDateForDay } from './dates'
import { roundMoney } from './money'

export const MSI_TERMS = [3, 6, 9, 12, 18, 24] as const

export interface MsiCharge {
  date: Date
  amount: number
}

export interface MsiPurchase {
  date: string
  amount: number
  months: number
}

export function isMsi(tx: Transaction): boolean {
  return tx.type === 'expense' && tx.cc_id !== null && tx.amount > 0 && (tx.msi_months ?? 0) > 1
}

/** Equal monthly charges; the last one absorbs the cents so they add up to the purchase. */
export function msiAmounts(total: number, months: number): number[] {
  const monthly = Math.floor((total * 100) / months) / 100
  return Array.from({ length: months }, (_, index) =>
    index === months - 1 ? roundMoney(total - monthly * (months - 1)) : monthly,
  )
}

function cutInMonth(year: number, month: number, day: number): Date {
  const last = new Date(year, month + 1, 0).getDate()
  return new Date(year, month, Math.min(day, last), 12)
}

/** One charge per statement, starting with the first cut on or after the purchase. */
export function msiSchedule(purchase: MsiPurchase, statementDay: number): MsiCharge[] {
  const first = nextDateForDay(statementDay, isoToDate(purchase.date))
  return msiAmounts(purchase.amount, purchase.months).map((amount, index) => ({
    date: cutInMonth(first.getFullYear(), first.getMonth() + index, statementDay),
    amount,
  }))
}

/**
 * Charges already in a statement period on `on`. A charge enters the period the day after the
 * previous cut, like any card purchase made during that period, so the first one counts right away.
 */
export function msiPostedCount(charges: MsiCharge[], on: Date): number {
  const day = dateToIso(on)
  return 1 + charges.slice(0, -1).filter((charge) => dateToIso(charge.date) < day).length
}

export function msiUnbilled(purchase: MsiPurchase, statementDay: number, on: Date): number {
  const charges = msiSchedule(purchase, statementDay)
  const unbilled = charges.slice(msiPostedCount(charges, on))
  return roundMoney(unbilled.reduce((sum, charge) => sum + charge.amount, 0))
}

export function msiPurchase(tx: Transaction): MsiPurchase {
  return { date: tx.date, amount: tx.amount, months: tx.msi_months ?? 1 }
}

export function msiPlans(transactions: Transaction[], card: CreditCard): Transaction[] {
  return transactions.filter((tx) => isMsi(tx) && tx.cc_id === card.uuid)
}

/** Unbilled MSI principal per card. It is owed, but it is not part of the next payment. */
export function msiPendingByCard(transactions: Transaction[], cards: CreditCard[], on: Date): Record<string, number> {
  const pending: Record<string, number> = {}
  for (const card of cards) {
    const total = msiPlans(transactions, card).reduce((sum, tx) => sum + msiUnbilled(msiPurchase(tx), card.statement_day, on), 0)
    if (total > 0) pending[card.uuid] = roundMoney(total)
  }
  return pending
}

/** What the card asks for now: the balance without MSI charges still to come. */
export function payableBalance(card: CreditCard, pending: Record<string, number>): number {
  return roundMoney(Math.max(0, card.current_balance - (pending[card.uuid] ?? 0)))
}
