export function isoToDate(iso: string): Date {
  return new Date(`${iso}T12:00:00`)
}

export function dateToIso(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

export function todayIso(): string {
  return dateToIso(new Date())
}

function dayInMonth(year: number, month: number, day: number): Date {
  const last = new Date(year, month + 1, 0).getDate()
  return new Date(year, month, Math.min(day, last), 12)
}

export function nextDateForDay(day: number, from: Date): Date {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 12)
  const thisMonth = dayInMonth(start.getFullYear(), start.getMonth(), day)
  return thisMonth >= start ? thisMonth : dayInMonth(start.getFullYear(), start.getMonth() + 1, day)
}

export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b - a) / 86_400_000)
}
