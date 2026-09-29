import { useState, type FormEvent } from 'react'
import { AmountField, FieldError, FieldNote, FormActions, SelectField, TextField } from '../../components/fields'
import { ACCOUNT_TYPE_LABEL, selectable } from '../../db/accounts'
import { updateSettings } from '../../db/buckets'
import { saveTransaction } from '../../db/ledger'
import { incomeRank, isRuleIncome, scheduledIncomeMatches } from '../../lib/incomeRules'
import type { AddFormProps } from './formProps'
import { isoToDate, todayIso } from '../../lib/dates'
import { formatDate, formatMoney } from '../../lib/format'
import { pickValid } from '../../lib/forms'
import { roundMoney } from '../../lib/money'
import { parseAmount } from '../../lib/parseAmount'
import { NeedsAccount } from './NeedsAccount'

type Currency = 'MXN' | 'CAD'
type Basis = 'days' | 'amount'

const text = (value: number | null | undefined) => (value === null || value === undefined ? '' : String(value))

export function IncomeForm({ data, onDone, onNext, onOpenAccounts, prefill, editing }: AddFormProps) {
  const settings = data.settings
  const editingCad = editing?.original_currency === 'CAD'
  const offerForeign = Boolean(settings?.foreign_income) || editingCad
  const [currency, setCurrency] = useState<Currency>(editingCad ? 'CAD' : 'MXN')
  const [basis, setBasis] = useState<Basis>(
    editingCad ? (editing?.days_worked ? 'days' : 'amount') : settings?.cad_day_rate ? 'days' : 'amount',
  )
  const [amount, setAmount] = useState(prefill?.amount !== undefined ? String(prefill.amount) : '')
  const [days, setDays] = useState(text(editing?.days_worked))
  const [dayRate, setDayRate] = useState(
    text(editingCad && editing?.days_worked && editing.original_amount ? roundMoney(editing.original_amount / editing.days_worked) : settings?.cad_day_rate),
  )
  const [cadAmount, setCadAmount] = useState(editingCad && !editing?.days_worked ? text(editing?.original_amount) : '')
  const [fx, setFx] = useState(text(editingCad ? editing?.fx_rate : settings?.fx_rate))
  const [accountId, setAccountId] = useState<string | null>(prefill?.account_id ?? null)
  const [categoryId, setCategoryId] = useState<string | null>(prefill?.category_id ?? null)
  const [date, setDate] = useState(prefill?.date ?? todayIso())
  const [notes, setNotes] = useState(prefill?.notes ?? '')
  const [link, setLink] = useState<string | null>(null)
  const prefillCategory = data.categories.find((c) => c.key === (prefill?.category_key ?? 'contract_income'))?.uuid ?? null
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const accountOptions = selectable(data.accounts, [prefill?.account_id])
    .filter((a) => a.type !== 'unassigned')
    .map((a) => ({ value: a.uuid, label: `${a.name} · ${ACCOUNT_TYPE_LABEL[a.type]}` }))
  const categoryOptions = data.categories
    .filter((c) => c.kind === 'income')
    .map((c) => ({ value: c.uuid, label: c.name }))
  const activeAccount = pickValid(accountId, accountOptions)
  const activeCategory = pickValid(categoryId ?? prefillCategory, categoryOptions)

  const fixedLink = Boolean(prefill?.loan_installment_id || (prefill?.recurring_id && !editing))
  const matches = fixedLink ? [] : scheduledIncomeMatches(data.recurring, data.transactions, date, editing?.uuid)
  const linkOptions = [
    ...matches.map((match) => ({
      value: `${match.item.uuid}|${match.occurrence}`,
      label: `${match.item.name} · ${formatDate(isoToDate(match.occurrence))}`,
    })),
    { value: '', label: 'No es un pago programado' },
  ]
  const editingLink = editing?.recurring_id && editing.occurrence ? `${editing.recurring_id}|${editing.occurrence}` : null
  const chosenLink = link ?? editingLink ?? (editing ? '' : linkOptions[0].value)
  const activeLink = fixedLink ? null : linkOptions.some((option) => option.value === chosenLink) ? chosenLink : editing ? '' : linkOptions[0].value
  const [linkedId, linkedOccurrence] = fixedLink
    ? [prefill?.recurring_id ?? null, prefill?.occurrence ?? null]
    : activeLink
      ? activeLink.split('|')
      : [null, null]

  if (data.loaded && accountOptions.length === 0) {
    return <NeedsAccount onOpenAccounts={onOpenAccounts} message="Agrega una cuenta de banco o efectivo para recibir ingresos." />
  }

  const daysValue = parseAmount(days)
  const dayRateValue = parseAmount(dayRate)
  const fxValue = parseAmount(fx)
  const cad =
    basis === 'days'
      ? daysValue !== null && dayRateValue !== null ? roundMoney(daysValue * dayRateValue) : null
      : parseAmount(cadAmount)
  const mxn = cad !== null && fxValue !== null ? roundMoney(cad * fxValue) : null
  const fxSaved = settings?.fx_rate && settings.fx_date ? `Último tipo de cambio: ${settings.fx_rate} del ${formatDate(isoToDate(settings.fx_date))}.` : null

  const clear = (setter: (value: string) => void) => (value: string) => {
    setter(value)
    setError(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!activeAccount) return setError('Elige la cuenta que recibe el ingreso.')

    let fields
    if (currency === 'CAD') {
      if (basis === 'days') {
        if (daysValue === null || daysValue <= 0) return setError('Escribe los días trabajados.')
        if (dayRateValue === null || dayRateValue <= 0) return setError('Escribe tu tarifa por día en CAD.')
      }
      if (cad === null || cad <= 0) return setError('Escribe el monto en CAD.')
      if (fxValue === null || fxValue <= 0) return setError('Escribe el tipo de cambio que te dio tu banco.')
      fields = {
        amount: roundMoney(cad * fxValue),
        original_amount: cad,
        original_currency: 'CAD' as const,
        fx_rate: fxValue,
        days_worked: basis === 'days' ? daysValue : null,
      }
    } else {
      const value = parseAmount(amount)
      if (value === null || value <= 0) return setError('Escribe un monto mayor a cero.')
      fields = { amount: value, original_amount: null, original_currency: null, fx_rate: null, days_worked: null }
    }

    setSaving(true)
    try {
      const savedId = await saveTransaction(editing, {
        type: 'income',
        ...fields,
        date,
        account_id: activeAccount,
        category_id: activeCategory ?? null,
        notes: notes.trim(),
        recurring_id: linkedId,
        occurrence: linkedOccurrence,
        loan_installment_id: prefill?.loan_installment_id ?? null,
      })
      if (currency === 'CAD' && settings) {
        const rateChanged = basis === 'days' && dayRateValue !== settings.cad_day_rate
        const latest = settings.fx_date ?? ''
        const fxChanged = date >= latest && (fxValue !== settings.fx_rate || date !== latest)
        if (rateChanged || fxChanged) {
          await updateSettings(settings, {
            ...(rateChanged ? { cad_day_rate: dayRateValue } : {}),
            ...(fxChanged ? { fx_rate: fxValue, fx_date: date, fx_source: 'manual' } : {}),
          })
        }
      }
      const saved = { type: 'income' as const, category_id: activeCategory ?? null, recurring_id: linkedId, date }
      const rule = incomeRank(saved, data.recurring)
      if (!editing && onNext && rule && isRuleIncome(saved, data.categories, data.recurring)) {
        onNext('savings_rule', { income_tx_id: savedId, rule })
      } else {
        onDone()
      }
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      {offerForeign && (
        <SelectField
          label="Moneda"
          value={currency}
          onChange={(v) => { setCurrency(v as Currency); setError(null) }}
          options={[
            { value: 'MXN', label: 'MXN · pesos' },
            { value: 'CAD', label: 'CAD · se convierte a pesos' },
          ]}
        />
      )}
      {currency === 'MXN' ? (
        <AmountField label="Monto recibido (MXN)" value={amount} onChange={clear(setAmount)} invalid={error !== null} autoFocus />
      ) : (
        <>
          <SelectField
            label="Calcular por"
            value={basis}
            onChange={(v) => { setBasis(v as Basis); setError(null) }}
            options={[
              { value: 'amount', label: 'Monto en CAD' },
              { value: 'days', label: 'Días trabajados × tarifa' },
            ]}
          />
          {basis === 'days' ? (
            <div className="field-row">
              <TextField label="Días trabajados" value={days} onChange={clear(setDays)} inputMode="decimal" placeholder="10" mono autoFocus />
              <AmountField label="Tarifa por día (CAD)" value={dayRate} onChange={clear(setDayRate)} />
            </div>
          ) : (
            <AmountField label="Monto recibido (CAD)" value={cadAmount} onChange={clear(setCadAmount)} autoFocus />
          )}
          <TextField label="Tipo de cambio (MXN por CAD)" value={fx} onChange={clear(setFx)} inputMode="decimal" placeholder="Ej. 13.50" mono />
          <FieldNote>{fxSaved ?? 'Usa el tipo de cambio que te aplicó tu banco. La app no lo inventa.'}</FieldNote>
          <div className="dossier-total">
            <span>
              {cad !== null ? formatMoney(cad, 'CAD') : 'CAD —'} × {fxValue ?? '—'}
            </span>
            <span className="mono">{mxn !== null ? formatMoney(mxn, 'MXN') : 'MXN —'}</span>
          </div>
        </>
      )}
      {activeAccount && <SelectField label="Cuenta" value={activeAccount} onChange={setAccountId} options={accountOptions} />}
      {activeCategory && <SelectField label="Tipo" value={activeCategory} onChange={setCategoryId} options={categoryOptions} />}
      <TextField label="Fecha" type="date" value={date} onChange={setDate} mono />
      {matches.length > 0 && activeLink !== null && (
        <>
          <SelectField label="Pago programado" value={activeLink} onChange={setLink} options={linkOptions} />
          <FieldNote>Así ese ingreso ya no aparece como pendiente en Inicio y Tiempo.</FieldNote>
        </>
      )}
      <TextField label="Nota" value={notes} onChange={setNotes} placeholder="Opcional" />
      {editing && <FieldNote>Al guardar se revierte el saldo anterior y se aplica el nuevo.</FieldNote>}
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel={editing ? 'Guardar cambios' : 'Guardar ingreso'} saving={saving} onCancel={onDone} />
    </form>
  )
}
