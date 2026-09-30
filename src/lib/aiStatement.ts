import type { Account, RecurringItem, Transaction } from '../db/types'
import { normalizeName } from './priceBook'
import { roundMoney } from './money'
import { AiParseError, asNumber, asString, dateTooFar, isoDate, readEnvelope, readFieldConfidence, type FieldConfidence } from './aiEnvelope'

export interface StatementRow {
  key: string
  date: string
  /** Positive. Direction says whether money left or arrived. */
  amount: number
  direction: 'out' | 'in'
  description: string
  duplicate: 'exact' | 'possible' | null
  recurringName: string | null
}

export interface ParsedStatement {
  accountName: string | null
  periodStart: string | null
  periodEnd: string | null
  closingBalance: number | null
  rows: StatementRow[]
  warnings: string[]
  confidence: number
  fieldConfidence: FieldConfidence
  /** Local account whose name matches, when there is exactly one. */
  matchedAccountId: string | null
}

function directionOf(record: Record<string, unknown>, amount: number): 'out' | 'in' | null {
  const told = asString(record.direction)
  if (told) {
    const name = normalizeName(told)
    if (name === 'out' || name === 'cargo' || name === 'gasto') return 'out'
    if (name === 'in' || name === 'abono' || name === 'ingreso') return 'in'
    return null
  }
  if (amount < 0) return 'out'
  if (amount > 0) return 'in'
  return null
}

function sameText(description: string, notes: string): boolean {
  const left = normalizeName(description)
  const right = normalizeName(notes)
  if (!left || !right) return false
  return left === right || left.includes(right) || right.includes(left)
}

export function classifyRow(
  row: { date: string; amount: number; direction: 'out' | 'in'; description: string },
  transactions: Transaction[],
  recurring: RecurringItem[],
): Pick<StatementRow, 'duplicate' | 'recurringName'> {
  const sameDay = transactions.filter((tx) => tx.date === row.date && tx.amount === row.amount && (row.direction === 'out' ? tx.type === 'expense' : tx.type === 'income'))
  const exact = sameDay.some((tx) => sameText(row.description, tx.notes))
  const bill = recurring.find((item) => {
    if (!item.active || item.type !== 'bill' || row.direction !== 'out') return false
    const day = Number(row.date.slice(8, 10))
    const apart = Math.abs(day - item.due_day)
    const nearDay = Math.min(apart, 31 - apart) <= 2
    const nearAmount = item.amount === null || item.amount === row.amount
    return nearDay && nearAmount && sameText(row.description, item.name)
  })
  return { duplicate: exact ? 'exact' : sameDay.length > 0 ? 'possible' : null, recurringName: bill?.name ?? null }
}

export function parseStatement(raw: string, context: { accounts: Account[]; transactions: Transaction[]; recurring: RecurringItem[] }, today: Date): ParsedStatement {
  const envelope = readEnvelope(raw, 'parse_bank_statement')
  const data = envelope.data
  const warnings = [...envelope.warnings]
  const list = data.transactions
  if (!Array.isArray(list) || list.length === 0) throw new AiParseError('El estado no trae movimientos.')
  const rows: StatementRow[] = []
  list.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null) throw new AiParseError(`El movimiento ${index + 1} no es un objeto.`)
    const record = entry as Record<string, unknown>
    const date = isoDate(record.date)
    if (!date) throw new AiParseError(`El movimiento ${index + 1} no tiene una fecha válida.`)
    if (dateTooFar(date, today)) throw new AiParseError(`El movimiento ${index + 1} tiene una fecha a más de una semana.`)
    const amount = asNumber(record.amount)
    if (amount === null || amount === 0) throw new AiParseError(`El movimiento ${index + 1} no tiene monto.`)
    const direction = directionOf(record, amount)
    if (!direction) throw new AiParseError(`El movimiento ${index + 1} no dice si es cargo o abono.`)
    const description = asString(record.description) ?? ''
    const row = { date, amount: roundMoney(Math.abs(amount)), direction, description }
    rows.push({ key: `${date}-${index}`, ...row, ...classifyRow(row, context.transactions, context.recurring) })
  })
  const accountName = asString(data.account_name)
  const matches = accountName ? context.accounts.filter((a) => !a.archived && a.type === 'checking' && normalizeName(a.name) === normalizeName(accountName)) : []
  const periodStart = data.period_start === undefined ? null : isoDate(data.period_start)
  const periodEnd = data.period_end === undefined ? null : isoDate(data.period_end)
  if (data.period_start !== undefined && !periodStart) warnings.push('El inicio del periodo no es una fecha válida.')
  if (data.period_end !== undefined && !periodEnd) warnings.push('El fin del periodo no es una fecha válida.')
  return {
    accountName,
    periodStart,
    periodEnd,
    closingBalance: asNumber(data.closing_balance),
    rows,
    warnings,
    confidence: envelope.confidence,
    fieldConfidence: readFieldConfidence(data),
    matchedAccountId: matches.length === 1 ? matches[0].uuid : null,
  }
}
