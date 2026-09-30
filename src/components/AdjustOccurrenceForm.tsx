import { useState, type FormEvent } from 'react'
import { removeOverride, setOverride } from '../db/commitments'
import type { RecurringOverride } from '../db/types'
import type { MoneyData } from '../db/useMoneyData'
import { formatDate, formatMoney } from '../lib/format'
import { parseAmount } from '../lib/parseAmount'
import { moneySnapshot } from '../lib/snapshot'
import type { TimelineEvent } from '../lib/timeline'
import { AmountField, FieldError, FieldNote, FormActions } from './fields'

const money = (value: number | null) => (value === null ? '—' : formatMoney(value, 'MXN'))

/** Adjusted amounts can only be set on a bill that is still ahead and unregistered. */
export function canAdjust(event: TimelineEvent, today: Date): boolean {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return event.bill !== undefined && !event.paid && event.date >= start
}

export function adjustedNote(event: TimelineEvent): string | null {
  if (!event.bill?.override) return null
  if (event.amount === 0) return 'Sin cargo este periodo'
  return `normalmente ${money(event.bill.item.amount)}`
}

export function AdjustOccurrenceForm({ data, event, onDone }: { data: MoneyData; event: TimelineEvent; onDone: () => void }) {
  const { item, occurrence, override } = event.bill!
  const usual = item.amount
  const [amount, setAmount] = useState(event.amount === null ? '' : String(event.amount))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const empty = amount.trim() === ''
  const value = empty ? null : parseAmount(amount)
  const invalid = !empty && (value === null || value < 0)
  const backToUsual = empty ? usual === null : value === usual
  const unchanged = override ? value === override.amount : backToUsual

  const draft: RecurringOverride | null = !invalid && value !== null && !backToUsual
    ? { ...(override ?? { uuid: 'draft', updated_at: '', recurring_id: item.uuid, occurrence }), amount: value }
    : null
  const others = data.overrides.filter((row) => row !== override)
  const now = new Date()
  const before = moneySnapshot(data, now).breakdown.total
  const after = moneySnapshot({ ...data, overrides: draft ? [...others, draft] : others }, now).breakdown.total

  async function submit(submitEvent: FormEvent) {
    submitEvent.preventDefault()
    if (invalid) return setError('Revisa el monto. Puede ser 0 si este periodo no hay cargo.')
    if (unchanged) return onDone()
    setSaving(true)
    try {
      if (draft) await setOverride(override, { recurring_id: item.uuid, occurrence, amount: draft.amount })
      else if (override) await removeOverride(override)
      onDone()
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <AmountField label={`${item.name} · ${formatDate(event.date)} (MXN)`} value={amount} onChange={setAmount} />
      <div className="readout">
        <span className="dim">Normalmente</span>
        <span className="mono">{money(usual)}</span>
      </div>
      <div className="readout">
        <span className="dim">Este pago</span>
        <span className="mono">{invalid ? '—' : money(value ?? usual)}</span>
      </div>
      <div className="readout">
        <span className="dim">Disponible real</span>
        <span className="mono">{before === after ? money(before) : `${money(before)} → ${money(after)}`}</span>
      </div>
      {value === 0 && <FieldNote>Sin cargo este periodo: no se aparta nada, y sigue pendiente hasta que lo registres o quites el ajuste.</FieldNote>}
      {!invalid && !unchanged && before === after && (
        <FieldNote>Esta fecha cae después de tu próximo ingreso. Cambia la proyección, no tu Disponible real de hoy.</FieldNote>
      )}
      <FieldNote>Solo cambia lo que se aparta para esta fecha. No registra el pago ni cambia el monto de siempre.</FieldNote>
      {override && (
        <button type="button" className="panel-verb" onClick={() => setAmount(usual === null ? '' : String(usual))}>
          Quitar ajuste
        </button>
      )}
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel={draft ? 'Confirmar ajuste' : override ? 'Quitar ajuste' : 'Listo'} saving={saving} onCancel={onDone} />
    </form>
  )
}
