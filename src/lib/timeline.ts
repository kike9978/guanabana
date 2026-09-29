import type { AddPrefill, AddType } from '../app/navigation'
import type { MoneyData } from '../db/useMoneyData'
import { occurrencesBetween } from './cycle'
import { dateToIso, daysBetween, isoToDate } from './dates'
import { paidInstallmentIds } from './loans'
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
}

export function timeline(data: MoneyData, from: Date, to: Date): TimelineEvent[] {
  const events: TimelineEvent[] = []
  const recordedOccurrences = new Set(
    data.transactions.filter((tx) => tx.recurring_id && tx.occurrence).map((tx) => `${tx.recurring_id}|${tx.occurrence}`),
  )

  for (const event of cardEvents(data.cards, from, daysBetween(from, to) - 1)) {
    if (event.date < to) events.push({ ...event, paid: false })
  }

  for (const item of data.recurring.filter((r) => r.active)) {
    for (const date of occurrencesBetween(item.due_day, from, to)) {
      const occurrence = dateToIso(date)
      if (occurrence < item.start_date) continue
      const isBill = item.type === 'bill'
      events.push({
        key: `${item.uuid}-${occurrence}`,
        date,
        label: item.name,
        amount: item.amount,
        kind: isBill ? 'bill' : 'income',
        paid: recordedOccurrences.has(`${item.uuid}|${occurrence}`),
        action: {
          type: isBill ? 'expense' : 'income',
          prefill: {
            amount: item.amount ?? undefined,
            account_id: item.account_id,
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
  for (const row of data.installments) {
    const loan = loans.get(row.loan_id)
    if (!loan || row.status !== 'scheduled' || row.due_date < fromIso || row.due_date >= toIso) continue
    const borrowed = loan.direction === 'borrowed'
    events.push({
      key: row.uuid,
      date: isoToDate(row.due_date),
      label: borrowed ? `Cuota ${loan.name}` : `Cobro ${loan.name}`,
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

export function groupByDay(events: TimelineEvent[]): Map<number, TimelineEvent[]> {
  const byDay = new Map<number, TimelineEvent[]>()
  for (const event of events) {
    const day = event.date.getDate()
    byDay.set(day, [...(byDay.get(day) ?? []), event])
  }
  return byDay
}
