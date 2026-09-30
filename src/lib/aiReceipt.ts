import type { Category, PaymentMethod, PriceUnit } from '../db/types'
import { UNCATEGORIZED_KEY } from './categories'
import { normalizeName, PRICE_UNITS } from './priceBook'
import { roundMoney } from './money'
import { AiParseError, asNumber, asString, dateTooFar, isoDate, readEnvelope, readFieldConfidence, type FieldConfidence } from './aiEnvelope'

export interface ParsedReceiptItem {
  name: string
  qty: number | null
  unit: PriceUnit
  lineTotal: number
  /** Set when the unit was missing and defaulted, or the qty was missing. */
  note: string | null
}

export interface ParsedReceipt {
  date: string
  merchant: string | null
  total: number
  paymentMethod: PaymentMethod | null
  /** Shown in the preview only. Never stored. */
  last4: string | null
  categoryId: string
  warnings: string[]
  confidence: number
  fieldConfidence: FieldConfidence
  items: ParsedReceiptItem[]
}

const METHOD_ALIAS: Record<string, PaymentMethod> = {
  bank: 'bank',
  debito: 'bank',
  transferencia: 'bank',
  cash: 'cash',
  efectivo: 'cash',
  credit_card: 'credit_card',
  credito: 'credit_card',
  tdc: 'credit_card',
  tarjeta: 'credit_card',
}

function paymentMethod(value: unknown): PaymentMethod | null {
  const text = asString(value)
  if (!text) return null
  return METHOD_ALIAS[normalizeName(text)] ?? null
}

function resolveCategory(data: Record<string, unknown>, categories: Category[], warnings: string[]): string {
  const uncategorized = categories.find((c) => c.key === UNCATEGORIZED_KEY)
  const fallback = uncategorized?.uuid ?? categories.find((c) => c.kind === 'expense' && !c.parent_id)?.uuid
  if (!fallback) throw new AiParseError('No hay categorías de gasto.')
  const wanted = asString(data.category)
  const sub = asString(data.subcategory)
  const expense = categories.filter((c) => c.kind === 'expense')
  const byName = (name: string) => expense.filter((c) => normalizeName(c.name) === normalizeName(name))
  if (!wanted && !sub) return fallback

  const parents = wanted ? byName(wanted).filter((c) => !c.parent_id) : []
  const parent = parents[0]
  if (sub) {
    const under = parent ? expense.filter((c) => c.parent_id === parent.uuid) : expense.filter((c) => c.parent_id)
    const child = under.find((c) => normalizeName(c.name) === normalizeName(sub))
    if (child) return child.uuid
    if (parent) {
      warnings.push(`«${sub}» no es subcategoría de ${parent.name}. Se usa ${parent.name}.`)
      return parent.uuid
    }
  }
  if (parent) return parent.uuid
  const children = wanted ? byName(wanted).filter((c) => c.parent_id) : []
  if (children.length === 1) return children[0].uuid
  warnings.push(`«${wanted ?? sub}» no está en tus categorías. Se usa Sin categoría.`)
  return fallback
}

function parseItems(value: unknown, warnings: string[]): ParsedReceiptItem[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    warnings.push('items no es una lista. El gasto se guarda sin productos.')
    return []
  }
  const items: ParsedReceiptItem[] = []
  value.forEach((row, index) => {
    if (typeof row !== 'object' || row === null) {
      warnings.push(`El producto ${index + 1} no se entendió y se omite.`)
      return
    }
    const record = row as Record<string, unknown>
    const name = asString(record.name)
    const qty = asNumber(record.qty)
    const unitRaw = asString(record.unit)
    const unitPrice = asNumber(record.unit_price)
    const lineTotal = asNumber(record.line_total)
    const total = lineTotal ?? (qty !== null && qty > 0 && unitPrice !== null ? roundMoney(qty * unitPrice) : null)
    if (!name || total === null || total <= 0) {
      warnings.push(`El producto ${index + 1} no tiene nombre o total, y se omite.`)
      return
    }
    const known = unitRaw && (PRICE_UNITS as readonly string[]).includes(unitRaw) ? (unitRaw as PriceUnit) : null
    const note = !known && qty !== null ? 'Sin unidad reconocida; se guarda por pieza.' : qty === null || qty <= 0 ? 'Sin cantidad, así que no entra al historial de precios.' : null
    items.push({ name, qty: qty !== null && qty > 0 ? qty : null, unit: known ?? 'pza', lineTotal: roundMoney(total), note })
  })
  return items
}

/** Validates a parse_receipt envelope against the local categories. Throws AiParseError for a broken payload. */
export function parseReceipt(raw: string, categories: Category[], today: Date): ParsedReceipt {
  const envelope = readEnvelope(raw, 'parse_receipt')
  const data = envelope.data
  const warnings = [...envelope.warnings]
  const date = isoDate(data.date)
  if (!date) throw new AiParseError('La fecha no es válida. Usa AAAA-MM-DD.')
  if (dateTooFar(date, today)) throw new AiParseError('La fecha está a más de una semana. Revísala antes de seguir.')
  const total = asNumber(data.total)
  if (total === null) throw new AiParseError('Falta el total.')
  if (total <= 0) throw new AiParseError('El total debe ser mayor a cero.')
  const currency = asString(data.currency)
  if (currency && normalizeName(currency) !== 'mxn') throw new AiParseError('Solo se registran pesos (MXN). Pide el total ya convertido.')
  const last4raw = data.last4
  let last4: string | null = null
  if (last4raw !== undefined && last4raw !== null && String(last4raw).trim() !== '') {
    const digits = String(last4raw).replace(/\D/g, '')
    if (digits.length !== 4) throw new AiParseError('last4 debe ser los últimos 4 dígitos. No pegues el número completo de la tarjeta.')
    last4 = digits
  }
  const method = paymentMethod(data.payment_method)
  if (asString(data.payment_method) && !method) warnings.push('No reconocí el método de pago. Elige uno al confirmar.')
  const items = parseItems(data.items, warnings)
  const summed = roundMoney(items.reduce((sum, item) => sum + item.lineTotal, 0))
  if (items.length > 0 && summed !== roundMoney(total)) {
    warnings.push(`Los productos suman ${summed.toFixed(2)} y el total es ${roundMoney(total).toFixed(2)}.`)
  }
  return {
    date,
    merchant: asString(data.merchant),
    total: roundMoney(total),
    paymentMethod: method,
    last4,
    categoryId: resolveCategory(data, categories, warnings),
    warnings,
    confidence: envelope.confidence,
    fieldConfidence: readFieldConfidence(data),
    items,
  }
}
