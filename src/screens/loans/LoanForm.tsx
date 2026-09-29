import { useState, type FormEvent } from 'react'
import { AmountField, ChoiceField, FieldError, FieldNote, FormActions, SelectField, TextField } from '../../components/fields'
import { isLiquid, selectable } from '../../db/accounts'
import { createLoan } from '../../db/commitments'
import type { LoanDirection, LoanFrequency, LoanInterest } from '../../db/types'
import type { MoneyData } from '../../db/useMoneyData'
import { isoToDate, todayIso } from '../../lib/dates'
import { formatDate, formatMoney } from '../../lib/format'
import { buildSchedule, type ScheduleRow } from '../../lib/loans'
import { roundMoney } from '../../lib/money'
import { parseAmount } from '../../lib/parseAmount'

const DIRECTIONS: { value: LoanDirection; label: string }[] = [
  { value: 'borrowed', label: 'Yo debo' },
  { value: 'lent', label: 'Me deben' },
]

const INTEREST: { value: LoanInterest; label: string }[] = [
  { value: 'none', label: 'Sin interés' },
  { value: 'fixed_installment', label: 'Cuota fija' },
  { value: 'fixed_rate', label: 'Tasa anual' },
]

const FREQUENCIES: { value: LoanFrequency; label: string }[] = [
  { value: 'monthly', label: 'Mensual' },
  { value: 'biweekly', label: 'Cada 14 días' },
]

const money = (value: number) => formatMoney(value, 'MXN')
const date = (iso: string) => formatDate(isoToDate(iso))

type RowOverride = { due_date?: string; amount?: string }

function applyOverrides(rows: ScheduleRow[], overrides: Record<number, RowOverride>, interest: LoanInterest): ScheduleRow[] {
  return rows.map((row, index) => {
    const override = overrides[index]
    if (!override) return row
    const next = { ...row, due_date: override.due_date || row.due_date }
    const amount = override.amount === undefined ? null : parseAmount(override.amount)
    if (amount === null || interest === 'fixed_rate') return next
    if (interest === 'none') return { ...next, amount, principal_part: amount, interest_part: 0 }
    return { ...next, amount, interest_part: roundMoney(Math.max(0, amount - row.principal_part)) }
  })
}

export function LoanForm({ data, onDone }: { data: MoneyData; onDone: () => void }) {
  const [direction, setDirection] = useState<LoanDirection>('borrowed')
  const [name, setName] = useState('')
  const [who, setWho] = useState('')
  const [principal, setPrincipal] = useState('')
  const [interest, setInterest] = useState<LoanInterest>('none')
  const [rate, setRate] = useState('')
  const [installment, setInstallment] = useState('')
  const [frequency, setFrequency] = useState<LoanFrequency>('monthly')
  const [firstDue, setFirstDue] = useState(todayIso())
  const [count, setCount] = useState('')
  const [settled, setSettled] = useState('')
  const [accountId, setAccountId] = useState('')
  const [editingRows, setEditingRows] = useState(false)
  const [overrides, setOverrides] = useState<{ key: string; rows: Record<number, RowOverride> }>({ key: '', rows: {} })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const principalValue = parseAmount(principal)
  const countValue = Number(count)
  const settledValue = settled.trim() === '' ? 0 : Number(settled)
  const rateValue = rate.trim() === '' ? null : Number(rate)
  const installmentValue = installment.trim() === '' ? null : parseAmount(installment)
  const scheduleInput = {
    principal: principalValue ?? 0,
    interest,
    rate_annual: interest === 'fixed_rate' ? rateValue : null,
    installment_amount: interest === 'fixed_installment' ? installmentValue : null,
    frequency,
    first_due_date: firstDue,
    installment_count: Number.isInteger(countValue) ? countValue : 0,
  }
  const scheduleKey = JSON.stringify(scheduleInput)
  const activeOverrides = overrides.key === scheduleKey ? overrides.rows : {}
  const preview = applyOverrides(buildSchedule(scheduleInput), activeOverrides, interest)
  const total = roundMoney(preview.reduce((sum, row) => sum + row.amount, 0))
  const totalInterest = roundMoney(preview.reduce((sum, row) => sum + row.interest_part, 0))
  const totalPrincipal = roundMoney(preview.reduce((sum, row) => sum + row.principal_part, 0))
  const borrowed = direction === 'borrowed'

  const accountOptions = [
    { value: '', label: 'Elegir al pagar' },
    ...selectable(data.accounts).filter(isLiquid).map((a) => ({ value: a.uuid, label: a.name })),
  ]

  function override(index: number, field: keyof RowOverride, value: string) {
    const rows = { ...activeOverrides, [index]: { ...activeOverrides[index], [field]: value } }
    setOverrides({ key: scheduleKey, rows })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return setError('Ponle un nombre, por ejemplo “Auto” o “Préstamo familiar”.')
    if (principalValue === null || principalValue <= 0) return setError('Escribe el monto prestado.')
    if (!Number.isInteger(countValue) || countValue < 1 || countValue > 360) return setError('El número de cuotas va de 1 a 360.')
    if (!Number.isInteger(settledValue) || settledValue < 0 || settledValue >= countValue) {
      return setError('Las cuotas ya pagadas deben ser menos que el total de cuotas.')
    }
    if (interest === 'fixed_rate' && (rateValue === null || !(rateValue > 0))) return setError('Escribe la tasa anual, por ejemplo 24.')
    if (interest === 'fixed_installment' && (installmentValue === null || installmentValue * countValue < principalValue)) {
      return setError('La cuota fija por el número de cuotas debe cubrir el monto prestado.')
    }
    if (preview.some((row) => !row.due_date || row.amount <= 0)) return setError('Cada cuota necesita fecha y un monto mayor a cero.')
    if (Math.abs(totalPrincipal - principalValue) > 0.01) {
      return setError(`Las cuotas suman ${money(totalPrincipal)} de capital y el préstamo es de ${money(principalValue)}.`)
    }

    setSaving(true)
    try {
      await createLoan(
        {
          ...scheduleInput,
          name: name.trim(),
          direction,
          lender_label: who.trim(),
          currency: 'MXN',
          pay_from_account_id: accountId || null,
        },
        [...preview].sort((a, b) => a.due_date.localeCompare(b.due_date)),
        settledValue,
      )
      onDone()
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setSaving(false)
    }
  }

  const collapsed = [...preview.slice(0, 3), ...(preview.length > 4 ? [null] : []), ...(preview.length > 3 ? preview.slice(-1) : [])]
  const shown = editingRows ? preview : collapsed

  return (
    <form className="form" onSubmit={submit} noValidate>
      <ChoiceField label="Tipo" value={direction} onChange={setDirection} options={DIRECTIONS} />
      <div className="field-row">
        <TextField label="Nombre" value={name} onChange={setName} placeholder="Ej. Auto" autoFocus />
        <TextField label={borrowed ? 'Quién presta' : 'A quién'} value={who} onChange={setWho} placeholder="Ej. Banco, Mamá" />
      </div>
      <AmountField label="Monto prestado (MXN)" value={principal} onChange={setPrincipal} />
      <ChoiceField label="Interés" value={interest} onChange={setInterest} options={INTEREST} />
      {interest === 'fixed_rate' && <TextField label="Tasa anual (%)" value={rate} onChange={setRate} inputMode="decimal" placeholder="24" mono />}
      {interest === 'fixed_installment' && <AmountField label="Cuota que te cobran (MXN)" value={installment} onChange={setInstallment} />}
      <ChoiceField label="Frecuencia" value={frequency} onChange={setFrequency} options={FREQUENCIES} />
      <div className="field-row">
        <TextField label="Primera cuota" type="date" value={firstDue} onChange={setFirstDue} mono />
        <TextField label="Número de cuotas" value={count} onChange={setCount} inputMode="numeric" placeholder="12" mono />
      </div>
      <div className="field-row">
        <TextField label="Cuotas ya pagadas" value={settled} onChange={setSettled} inputMode="numeric" placeholder="0" mono />
        <SelectField label={borrowed ? 'Se paga desde' : 'Se recibe en'} value={accountId} onChange={setAccountId} options={accountOptions} />
      </div>
      <FieldNote>
        Si el préstamo empezó antes de usar Guanabana, indica cuántas cuotas ya pagaste. No cambian tu saldo. Usa un nombre corto, sin números de cuenta ni nombres completos.
      </FieldNote>

      {preview.length > 0 && (
        <div className="preview">
          <div className="preview-head">
            <p className="field-label">Calendario</p>
            <button type="button" className="panel-verb" onClick={() => setEditingRows(!editingRows)}>
              {editingRows ? 'Resumen' : 'Editar cuotas'}
            </button>
          </div>
          <table className="roster">
            <tbody>
              {shown.map((row, index) => {
                if (row === null) {
                  return (
                    <tr key="gap">
                      <td colSpan={3} className="dim">
                        … {preview.length - 4} cuotas más
                      </td>
                    </tr>
                  )
                }
                const position = editingRows ? index : preview.indexOf(row)
                const isSettled = position < settledValue
                return (
                  <tr key={position} className={isSettled ? 'dim' : undefined}>
                    <td className="mono dim">{position + 1}</td>
                    <td className="mono">
                      {editingRows ? (
                        <input
                          className="input mono"
                          type="date"
                          aria-label={`Fecha de la cuota ${position + 1}`}
                          value={activeOverrides[position]?.due_date ?? row.due_date}
                          onChange={(event) => override(position, 'due_date', event.target.value)}
                        />
                      ) : (
                        date(row.due_date)
                      )}
                    </td>
                    <td className="num mono">
                      {editingRows && interest !== 'fixed_rate' ? (
                        <input
                          className="input mono num"
                          inputMode="decimal"
                          aria-label={`Monto de la cuota ${position + 1}`}
                          value={activeOverrides[position]?.amount ?? String(row.amount)}
                          onChange={(event) => override(position, 'amount', event.target.value)}
                        />
                      ) : (
                        <>
                          {money(row.amount)}
                          {isSettled && <span className="row-sub">Ya pagada</span>}
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {editingRows && interest === 'fixed_rate' && <FieldNote>Con tasa anual solo se editan las fechas; los montos salen de la tasa.</FieldNote>}
          <div className="readout">
            <span>Total a {borrowed ? 'pagar' : 'recibir'} · interés {money(totalInterest)}</span>
            <span className="mono">{money(total)}</span>
          </div>
          {Math.abs(totalPrincipal - (principalValue ?? 0)) > 0.01 && (
            <div className="readout text-amber">
              <span>Capital en cuotas</span>
              <span className="mono">{money(totalPrincipal)}</span>
            </div>
          )}
          <div className="readout dim">
            <span>Termina</span>
            <span className="mono">{date(preview.reduce((last, row) => (row.due_date > last ? row.due_date : last), preview[0].due_date))}</span>
          </div>
        </div>
      )}

      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel="Guardar préstamo" saving={saving} onCancel={onDone} />
    </form>
  )
}
