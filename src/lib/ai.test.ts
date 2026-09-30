import { describe, expect, test } from 'bun:test'
import type { Account, Category, RecurringItem, Transaction } from '../db/types'
import { AiParseError, confidenceTone, extractJson, promptIsSensitive, readEnvelope } from './aiEnvelope'
import { repairPrompt, taskPrompt } from './aiPrompt'
import { parseReceipt } from './aiReceipt'
import { classifyRow, parseStatement } from './aiStatement'
import { UNCATEGORIZED_KEY } from './categories'

const stamp = '2026-09-01T00:00:00.000Z'
const today = new Date(2026, 8, 29, 12)
const category = (uuid: string, name: string, fields: Partial<Category> = {}): Category => ({
  uuid,
  updated_at: stamp,
  key: uuid,
  name,
  kind: 'expense',
  ...fields,
})
const categories = [
  category('fun', 'Entretenimiento'),
  category('cine', 'Cine', { parent_id: 'fun' }),
  category('unc', 'Sin categoría', { key: UNCATEGORIZED_KEY }),
]
const account = { uuid: 'bank', updated_at: stamp, name: 'BBVA', type: 'checking', currency: 'MXN', current_balance: 30000, balance_date: '2026-09-01' } as Account
const tx = (fields: Partial<Transaction>) => ({ uuid: 't', updated_at: stamp, type: 'expense', date: '2026-09-12', amount: 82, currency: 'MXN', account_id: 'bank', cc_id: null, category_id: null, place_id: null, payment_method: 'bank', notes: 'Walmart', source: 'manual', ...fields }) as Transaction

const receipt = (data: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ schema_version: '1.0', task: 'parse_receipt', data, warnings: [], confidence: 0.92, ...extra })

describe('envelope', () => {
  test('fences and surrounding text still parse', () => {
    expect(extractJson('Aquí está:\n```json\n{"schema_version":"1.0","task":"parse_receipt","data":{},"warnings":[],"confidence":0.5}\n```\nlisto')).toMatchObject({ task: 'parse_receipt' })
  })

  test('a partial payload names the problem and writes nothing', () => {
    expect(() => extractJson('sin llaves')).toThrow(AiParseError)
    expect(() => readEnvelope('{"schema_version":"9","task":"parse_receipt","data":{},"confidence":1}', 'parse_receipt')).toThrow(/versión/)
    expect(() => readEnvelope(receipt({}), 'parse_bank_statement')).toThrow(/espera/)
    expect(() => readEnvelope('{"schema_version":"1.0","task":"parse_receipt","data":{},"confidence":2}', 'parse_receipt')).toThrow(/confidence/)
  })

  test('confidence bands', () => {
    expect(confidenceTone(0.81)).toBe('safe')
    expect(confidenceTone(0.8)).toBe('tight')
    expect(confidenceTone(0.5)).toBe('tight')
    expect(confidenceTone(0.49)).toBe('shortfall')
  })

  test('a prompt is sensitive only when the user added text', () => {
    expect(promptIsSensitive('  ')).toBe(false)
    expect(promptIsSensitive('Oxxo 45')).toBe(true)
    expect(taskPrompt('parse_receipt', 'Oxxo 45', categories)).toContain('Oxxo 45')
    expect(repairPrompt('parse_receipt', 'Falta el total.', '{')).toContain('Falta el total.')
  })
})

describe('parse receipt', () => {
  const good = { date: '2026-09-12', merchant: 'Walmart', total: 82, currency: 'MXN', payment_method: 'tdc', category: 'Entretenimiento', subcategory: 'Cine', items: [{ name: 'Leche', qty: 2, unit: 'L', line_total: 52 }] }

  test('maps a known subcategory and keeps the model from creating one', () => {
    const parsed = parseReceipt(receipt(good), categories, today)
    expect(parsed.categoryId).toBe('cine')
    expect(parsed.paymentMethod).toBe('credit_card')
    expect(parsed.items[0]).toMatchObject({ qty: 2, unit: 'L', lineTotal: 52 })
    expect(parsed.warnings.some((w) => w.includes('52.00'))).toBe(true)
  })

  test('an unknown subcategory stays on the parent, and an unknown category becomes Sin categoría', () => {
    expect(parseReceipt(receipt({ ...good, subcategory: 'Ópera' }), categories, today).categoryId).toBe('fun')
    const unknown = parseReceipt(receipt({ ...good, category: 'Mascotas', subcategory: null, items: [] }), categories, today)
    expect(unknown.categoryId).toBe('unc')
    expect(unknown.warnings.some((w) => w.includes('Sin categoría'))).toBe(true)
  })

  test('rejects a bad total, a far date, another currency, and a full card number', () => {
    expect(() => parseReceipt(receipt({ ...good, total: 0 }), categories, today)).toThrow(/mayor a cero/)
    expect(() => parseReceipt(receipt({ ...good, date: '2026-12-01' }), categories, today)).toThrow(/semana/)
    expect(() => parseReceipt(receipt({ ...good, currency: 'USD' }), categories, today)).toThrow(/MXN/)
    expect(() => parseReceipt(receipt({ ...good, last4: '4111111111111111' }), categories, today)).toThrow(/4 dígitos/)
  })
})

describe('parse statement', () => {
  const bill = { uuid: 'rent', updated_at: stamp, name: 'Renta', type: 'bill', amount: 8000, due_day: 2, account_id: 'bank', category_id: null, start_date: '2026-01-01', active: true } as RecurringItem
  const body = (transactions: unknown[]) => JSON.stringify({ schema_version: '1.0', task: 'parse_bank_statement', data: { account_name: 'bbva', closing_balance: 29000, transactions }, warnings: [], confidence: 0.4 })

  test('flags an exact duplicate, a possible one, and a bill', () => {
    const parsed = parseStatement(body([
      { date: '2026-09-12', amount: -82, description: 'WALMART' },
      { date: '2026-09-12', amount: -82, description: 'Oxxo' },
      { date: '2026-09-02', amount: -8000, description: 'Pago renta' },
    ]), { accounts: [account], transactions: [tx({})], recurring: [bill] }, today)
    expect(parsed.matchedAccountId).toBe('bank')
    expect(parsed.rows.map((row) => row.duplicate)).toEqual(['exact', 'possible', null])
    expect(parsed.rows[2].recurringName).toBe('Renta')
    expect(classifyRow({ date: '2026-09-12', amount: 10, direction: 'in', description: 'Nómina' }, [], [])).toEqual({ duplicate: null, recurringName: null })
  })

  test('an empty statement does not parse', () => {
    expect(() => parseStatement(body([]), { accounts: [], transactions: [], recurring: [] }, today)).toThrow(/movimientos/)
  })
})
