import type { RecurringItem, RepeatFrequency } from '../db/types'
import { repeatOf, type RepeatFields } from './cycle'
import { dayInMonth, isoToDate, nextDateForDay } from './dates'

const dayMonth = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short' })

export type RepeatKey = 'once' | 'w1' | 'w2' | 'w3' | 'w4' | 'm1' | 'm2' | 'm3' | 'm6' | 'm12'

export const REPEAT_OPTIONS: { value: RepeatKey; label: string; billOnly?: boolean }[] = [
  { value: 'once', label: 'Una vez', billOnly: true },
  { value: 'w1', label: 'Cada semana' },
  { value: 'w2', label: 'Cada 2 semanas' },
  { value: 'w3', label: 'Cada 3 semanas' },
  { value: 'w4', label: 'Cada 4 semanas' },
  { value: 'm1', label: 'Cada mes' },
  { value: 'm2', label: 'Cada 2 meses', billOnly: true },
  { value: 'm3', label: 'Cada 3 meses', billOnly: true },
  { value: 'm6', label: 'Cada 6 meses', billOnly: true },
  { value: 'm12', label: 'Cada año', billOnly: true },
]

export const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const WEEKDAYS_PLURAL = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados']

export function repeatKey(item: RepeatFields): RepeatKey {
  if (item.frequency === 'once') return 'once'
  const { frequency, interval } = repeatOf(item)
  return `${frequency === 'weekly' ? 'w' : 'm'}${interval}` as RepeatKey
}

export function parseRepeatKey(key: RepeatKey): { frequency: RepeatFrequency; interval: number } {
  if (key === 'once') return { frequency: 'once', interval: 1 }
  return { frequency: key.startsWith('w') ? 'weekly' : 'monthly', interval: Number(key.slice(1)) }
}

/** Every 1 week or 1 month has one possible phase. Longer repeats need the user to pick the next date. */
export function needsStart(key: RepeatKey): boolean {
  return key !== 'once' && key !== 'w1' && key !== 'm1'
}

/** The dates that could be the next occurrence: one per week or month of the interval. */
export function startChoices(key: RepeatKey, weekday: number, day: number, today: Date): Date[] {
  const { frequency, interval } = parseRepeatKey(key)
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12)
  if (frequency === 'weekly') {
    const first = new Date(from.getFullYear(), from.getMonth(), from.getDate() + ((weekday - from.getDay() + 7) % 7), 12)
    return Array.from({ length: interval }, (_, k) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + 7 * k, 12))
  }
  const first = nextDateForDay(day, from)
  return Array.from({ length: interval }, (_, k) => dayInMonth(first.getFullYear(), first.getMonth() + k, day))
}

export function weekdayOf(item: Pick<RecurringItem, 'start_date'>): number {
  return isoToDate(item.start_date).getDay()
}

export function repeatLabel(item: RepeatFields & { issued_on?: string | null }): string {
  const { frequency, interval } = repeatOf(item)
  if (frequency === 'once') {
    return item.issued_on ? `Una vez · generado ${dayMonth.format(isoToDate(item.issued_on))}` : 'Una vez'
  }
  if (frequency === 'weekly') {
    const weekday = isoToDate(item.start_date).getDay()
    return interval === 1 ? `Cada ${WEEKDAYS[weekday]}` : `Cada ${interval} ${WEEKDAYS_PLURAL[weekday]}`
  }
  const day = item.due_day >= 31 ? 'último día' : `día ${item.due_day}`
  if (interval === 1) return item.due_day >= 31 ? 'Último día de cada mes' : `Día ${item.due_day} de cada mes`
  if (interval === 12) {
    const anchor = isoToDate(item.start_date)
    return `Cada año · ${dayMonth.format(dayInMonth(anchor.getFullYear(), anchor.getMonth(), item.due_day))}`
  }
  return `Cada ${interval} meses · ${day}`
}
