import { useState, type FormEvent } from 'react'
import { removeOverride, setOverride } from '../db/commitments'
import type { RecurringOverride } from '../db/types'
import type { MoneyData } from '../db/useMoneyData'
import { formatDate, formatMoney } from '../lib/format'
import { incomeDatesBetween, lowestAlong } from '../lib/loanTimeline'
import { parseAmount } from '../lib/parseAmount'
import { PROJECTION_HORIZON_DAYS, projectedAvailable } from '../lib/projection'
import { moneySnapshot } from '../lib/snapshot'
import type { TimelineEvent } from '../lib/timeline'
import { AmountField, FieldError, FieldNote, FormActions } from './fields'

const money = (value: number | null) => (value === null ? '—' : formatMoney(value, 'MXN'))
const change = (before: number, after: number) => (before === after ? money(before) : `${money(before)} → ${money(after)}`)

function noon(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12)
}

function incomePreview(data: MoneyData, next: MoneyData, date: Date) {
  const today = noon(new Date())
  const horizon = new Date(today.getFullYear(), today.getMonth(), today.getDate() + PROJECTION_HORIZON_DAYS, 12)
  const dates = [today, ...incomeDatesBetween(data, today, horizon), horizon]
  return {
    on: { before: projectedAvailable(data, today, noon(date)), after: projectedAvailable(next, today, noon(date)) },
    lowest: { before: lowestAlong(data, today, dates), after: lowestAlong(next, today, dates) },
  }
}

export function AdjustOccurrenceForm({ data, event, onDone }: { data: MoneyData; event: TimelineEvent; onDone: () => void }) {
  const { item, occurrence, override } = event.recurring!
  const income = item.type === 'income'
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
  const next = { ...data, overrides: draft ? [...others, draft] : others }
  const now = new Date()
  const before = income ? 0 : moneySnapshot(data, now).breakdown.total
  const after = income ? 0 : moneySnapshot(next, now).breakdown.total
  const preview = income ? incomePreview(data, next, event.date) : null

  async function submit(submitEvent: FormEvent) {
    submitEvent.preventDefault()
    if (invalid) return setError(income ? 'Revisa el monto. Puede ser 0 si este periodo no hay ingreso.' : 'Revisa el monto. Puede ser 0 si este periodo no hay cargo.')
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
        <span className="dim">{income ? 'Este ingreso' : 'Este pago'}</span>
        <span className="mono">{invalid ? '—' : money(value ?? usual)}</span>
      </div>
      {preview ? (
        <>
          <div className="readout">
            <span className="dim">{`Disponible real proyectado al ${formatDate(event.date)}`}</span>
            <span className="mono">{change(preview.on.before, preview.on.after)}</span>
          </div>
          <div className="readout">
            <span className="dim">{`Punto más bajo en ${PROJECTION_HORIZON_DAYS} días (${formatDate(preview.lowest.after.date)})`}</span>
            <span className={`mono${preview.lowest.after.available < 0 ? ' text-heat' : ''}`}>
              {change(preview.lowest.before.available, preview.lowest.after.available)}
            </span>
          </div>
        </>
      ) : (
        <div className="readout">
          <span className="dim">Disponible real</span>
          <span className="mono">{change(before, after)}</span>
        </div>
      )}
      {value === 0 &&
        (income ? (
          <FieldNote>Sin ingreso este periodo: no se proyecta nada, y sigue pendiente hasta que lo registres o quites el ajuste. Tus días de ingreso no cambian.</FieldNote>
        ) : (
          <FieldNote>Sin cargo este periodo: no se aparta nada, y sigue pendiente hasta que lo registres o quites el ajuste.</FieldNote>
        ))}
      {!income && !invalid && !unchanged && before === after && item.frequency === 'once' && (
        <FieldNote>Esta factura todavía no se aparta. Empieza el día en que la generaste.</FieldNote>
      )}
      {!income && !invalid && !unchanged && before === after && item.frequency !== 'once' && (
        <FieldNote>Esta fecha cae después de tu próximo ingreso. Cambia la proyección, no tu Disponible real de hoy.</FieldNote>
      )}
      <FieldNote>
        {income
          ? 'Solo cambia lo que esperas recibir en esta fecha. Tu Disponible real de hoy no cambia, no registra el ingreso ni cambia el monto de siempre.'
          : 'Solo cambia lo que se aparta para esta fecha. No registra el pago ni cambia el monto de siempre.'}
      </FieldNote>
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
