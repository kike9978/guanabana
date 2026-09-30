import type { Item, Place, PriceUnit, TransactionLine } from '../db/types'
import { dateToIso } from './dates'
import { roundMoney } from './money'

export const PRICE_UNITS: readonly PriceUnit[] = ['pza', 'kg', 'g', 'L', 'ml']

export type UnitFamily = 'piece' | 'weight' | 'volume'

export const UNIT_FAMILY: Record<PriceUnit, UnitFamily> = { pza: 'piece', kg: 'weight', g: 'weight', L: 'volume', ml: 'volume' }

/** Prices compare per kg, per L, or per piece. */
export const BASE_UNIT: Record<UnitFamily, PriceUnit> = { piece: 'pza', weight: 'kg', volume: 'L' }

const TO_BASE: Record<PriceUnit, number> = { pza: 1, kg: 1, g: 1000, L: 1, ml: 1000 }

export const NO_PLACE = 'Sin lugar'

export const NEW_PLACE = 'new'

export const PLACE_KINDS = [
  { value: 'supermarket', label: 'Súper' },
  { value: 'market', label: 'Mercado' },
  { value: 'convenience', label: 'Tiendita' },
  { value: 'other', label: 'Otro' },
] as const satisfies readonly { value: Place['kind']; label: string }[]

export const RECENT_DAYS = 90

export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return row[b.length]
}

/** Exact normalized matches reuse the record. Near ones (a typo, or one name inside the other) only ask. */
export function matchName<T extends { normalized_name: string }>(name: string, candidates: T[]): { exact: T | null; near: T[] } {
  const target = normalizeName(name)
  if (!target) return { exact: null, near: [] }
  const exact = candidates.find((c) => c.normalized_name === target) ?? null
  if (exact) return { exact, near: [] }
  const allowed = target.length >= 5 ? 2 : 1
  const near = candidates.filter((c) => {
    const other = c.normalized_name
    if (distance(target, other) <= allowed) return true
    const [short, long] = target.length <= other.length ? [target, other] : [other, target]
    return short.length >= 3 && long.split(' ').includes(short)
  })
  return { exact: null, near }
}

/** Four decimals, so a price per g or per ml still converts to an exact price per kg or L. */
export function unitPrice(lineTotal: number, qty: number | null): number | null {
  return qty !== null && qty > 0 ? Math.round((lineTotal / qty) * 10_000) / 10_000 : null
}

export interface LineInput {
  qty: string
  unitPrice: string
  total: string
}

/** Line total wins; without it, qty × unit price. Unit price is derived from the total so both always agree. */
export function resolveLine(
  input: LineInput,
  parse: (value: string) => number | null,
): { qty: number | null; unit_price: number | null; line_total: number } | { error: string } {
  const qty = input.qty.trim() ? parse(input.qty) : null
  if (input.qty.trim() && (qty === null || qty <= 0)) return { error: 'La cantidad debe ser mayor a cero.' }
  const typedTotal = input.total.trim() ? parse(input.total) : null
  const typedPrice = input.unitPrice.trim() ? parse(input.unitPrice) : null
  const total = typedTotal ?? (typedPrice !== null && qty !== null ? roundMoney(typedPrice * qty) : null)
  if (total === null || total <= 0) return { error: 'Escribe el total o la cantidad y el precio.' }
  return { qty, unit_price: unitPrice(total, qty), line_total: total }
}

export interface LineDraft extends LineInput {
  key: string
  name: string
  unit: PriceUnit
  /** An existing item the user confirmed for a near match, or 'new' to keep it separate. */
  itemChoice: string | null
}

export const NEW_ITEM = 'new'

export function emptyLine(): LineDraft {
  return { key: crypto.randomUUID(), name: '', qty: '', unit: 'pza', unitPrice: '', total: '', itemChoice: null }
}

export function lineToDraft(line: TransactionLine, items: Item[]): LineDraft {
  return {
    key: line.uuid,
    name: items.find((i) => i.uuid === line.item_id)?.name ?? '',
    qty: line.qty === null ? '' : String(line.qty),
    unit: line.unit,
    unitPrice: '',
    total: String(line.line_total),
    itemChoice: line.item_id,
  }
}

/** Near matches still waiting for “es el mismo” or “es otro”. */
export function pendingMatch(draft: LineDraft, items: Item[]): Item[] {
  if (draft.itemChoice) return []
  return matchName(draft.name, items).near
}

export interface PriceObservation {
  line: TransactionLine
  place: Place | null
  family: UnitFamily
  /** Unit price per kg, per L, or per piece. */
  price: number
}

export function comparablePrice(unit: PriceUnit, unit_price: number): { family: UnitFamily; price: number } {
  return { family: UNIT_FAMILY[unit], price: roundMoney(unit_price * TO_BASE[unit]) }
}

export function observation(line: TransactionLine, places: Place[]): PriceObservation | null {
  if (line.unit_price === null) return null
  return { line, place: places.find((p) => p.uuid === line.place_id) ?? null, ...comparablePrice(line.unit, line.unit_price) }
}

const byDate = (a: TransactionLine, b: TransactionLine) => a.date.localeCompare(b.date) || a.updated_at.localeCompare(b.updated_at)

/** Priced observations of one item, oldest first. */
export function observationsOf(itemId: string, lines: TransactionLine[], places: Place[]): PriceObservation[] {
  return lines
    .filter((line) => line.item_id === itemId)
    .sort(byDate)
    .flatMap((line) => observation(line, places) ?? [])
}

export interface PriceRow {
  item: Item
  lastLine: TransactionLine
  last: PriceObservation | null
  place: Place | null
  count: number
}

/** Items with at least one line, most recently bought first. */
export function priceRoster(items: Item[], lines: TransactionLine[], places: Place[]): PriceRow[] {
  return items
    .flatMap((item) => {
      const own = lines.filter((line) => line.item_id === item.uuid).sort(byDate)
      if (own.length === 0) return []
      const lastLine = own[own.length - 1]
      const priced = own.flatMap((line) => observation(line, places) ?? [])
      return [
        {
          item,
          lastLine,
          last: priced[priced.length - 1] ?? null,
          place: places.find((p) => p.uuid === lastLine.place_id) ?? null,
          count: own.length,
        },
      ]
    })
    .sort((a, b) => byDate(b.lastLine, a.lastLine))
}

/** Each place's latest price in the window; the lowest wins. Ties go to the more recent date. */
export function cheapestRecent(observations: PriceObservation[], today: Date, days = RECENT_DAYS): PriceObservation | null {
  const since = new Date(today)
  since.setDate(since.getDate() - days)
  const from = dateToIso(since)
  const latest = new Map<string, PriceObservation>()
  for (const obs of observations) {
    if (obs.line.date < from) continue
    latest.set(obs.line.place_id ?? '', obs)
  }
  return [...latest.values()].reduce<PriceObservation | null>(
    (best, obs) => (!best || obs.price < best.price || (obs.price === best.price && obs.line.date > best.line.date) ? obs : best),
    null,
  )
}

export function placeName(place: Place | null): string {
  return place ? place.name : NO_PLACE
}

export function formatUnitPrice(price: number, family: UnitFamily): string {
  return `${price.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / ${BASE_UNIT[family]}`
}
