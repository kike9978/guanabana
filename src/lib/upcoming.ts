import type { CreditCard } from '../db/types'
import { dateToIso, daysBetween, nextDateForDay } from './dates'
import type { NextPayment } from './statement'

export interface UpcomingEvent {
  key: string
  date: Date
  label: string
  amount: number | null
  kind: 'cc_due' | 'cc_statement'
}

/** `payments` replaces the due amount of Saldo al corte and Pago mínimo cards on their next due date. */
export function cardEvents(cards: CreditCard[], from: Date, withinDays: number, payments: Record<string, NextPayment> = {}): UpcomingEvent[] {
  const events: UpcomingEvent[] = []
  for (const card of cards) {
    const due = nextDateForDay(card.due_day, from)
    const next = payments[card.uuid]
    const amount =
      card.payment_strategy !== 'full' && next && dateToIso(next.due) === dateToIso(due) ? next.amount : card.current_balance
    if (daysBetween(from, due) <= withinDays && amount > 0) {
      events.push({ key: `${card.uuid}-due`, date: due, label: `Pago ${card.name}`, amount, kind: 'cc_due' })
    }
    const statement = nextDateForDay(card.statement_day, from)
    if (daysBetween(from, statement) <= withinDays) {
      events.push({ key: `${card.uuid}-statement`, date: statement, label: `Corte ${card.name}`, amount: null, kind: 'cc_statement' })
    }
  }
  return events.sort((a, b) => a.date.getTime() - b.date.getTime())
}

export function cardEventsInMonth(cards: CreditCard[], month: Date): Map<number, UpcomingEvent[]> {
  const byDay = new Map<number, UpcomingEvent[]>()
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  for (const event of cardEvents(cards, first, days - 1)) {
    if (event.date.getMonth() !== month.getMonth()) continue
    const day = event.date.getDate()
    byDay.set(day, [...(byDay.get(day) ?? []), event])
  }
  return byDay
}
