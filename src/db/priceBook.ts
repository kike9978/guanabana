import { matchName, NEW_ITEM, normalizeName, resolveLine, type LineDraft } from '../lib/priceBook'
import { newRecord } from './db'
import type { LineWrite } from './ledger'
import type { Item, Place, PlaceKind, TransactionLine } from './types'

export interface PlaceDraft {
  name: string
  kind: PlaceKind
  area: string
}

/** An existing place with the same normalized name is reused; otherwise a new row. */
export function resolvePlace(draft: PlaceDraft, places: Place[]): { place: Place; created: boolean } | { error: string } {
  const name = draft.name.trim()
  if (!name) return { error: 'Ponle nombre al lugar.' }
  const exact = matchName(name, places).exact
  if (exact) return { place: exact, created: false }
  const area = draft.area.trim()
  return { place: newRecord<Place>({ name, normalized_name: normalizeName(name), kind: draft.kind, area: area || null }), created: true }
}

export type LinePlan = { build: (transactionId: string) => LineWrite } | { error: string; key?: string }

/**
 * Validates every draft line before the expense is saved. Blank rows are skipped.
 * Two lines with the same name on one ticket share one new item.
 */
export function planLines(
  drafts: LineDraft[],
  context: { items: Item[]; place: Place | null; newPlace: Place | null; date: string; categoryId: string | null; parse: (value: string) => number | null },
): LinePlan {
  const created: Item[] = []
  const rows: { item: Item; draft: LineDraft; values: { qty: number | null; unit_price: number | null; line_total: number } }[] = []

  for (const draft of drafts) {
    const blank = !draft.name.trim() && !draft.qty.trim() && !draft.unitPrice.trim() && !draft.total.trim()
    if (blank) continue
    if (!draft.name.trim()) return { error: 'Ponle nombre a cada producto.', key: draft.key }
    const values = resolveLine(draft, context.parse)
    if ('error' in values) return { error: values.error, key: draft.key }

    const known = [...context.items, ...created]
    const exact = matchName(draft.name, known).exact
    let item = exact ?? (draft.itemChoice && draft.itemChoice !== NEW_ITEM ? known.find((i) => i.uuid === draft.itemChoice) : undefined)
    if (!item && matchName(draft.name, context.items).near.length > 0 && draft.itemChoice !== NEW_ITEM) {
      return { error: 'Confirma si los productos marcados son el mismo.', key: draft.key }
    }
    if (!item) {
      item = newRecord<Item>({
        name: draft.name.trim(),
        normalized_name: normalizeName(draft.name),
        default_unit: draft.unit,
        category_id: context.categoryId,
        barcode: null,
      })
      created.push(item)
    }
    rows.push({ item, draft, values })
  }

  return {
    build: (transactionId) => ({
      places: context.newPlace ? [context.newPlace] : [],
      items: created,
      lines: rows.map(({ item, draft, values }) =>
        newRecord<TransactionLine>({
          transaction_id: transactionId,
          item_id: item.uuid,
          place_id: context.place?.uuid ?? null,
          date: context.date,
          qty: values.qty,
          unit: draft.unit,
          unit_price: values.unit_price,
          line_total: values.line_total,
          currency: 'MXN',
        }),
      ),
    }),
  }
}
