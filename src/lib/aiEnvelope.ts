import type { AiTask } from '../db/types'

export const SCHEMA_VERSION = '1.0'

export const TASK_LABEL: Record<AiTask, string> = {
  parse_receipt: 'Ticket',
  parse_bank_statement: 'Estado de cuenta',
}

export class AiParseError extends Error {
  constructor(message: string) {
    super(message)
  }
}

/** The JSON object inside fences or prose. Same text hashes as the same response. */
export function jsonPayload(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) throw new AiParseError('No encontré un JSON. Pega la respuesta completa, con o sin ```.')
  return body.slice(start, end + 1)
}

/** Fences and surrounding prose are ignored. The first `{` through the last `}` is the payload. */
export function extractJson(raw: string): unknown {
  try {
    return JSON.parse(jsonPayload(raw)) as unknown
  } catch (error) {
    if (error instanceof AiParseError) throw error
    throw new AiParseError('El JSON está incompleto o mal formado. Usa el prompt de reparación; no se guardó nada.')
  }
}

export interface Envelope {
  data: Record<string, unknown>
  warnings: string[]
  confidence: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readEnvelope(raw: string, task: AiTask): Envelope {
  const parsed = extractJson(raw)
  if (!isRecord(parsed)) throw new AiParseError('La respuesta tiene que ser un objeto JSON.')
  if (parsed.schema_version !== SCHEMA_VERSION) {
    throw new AiParseError(`La versión del esquema debe ser ${SCHEMA_VERSION}.`)
  }
  if (parsed.task !== task) {
    throw new AiParseError(`Esta respuesta es para «${String(parsed.task)}». Aquí se espera ${task}.`)
  }
  if (!isRecord(parsed.data)) throw new AiParseError('Falta el objeto data.')
  const confidence = parsed.confidence
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new AiParseError('confidence debe ser un número entre 0 y 1.')
  }
  const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.filter((w): w is string => typeof w === 'string' && w.trim() !== '') : []
  return { data: parsed.data, warnings, confidence }
}

export interface FieldConfidence {
  [field: string]: number
}

export function readFieldConfidence(data: Record<string, unknown>): FieldConfidence {
  const raw = data.field_confidence
  if (!isRecord(raw)) return {}
  const out: FieldConfidence = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'number' && value >= 0 && value <= 1) out[key] = value
  }
  return out
}

/** Cyan above 0.8, amber from 0.5 to 0.8, heat below 0.5. */
export function confidenceTone(value: number): 'safe' | 'tight' | 'shortfall' {
  if (value > 0.8) return 'safe'
  if (value >= 0.5) return 'tight'
  return 'shortfall'
}

export const WEAK_CONFIDENCE = 0.6

export function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return value
}

/** A date more than a week ahead is rejected. */
export function dateTooFar(iso: string, today: Date): boolean {
  const limit = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7, 12)
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day, 12) > limit
}

export function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/,/g, ''))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** The ticket or statement the user typed is what makes a prompt sensitive. */
export function promptIsSensitive(context: string): boolean {
  return context.trim().length > 0
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
