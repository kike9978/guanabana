import { useState, type FormEvent } from 'react'
import { AmountField, ChoiceField, FieldError, FieldNote, FormActions, SelectField, TextField } from '../../components/fields'
import { isLiquid, selectable } from '../../db/accounts'
import { createLoan } from '../../db/commitments'
import type { IncomeSlot, LoanDirection, LoanFrequency, LoanInterest } from '../../db/types'
import { monthlyIncomeSlots, slotDays } from '../../lib/incomeRules'
import type { MoneyData } from '../../db/useMoneyData'
import { isoToDate, todayIso } from '../../lib/dates'
import { formatDate, formatMoney } from '../../lib/format'
import { DISBURSEMENT_KEY } from '../../lib/categories'
import { buildSchedule, isUnscheduled, type ScheduleRow } from '../../lib/loans'
import { moneySnapshot } from '../../lib/snapshot'
import { NEW_LOAN_CHECKPOINTS, newLoanPreview } from '../../lib/loanTimeline'
import { roundMoney } from '../../lib/money'
import { parseAmount } from '../../lib/parseAmount'
import { habitualDailySpend } from '../../lib/projection'

const IMPACT_ROWS = 6
const ALREADY_RECORDED = 'recorded'

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

const UNSCHEDULED = { value: 'unscheduled' as const, label: 'Sin fecha' }

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
  const [slot, setSlot] = useState<IncomeSlot>('first')
  const [firstDue, setFirstDue] = useState(todayIso())
  const [count, setCount] = useState('')
  const [settled, setSettled] = useState('')
  const [accountId, setAccountId] = useState('')
  const [source, setSource] = useState<string | null>(null)
  const [handedOn, setHandedOn] = useState(todayIso())
  const [editingRows, setEditingRows] = useState(false)
  const [overrides, setOverrides] = useState<{ key: string; rows: Record<number, RowOverride> }>({ key: '', rows: {} })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const principalValue = parseAmount(principal)
  const countValue = Number(count)
  const settledValue = settled.trim() === '' ? 0 : Number(settled)
  const rateValue = rate.trim() === '' ? null : Number(rate)
  const installmentValue = installment.trim() === '' ? null : parseAmount(installment)
  const unscheduled = isUnscheduled({ frequency })
  const scheduleInput = unscheduled
    ? {
        principal: principalValue ?? 0,
        interest: 'none' as const,
        rate_annual: null,
        installment_amount: null,
        frequency,
        income_slot: null,
        first_due_date: todayIso(),
        installment_count: 0,
      }
    : {
        principal: principalValue ?? 0,
        interest,
        rate_annual: interest === 'fixed_rate' ? rateValue : null,
        installment_amount: interest === 'fixed_installment' ? installmentValue : null,
        frequency,
        income_slot: frequency === 'per_income' ? slot : null,
        first_due_date: firstDue,
        installment_count: Number.isInteger(countValue) ? countValue : 0,
      }
  const scheduleKey = JSON.stringify(scheduleInput)
  const activeOverrides = overrides.key === scheduleKey ? overrides.rows : {}
  const paydays = monthlyIncomeSlots(data.recurring)
  const slotOptions: { value: IncomeSlot; label: string }[] = [
    ...(paydays[0] ? [{ value: 'first' as const, label: paydays.length > 1 ? `1er ingreso · día ${paydays[0].due_day}` : `Mi ingreso · día ${paydays[0].due_day}` }] : []),
    ...(paydays[1] ? [{ value: 'second' as const, label: `2º ingreso · día ${paydays[1].due_day}` }, { value: 'both' as const, label: 'Cada ingreso' }] : []),
  ]
  const preview = applyOverrides(buildSchedule(scheduleInput, slotDays(data.recurring, slot)), activeOverrides, interest)
  const total = roundMoney(preview.reduce((sum, row) => sum + row.amount, 0))
  const totalInterest = roundMoney(preview.reduce((sum, row) => sum + row.interest_part, 0))
  const totalPrincipal = roundMoney(preview.reduce((sum, row) => sum + row.principal_part, 0))
  const borrowed = direction === 'borrowed'
  const [allImpact, setAllImpact] = useState(false)
  const pending = [...preview].sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(Number.isInteger(settledValue) ? settledValue : 0)
  const now = new Date()
  const impact = borrowed && principalValue && !unscheduled
    ? newLoanPreview(data, now, name.trim() || 'Nuevo', pending, { dailySpend: habitualDailySpend(data.transactions, now).perDay })
    : null

  const liquidAccounts = selectable(data.accounts).filter(isLiquid)
  const accountOptions = [{ value: '', label: 'Elegir al pagar' }, ...liquidAccounts.map((a) => ({ value: a.uuid, label: a.name }))]

  const sourceValue = source ?? accountId
  const sourceAccount = borrowed ? undefined : liquidAccounts.find((a) => a.uuid === sourceValue)
  const sourceOptions = [
    { value: '', label: 'Elige una cuenta' },
    ...liquidAccounts.map((a) => ({ value: a.uuid, label: `${a.name} · ${money(a.current_balance)}` })),
    { value: ALREADY_RECORDED, label: 'Ya lo registré' },
  ]
  const handover = sourceAccount && principalValue && principalValue > 0
    ? (() => {
        const before = moneySnapshot(data, now).breakdown.total
        const accounts = data.accounts.map((a) => (a.uuid === sourceAccount.uuid ? { ...a, current_balance: a.current_balance - principalValue } : a))
        return { before, after: moneySnapshot({ ...data, accounts }, now).breakdown.total, short: sourceAccount.current_balance < principalValue }
      })()
    : null

  function override(index: number, field: keyof RowOverride, value: string) {
    const rows = { ...activeOverrides, [index]: { ...activeOverrides[index], [field]: value } }
    setOverrides({ key: scheduleKey, rows })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return setError('Ponle un nombre, por ejemplo “Auto” o “Préstamo familiar”.')
    if (principalValue === null || principalValue <= 0) return setError('Escribe el monto prestado.')
    if (!unscheduled) {
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
    }
    if (!borrowed && sourceValue === '') return setError('Elige de qué cuenta salió el dinero, o “Ya lo registré” si ya está en Movimientos.')
    if (sourceAccount && (!handedOn || handedOn > todayIso())) return setError('La fecha en que prestaste no puede ser futura.')

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
        unscheduled ? 0 : settledValue,
        sourceAccount
          ? { account: sourceAccount, date: handedOn, category_id: data.categories.find((c) => c.key === DISBURSEMENT_KEY)?.uuid ?? null }
          : undefined,
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
      <ChoiceField
        label="Frecuencia"
        value={frequency}
        onChange={setFrequency}
        options={[...FREQUENCIES, ...(paydays.length > 0 ? [{ value: 'per_income' as const, label: 'Por ingreso' }] : []), UNSCHEDULED]}
      />
      {!unscheduled && (
        <>
          <ChoiceField label="Interés" value={interest} onChange={setInterest} options={INTEREST} />
          {interest === 'fixed_rate' && <TextField label="Tasa anual (%)" value={rate} onChange={setRate} inputMode="decimal" placeholder="24" mono />}
          {interest === 'fixed_installment' && (
            <AmountField label={borrowed ? 'Cuota que te cobran (MXN)' : 'Cuota que te pagan (MXN)'} value={installment} onChange={setInstallment} />
          )}
        </>
      )}
      {frequency === 'per_income' && (
        <>
          <ChoiceField label="Se paga con" value={slot} onChange={setSlot} options={slotOptions} />
          <FieldNote>
            Cada cuota cae en ese día de ingreso y se paga con él. Si luego cambias tus días de ingreso, el calendario guardado no cambia; puedes editar sus fechas aquí antes de guardar.
          </FieldNote>
        </>
      )}
      {unscheduled ? (
        <>
          <SelectField label={borrowed ? 'Se paga desde' : 'Se recibe en'} value={accountId} onChange={setAccountId} options={accountOptions} />
          <FieldNote>
            Sin calendario: no se aparta nada de tu Disponible real ni aparece en Tiempo. Cada {borrowed ? 'pago' : 'cobro'} se registra como abono y baja lo que falta. Si empezó antes de usar Guanabana y ya {borrowed ? 'pagaste' : 'te pagaron'} una parte, escribe solo lo que falta. Usa un nombre corto, sin números de cuenta ni nombres completos.
          </FieldNote>
        </>
      ) : (
        <>
          <div className="field-row">
            <TextField label={frequency === 'per_income' ? 'Desde' : 'Primera cuota'} type="date" value={firstDue} onChange={setFirstDue} mono />
            <TextField label="Número de cuotas" value={count} onChange={setCount} inputMode="numeric" placeholder="12" mono />
          </div>
          <div className="field-row">
            <TextField label="Cuotas ya pagadas" value={settled} onChange={setSettled} inputMode="numeric" placeholder="0" mono />
            <SelectField label={borrowed ? 'Se paga desde' : 'Se recibe en'} value={accountId} onChange={setAccountId} options={accountOptions} />
          </div>
          <FieldNote>
            Si el préstamo empezó antes de usar Guanabana, indica cuántas cuotas ya {borrowed ? 'pagaste' : 'te pagaron'}. No cambian tu saldo. Usa un nombre corto, sin números de cuenta ni nombres completos.
          </FieldNote>
        </>
      )}

      {!borrowed && (
        <>
          <div className="field-row">
            <SelectField label="El dinero salió de" value={sourceValue} onChange={setSource} options={sourceOptions} />
            {sourceAccount && <TextField label="Prestado el" type="date" value={handedOn} onChange={setHandedOn} mono />}
          </div>
          {handover && principalValue ? (
            <div className="preview">
              <p className="field-label">Al guardar</p>
              <div className="readout">
                <span>{sourceAccount!.name} · Préstamo otorgado</span>
                <span className="mono">− {money(principalValue)}</span>
              </div>
              <div className="readout">
                <span>Disponible real</span>
                <span className="mono">
                  {money(handover.before)} → {money(handover.after)}
                </span>
              </div>
              {handover.short && (
                <div className="readout text-amber">
                  <span>Saldo en {sourceAccount!.name}</span>
                  <span className="mono">{money(sourceAccount!.current_balance)}</span>
                </div>
              )}
              <FieldNote>
                {handover.short ? 'El saldo no alcanza; se guarda igual y puedes ajustarlo después. ' : ''}
                Se registra un gasto que no cuenta en tus estadísticas. Lo que te paguen entra como cobro.
              </FieldNote>
            </div>
          ) : (
            sourceValue === ALREADY_RECORDED && (
              <FieldNote>No se registra otro movimiento. Cada cobro sí entra a tu Disponible real cuando lo registres.</FieldNote>
            )
          )}
        </>
      )}

      {preview.length > 0 && (
        <div className="preview">
          <div className="preview-head">
            <p className="field-label">Calendario</p>
            <button type="button" className="panel-verb" onClick={() => setEditingRows(!editingRows)}>
              {editingRows ? 'Resumen' : 'Editar cuotas'}
            </button>
          </div>
          <div className="roster-fit">
          <table className="roster roster-stack">
            <tbody>
              {shown.map((row, index) => {
                if (row === null) {
                  return (
                    <tr key="gap">
                      <td colSpan={3} className="dim roster-title">
                        … {preview.length - 4} cuotas más
                      </td>
                    </tr>
                  )
                }
                const position = editingRows ? index : preview.indexOf(row)
                const isSettled = position < settledValue
                return (
                  <tr key={position} className={isSettled ? 'dim' : undefined}>
                    <td className="mono dim roster-title">{position + 1}</td>
                    <td className="mono" data-label="Fecha">
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
                    <td className="num mono" data-label="Cuota">
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
          </div>
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

      {impact && (
        <div className="preview">
          <div className="preview-head">
            <p className="field-label">Cómo cambia tu Disponible real</p>
            {impact.points.length > IMPACT_ROWS && (
              <button type="button" className="panel-verb" onClick={() => setAllImpact(!allImpact)}>
                {allImpact ? 'Resumen' : 'Ver todos'}
              </button>
            )}
          </div>
          <div className="roster-fit">
          <table className="roster roster-stack requirements">
            <thead>
              <tr>
                <th scope="col">Ingreso</th>
                <th scope="col" className="num">Cuota</th>
                <th scope="col" className="num">Sin préstamo</th>
                <th scope="col" className="num">Con préstamo</th>
              </tr>
            </thead>
            <tbody>
              {(allImpact ? impact.points : impact.points.slice(0, IMPACT_ROWS)).map((point, index) => (
                <tr key={point.date.getTime()}>
                  <td className="mono roster-title">
                    {formatDate(point.date)}
                    {index === 0 && <span className="row-sub">Hoy</span>}
                  </td>
                  <td className="num mono" data-label="Cuota">{point.installments > 0 ? money(point.installments) : '—'}</td>
                  <td className="num mono dim" data-label="Sin préstamo">{money(point.without)}</td>
                  <td className={`num mono${point.with < 0 ? ' text-heat' : point.with < point.installments ? ' text-amber' : ''}`} data-label="Con préstamo">{money(point.with)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <div className="readout">
            <span>Punto más bajo con el préstamo · {formatDate(impact.lowest.date)}</span>
            <span className={`mono${impact.lowest.with < 0 ? ' text-heat' : ''}`}>{money(impact.lowest.with)}</span>
          </div>
          <FieldNote>
            {impact.lowest.with < 0
              ? `Con estas cuotas tu Disponible real quedaría en ${money(impact.lowest.with)} el ${formatDate(impact.lowest.date)}. Puedes probar más cuotas o una fecha distinta.`
              : 'Proyección con tus ingresos, pagos fijos, otros préstamos y tu gasto diario habitual. No cuenta el dinero del préstamo, que normalmente ya tiene destino.'}
            {impact.truncated && ` Se muestran los primeros ${NEW_LOAN_CHECKPOINTS} ingresos.`}
          </FieldNote>
        </div>
      )}

      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel="Guardar préstamo" saving={saving} onCancel={onDone} />
    </form>
  )
}
