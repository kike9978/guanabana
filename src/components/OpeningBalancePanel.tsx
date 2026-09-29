import { useState, type FormEvent } from 'react'
import { saveOpeningBalance } from '../db/accounts'
import type { Account } from '../db/types'
import { formatDate, formatMoney } from '../lib/format'
import { todayIso } from '../lib/dates'
import { parseAmount } from '../lib/parseAmount'
import { FooterHint, Panel } from './hud'

function OpeningBalanceForm({ existing, onDone }: { existing?: Account; onDone: () => void }) {
  const [amount, setAmount] = useState(existing ? String(existing.current_balance) : '')
  const [date, setDate] = useState(existing?.balance_date ?? todayIso())
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const value = parseAmount(amount)
    if (value === null) {
      setError('Escribe un monto como 12500 o 12,500.50.')
      return
    }
    setSaving(true)
    try {
      await saveOpeningBalance(value, date)
      onDone()
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <label className="field">
        <span className="field-label">Monto disponible hoy (MXN)</span>
        <input
          className="input mono"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value)
            setError(null)
          }}
          aria-invalid={error !== null}
          autoFocus={existing !== undefined}
        />
      </label>
      <label className="field">
        <span className="field-label">Fecha del saldo</span>
        <input
          className="input mono"
          type="date"
          value={date}
          max={todayIso()}
          onChange={(event) => setDate(event.target.value)}
          required
        />
      </label>
      {existing && (
        <p className="field-note">
          Antes: <span className="mono">{formatMoney(existing.current_balance, existing.currency)}</span>
        </p>
      )}
      {error && <p className="field-error">{error}</p>}
      <div className="verb-row">
        <button type="submit" className="verb-button verb-primary" disabled={saving}>
          <span className="key-glyph">A</span>
          Guardar saldo
        </button>
        {existing && (
          <button type="button" className="verb-button" onClick={onDone}>
            <span className="key-glyph">B</span>
            Cancelar
          </button>
        )}
      </div>
    </form>
  )
}

export function OpeningBalancePanel({ opening }: { opening?: Account }) {
  const [editing, setEditing] = useState(false)

  if (!opening || editing) {
    return (
      <Panel title="Saldo inicial">
        <OpeningBalanceForm existing={opening} onDone={() => setEditing(false)} />
        {!opening && (
          <FooterHint>Escribe cuánto tienes hoy. Después puedes repartirlo entre banco y efectivo.</FooterHint>
        )}
      </Panel>
    )
  }

  return (
    <Panel
      title="Saldo inicial"
      aside={
        <button type="button" className="panel-verb" onClick={() => setEditing(true)}>
          Ajustar
        </button>
      }
    >
      <div className="readout">
        <span>Sin origen · {formatDate(new Date(`${opening.balance_date}T12:00:00`))}</span>
        <span className="mono">{formatMoney(opening.current_balance, opening.currency)}</span>
      </div>
    </Panel>
  )
}
