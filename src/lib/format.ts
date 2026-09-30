export type Currency = 'MXN'

const LOCALE = 'es-MX'

const amountFormat = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const dateFormat = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

const monthFormat = new Intl.DateTimeFormat(LOCALE, {
  month: 'long',
  year: 'numeric',
})

const timeFormat = new Intl.DateTimeFormat(LOCALE, {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export function formatAmount(amount: number): string {
  return amountFormat.format(amount)
}

export function formatMoney(amount: number, currency: Currency): string {
  return `${formatAmount(amount)} ${currency}`
}

export function formatCompact(amount: number): string {
  const abs = Math.abs(amount)
  const sign = amount < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}k`
  return `${sign}${Math.round(abs)}`
}

export function formatDate(date: Date): string {
  return dateFormat.format(date)
}

export function formatMonth(date: Date): string {
  return monthFormat.format(date)
}

export function formatTime(date: Date): string {
  return timeFormat.format(date)
}
