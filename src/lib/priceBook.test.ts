import { describe, expect, test } from 'bun:test'
import { planLines, resolvePlace } from '../db/priceBook'
import type { Item, Place, TransactionLine } from '../db/types'
import { parseAmount } from './parseAmount'
import {
  cheapestRecent,
  emptyLine,
  matchName,
  NEW_ITEM,
  normalizeName,
  observationsOf,
  priceRoster,
  resolveLine,
  unitPrice,
  type LineDraft,
} from './priceBook'

const stamp = '2026-09-01T00:00:00.000Z'
const place = (uuid: string, name: string): Place => ({ uuid, updated_at: stamp, name, normalized_name: normalizeName(name), kind: 'supermarket', area: null })
const item = (uuid: string, name: string): Item => ({ uuid, updated_at: stamp, name, normalized_name: normalizeName(name), default_unit: 'L', category_id: null })
const chedraui = place('ched', 'Chedraui')
const walmart = place('wal', 'Walmart')
const leche = item('leche', 'Leche')

let seq = 0
const line = (fields: Partial<TransactionLine>): TransactionLine => ({
  uuid: `l${seq++}`,
  updated_at: stamp,
  transaction_id: 't',
  item_id: 'leche',
  place_id: null,
  date: '2026-09-01',
  qty: 1,
  unit: 'L',
  unit_price: 28.5,
  line_total: 28.5,
  currency: 'MXN',
  ...fields,
})
const draft = (fields: Partial<LineDraft>): LineDraft => ({ ...emptyLine(), ...fields })

describe('names', () => {
  test('normalize trims, lowercases, and strips accents', () => {
    expect(normalizeName('  Plátano   Tabasco ')).toBe('platano tabasco')
  })

  test('an exact normalized match reuses; a typo or a contained word only asks', () => {
    expect(matchName('LECHE', [leche]).exact).toBe(leche)
    expect(matchName('Lechee', [leche]).near).toEqual([leche])
    expect(matchName('Leche entera', [leche]).near).toEqual([leche])
    expect(matchName('Pan', [leche]).near).toEqual([])
  })
})

describe('lines', () => {
  test('unit price is total / qty, and empty without qty', () => {
    expect(unitPrice(57, 2)).toBe(28.5)
    expect(unitPrice(57, null)).toBeNull()
  })

  test('total wins; without it, qty × unit price', () => {
    expect(resolveLine({ qty: '2', unitPrice: '10', total: '' }, parseAmount)).toEqual({ qty: 2, unit_price: 10, line_total: 20 })
    expect(resolveLine({ qty: '', unitPrice: '', total: '45' }, parseAmount)).toEqual({ qty: null, unit_price: null, line_total: 45 })
    expect(resolveLine({ qty: '0', unitPrice: '', total: '45' }, parseAmount)).toHaveProperty('error')
    expect(resolveLine({ qty: '', unitPrice: '10', total: '' }, parseAmount)).toHaveProperty('error')
  })

  test('a near match blocks until confirmed; the same name twice on one ticket makes one item', () => {
    const context = { items: [leche], place: null, newPlace: null, date: '2026-09-12', categoryId: null, parse: parseAmount }
    expect(planLines([draft({ name: 'Lechee', total: '26' })], context)).toHaveProperty('error')
    const same = planLines([draft({ name: 'Lechee', total: '26', itemChoice: 'leche' })], context)
    if ('error' in same) throw new Error(same.error)
    expect(same.build('t1').lines[0].item_id).toBe('leche')
    expect(same.build('t1').items).toEqual([])

    const fresh = planLines([draft({ name: 'Pan', total: '30' }), draft({ name: 'pan ', total: '15' }), draft({})], context)
    if ('error' in fresh) throw new Error(fresh.error)
    const write = fresh.build('t2')
    expect(write.items).toHaveLength(1)
    expect(write.lines).toHaveLength(2)
    expect(new Set(write.lines.map((l) => l.item_id)).size).toBe(1)
    expect(write.lines.every((l) => l.transaction_id === 't2' && l.date === '2026-09-12')).toBe(true)

    const other = planLines([draft({ name: 'Lechee', total: '26', itemChoice: NEW_ITEM })], context)
    if ('error' in other) throw new Error(other.error)
    expect(other.build('t3').items[0].name).toBe('Lechee')
  })

  test('a new place with a known name reuses the existing row', () => {
    const reused = resolvePlace({ name: ' chedraui ', kind: 'market', area: '' }, [chedraui])
    expect('place' in reused && reused.place.uuid).toBe('ched')
    expect('place' in reused && reused.created).toBe(false)
  })
})

describe('price history', () => {
  const lines = [
    line({ date: '2026-09-01', place_id: 'ched', unit_price: 28.5, line_total: 28.5 }),
    line({ date: '2026-09-12', place_id: 'wal', qty: 2, unit_price: 26, line_total: 52 }),
    line({ date: '2026-09-20', place_id: 'ched', unit: 'ml', qty: 500, unit_price: 0.058, line_total: 29 }),
    line({ date: '2026-09-21', place_id: null, qty: null, unit_price: null, line_total: 40 }),
    line({ date: '2026-09-15', item_id: 'pza', unit: 'pza', unit_price: 5, line_total: 5 }),
  ]

  test('grams and millilitres compare per kg and per litre; unpriced lines stay off the chart', () => {
    const obs = observationsOf('leche', lines, [chedraui, walmart])
    expect(obs.map((o) => o.price)).toEqual([28.5, 26, 58])
    expect(obs.every((o) => o.family === 'volume')).toBe(true)
  })

  test('the cheapest recent place uses each place’s latest price', () => {
    const obs = observationsOf('leche', lines, [chedraui, walmart])
    const cheapest = cheapestRecent(obs, new Date(2026, 8, 29, 12))
    expect(cheapest?.place?.name).toBe('Walmart')
    expect(cheapestRecent(obs, new Date(2027, 5, 1, 12))).toBeNull()
  })

  test('the roster shows the last line, its place, and the last priced observation', () => {
    const [row] = priceRoster([leche], lines, [chedraui, walmart])
    expect(row.lastLine.date).toBe('2026-09-21')
    expect(row.place).toBeNull()
    expect(row.last?.price).toBe(58)
    expect(row.count).toBe(4)
    expect(priceRoster([item('ghost', 'Ghost')], lines, [])).toEqual([])
  })
})
