import type { AiTask, Category } from '../db/types'
import { SCHEMA_VERSION } from './aiEnvelope'
import { isTopLevel } from './categories'

const RECEIPT_SHAPE = `{
  "schema_version": "${SCHEMA_VERSION}",
  "task": "parse_receipt",
  "data": {
    "date": "AAAA-MM-DD",
    "merchant": "nombre del comercio o null",
    "total": 0,
    "currency": "MXN",
    "payment_method": "bank | cash | credit_card | null",
    "last4": "solo 4 digitos o null",
    "category": "una categoria de la lista o null",
    "subcategory": "una subcategoria de esa categoria o null",
    "items": [{ "name": "", "qty": 1, "unit": "pza | kg | g | L | ml", "unit_price": 0, "line_total": 0 }],
    "field_confidence": { "date": 0.9, "merchant": 0.9, "total": 0.9, "category": 0.9, "items": 0.9 }
  },
  "warnings": [],
  "confidence": 0.9
}`

const STATEMENT_SHAPE = `{
  "schema_version": "${SCHEMA_VERSION}",
  "task": "parse_bank_statement",
  "data": {
    "account_name": "nombre del banco o null",
    "period_start": "AAAA-MM-DD",
    "period_end": "AAAA-MM-DD",
    "closing_balance": 0,
    "transactions": [{ "date": "AAAA-MM-DD", "amount": -82.0, "description": "" }],
    "field_confidence": { "transactions": 0.9, "closing_balance": 0.9 }
  },
  "warnings": [],
  "confidence": 0.9
}`

function categoryList(categories: Category[]): string {
  return categories
    .filter((c) => c.kind === 'expense' && isTopLevel(c) && !c.archived)
    .map((parent) => {
      const children = categories.filter((c) => c.parent_id === parent.uuid && !c.archived).map((c) => c.name)
      return children.length > 0 ? `${parent.name} (${children.join(', ')})` : parent.name
    })
    .join('; ')
}

const RULES = [
  'Responde solo con el JSON. Sin explicación y sin markdown.',
  'No inventes montos, fechas ni comercios. Si no estás seguro, baja confidence y dilo en warnings.',
  'No crees categorías nuevas. Si ninguna coincide, usa null.',
  'Montos en MXN. No conviertas divisas.',
  'Nunca incluyas un número de tarjeta completo. last4 son solo 4 dígitos.',
  'confidence y cada field_confidence van de 0 a 1.',
].join('\n')

export function taskPrompt(task: AiTask, context: string, categories: Category[]): string {
  const shape = task === 'parse_receipt' ? RECEIPT_SHAPE : STATEMENT_SHAPE
  const list = task === 'parse_receipt' ? `\nCategorías de gasto, con subcategorías entre paréntesis: ${categoryList(categories) || 'ninguna'}.\n` : ''
  const body = context.trim() ? `\nTexto a leer:\n${context.trim()}\n` : '\nNo te di texto. Devuelve el JSON con los campos en null y confidence 0.\n'
  return `Eres un asistente que convierte texto en JSON para una app de gastos. No des consejos.\n\n${RULES}\n${list}\nUsa exactamente esta forma:\n${shape}\n${body}`
}

export function repairPrompt(task: AiTask, errors: string, badJson: string): string {
  const shape = task === 'parse_receipt' ? RECEIPT_SHAPE : STATEMENT_SHAPE
  return `El JSON anterior no pasó la validación. Corrígelo y responde solo con el JSON.\n\nErrores:\n${errors}\n\nForma exigida:\n${shape}\n\nJSON rechazado:\n${badJson.trim()}\n`
}
