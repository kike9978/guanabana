export type Currency = 'MXN' | 'CAD'

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

export function formatDate(date: Date): string {
  return dateFormat.format(date)
}

export function formatMonth(date: Date): string {
  return monthFormat.format(date)
}

export function formatTime(date: Date): string {
  return timeFormat.format(date)
}
