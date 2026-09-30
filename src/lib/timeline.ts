import type { AddPrefill, AddType } from '../app/navigation'
import type { RecurringItem, RecurringOverride } from '../db/types'
import type { MoneyData } from '../db/useMoneyData'
import { itemOccurrences, overrideIndex } from './cycle'
import { dateToIso, daysBetween, isoToDate } from './dates'
import { formatMoney } from './format'
import { paidInstallmentIds } from './loans'
import { nextPayments } from './statement'
import { cardEvents } from './upcoming'

export type TimelineKind = 'cc_due' | 'cc_statement' | 'bill' | 'income' | 'loan' | 'loan_receivable'

export interface TimelineEvent {
  key: string
  date: Date
  label: string
  amount: number | null
  kind: TimelineKind
  paid: boolean
  action?: { type: AddType; prefill: AddPrefill }
  /** Bills and income: the item behind the event, so one occurrence can be adjusted. */
  recurring?: { item: RecurringItem; occurrence: string; override?: RecurringOverride }
}

export function timeline(data: MoneyData, from: Date, to: Date): TimelineEvent[] {
  const events: TimelineEvent[] = []
  const recordedOccurrences = new Set(
    data.transactions.filter((tx) => tx.recurring_id && tx.occurrence).map((tx) => `${tx.recurring_id}|${tx.occurrence}`),
  )

  const payments = nextPayments(data.cards, data.transactions, new Date())
  for (const event of cardEvents(data.cards, from, daysBetween(from, to) - 1, payments)) {
    if (event.date < to) events.push({ ...event, paid: false })
  }

  const adjusted = overrideIndex(data.overrides)
  for (const item of data.recurring.filter((r) => r.active)) {
    for (const date of itemOccurrences(item, from, to)) {
      const occurrence = dateToIso(date)
      if (occurrence < item.start_date) continue
      const isBill = item.type === 'bill'
      const override = adjusted.get(`${item.uuid}|${occurrence}`)
      const amount = override?.amount ?? item.amount
      events.push({
        key: `${item.uuid}-${occurrence}`,
        date,
        label: item.name,
        amount,
        kind: isBill ? 'bill' : 'income',
        paid: recordedOccurrences.has(`${item.uuid}|${occurrence}`),
        recurring: { item, occurrence, override },
        action: {
          type: isBill ? 'expense' : 'income',
          prefill: {
            amount: amount ?? undefined,
            account_id: item.account_id,
            cc_id: isBill ? (item.cc_id ?? null) : null,
            category_id: item.category_id,
            notes: item.name,
            recurring_id: item.uuid,
            occurrence,
          },
        },
      })
    }
  }

  const paid = paidInstallmentIds(data.transactions)
  const loans = new Map(data.loans.filter((loan) => loan.status === 'active').map((loan) => [loan.uuid, loan]))
  const fromIso = dateToIso(from)
  const toIso = dateToIso(to)
  const lastDue = new Map<string, string>()
  for (const row of data.installments) {
    if (row.status === 'scheduled' && row.due_date > (lastDue.get(row.loan_id) ?? '')) lastDue.set(row.loan_id, row.due_date)
  }
  for (const row of data.installments) {
    const loan = loans.get(row.loan_id)
    if (!loan || row.status !== 'scheduled' || row.due_date < fromIso || row.due_date >= toIso) continue
    const borrowed = loan.direction === 'borrowed'
    const last = lastDue.get(loan.uuid) === row.due_date
    events.push({
      key: row.uuid,
      date: isoToDate(row.due_date),
      label: `${borrowed ? (last ? 'Última cuota' : 'Cuota') : last ? 'Último cobro' : 'Cobro'} ${loan.name}`,
      amount: row.amount,
      kind: borrowed ? 'loan' : 'loan_receivable',
      paid: paid.has(row.uuid),
      action: {
        type: borrowed ? 'expense' : 'income',
        prefill: {
          amount: row.amount,
          account_id: loan.pay_from_account_id,
          category_key: borrowed ? 'loan_payment' : 'loan_repayment',
          notes: `Cuota ${loan.name}`,
          loan_installment_id: row.uuid,
        },
      },
    })
  }

  return events.sort((a, b) => a.date.getTime() - b.date.getTime())
}

/** Adjusted amounts can only be set on a bill or income that is still ahead and unregistered. */
export function canAdjust(event: TimelineEvent, today: Date): boolean {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return event.recurring !== undefined && !event.paid && event.date >= start
}

export function adjustLabel(event: TimelineEvent): string {
  return event.kind === 'income' ? 'Ajustar este ingreso' : 'Ajustar este pago'
}

export function adjustedNote(event: TimelineEvent): string | null {
  if (!event.recurring?.override) return null
  if (event.amount === 0) return event.kind === 'income' ? 'Sin ingreso este periodo' : 'Sin cargo este periodo'
  const usual = event.recurring.item.amount
  return `normalmente ${usual === null ? '—' : formatMoney(usual, 'MXN')}`
}

export function groupByDay(events: TimelineEvent[]): Map<number, TimelineEvent[]> {
  const byDay = new Map<number, TimelineEvent[]>()
  for (const event of events) {
    const day = event.date.getDate()
    byDay.set(day, [...(byDay.get(day) ?? []), event])
  }
  return byDay
}
