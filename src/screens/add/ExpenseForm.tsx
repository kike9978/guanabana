import { useState, type FormEvent } from 'react'
import { AmountField, ChoiceField, FieldError, FieldNote, FormActions, SelectField, TextField } from '../../components/fields'
import { selectable } from '../../db/accounts'
import { deleteTransaction, saveTransaction } from '../../db/ledger'
import { UNCATEGORIZED_KEY } from '../../db/seed'
import type { AccountType, PaymentMethod, Place } from '../../db/types'
import type { AddFormProps } from './formProps'
import { isoToDate, todayIso } from '../../lib/dates'
import { formatDate, formatMoney } from '../../lib/format'
import { isMsi, MSI_TERMS, msiPurchase, msiSchedule, shortenMsi } from '../../lib/msi'
import { pickValid } from '../../lib/forms'
import { categoryOptions as categoryOptionsFor } from '../../lib/categories'
import { parseAmount } from '../../lib/parseAmount'
import { CategoryPicker } from '../../components/CategoryPicker'
import { NeedsAccount } from './NeedsAccount'
import { ProductLines } from './ProductLines'
import { planLines, resolvePlace, type PlaceDraft } from '../../db/priceBook'
import { emptyLine, lineToDraft, NEW_PLACE, type LineDraft } from '../../lib/priceBook'

const METHOD_LABEL: Record<PaymentMethod, string> = {
  bank: 'Banco',
  cash: 'Efectivo',
  credit_card: 'TDC',
  unassigned: 'Sin origen',
}

const MSI_NONE = 1

const MSI_OPTIONS = [
  { value: String(MSI_NONE), label: 'No' },
  ...MSI_TERMS.map((term) => ({ value: String(term), label: String(term) })),
]

const METHOD_FOR_ACCOUNT: Record<AccountType, PaymentMethod | null> = {
  checking: 'bank',
  cash: 'cash',
  unassigned: 'unassigned',
  savings: null,
}

export function ExpenseForm({ data, onDone, onOpenAccounts, prefill, editing }: AddFormProps) {
  const [amount, setAmount] = useState(prefill?.amount !== undefined ? String(prefill.amount) : '')
  const [method, setMethod] = useState<PaymentMethod | null>(null)
  const [sourceId, setSourceId] = useState<string | null>(prefill?.cc_id ?? prefill?.account_id ?? null)
  const [categoryId, setCategoryId] = useState<string | null>(prefill?.category_id ?? null)
  const [date, setDate] = useState(prefill?.date ?? todayIso())
  const [notes, setNotes] = useState(prefill?.notes ?? '')
  const prefillAccount = data.accounts.find((a) => a.uuid === prefill?.account_id)
  const prefillMethod = prefill?.cc_id ? 'credit_card' : prefillAccount ? METHOD_FOR_ACCOUNT[prefillAccount.type] : null
  const prefillCategory = data.categories.find((c) => c.key === prefill?.category_key)?.uuid ?? null
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const existingLines = editing ? data.lines.filter((line) => line.transaction_id === editing.uuid) : []
  const [showLines, setShowLines] = useState(existingLines.length > 0)
  const [lines, setLines] = useState<LineDraft[]>(() => (existingLines.length > 0 ? existingLines.map((line) => lineToDraft(line, data.items)) : [emptyLine()]))
  const [placeId, setPlaceId] = useState(editing?.place_id ?? '')
  const [placeDraft, setPlaceDraft] = useState<PlaceDraft>({ name: '', kind: 'supermarket', area: '' })
  const [invalidLine, setInvalidLine] = useState<string | null>(null)
  const [msiMonths, setMsiMonths] = useState(String(editing?.msi_months ?? MSI_NONE))
  const [shortenChoice, setShortenChoice] = useState('')

  const keep = [prefill?.account_id, prefill?.cc_id]
  const accounts = selectable(data.accounts, keep)
  const sourcesByMethod: Record<PaymentMethod, { value: string; label: string }[]> = {
    bank: accounts.filter((a) => a.type === 'checking').map((a) => ({ value: a.uuid, label: a.name })),
    cash: accounts.filter((a) => a.type === 'cash').map((a) => ({ value: a.uuid, label: a.name })),
    credit_card: selectable(data.cards, keep).map((c) => ({ value: c.uuid, label: c.name })),
    unassigned: accounts
      .filter((a) => a.type === 'unassigned' && (a.current_balance !== 0 || a.uuid === prefill?.account_id))
      .map((a) => ({ value: a.uuid, label: `${a.name} · ${formatMoney(a.current_balance, a.currency)}` })),
  }
  const methodOptions = (Object.keys(METHOD_LABEL) as PaymentMethod[])
    .filter((m) => sourcesByMethod[m].length > 0)
    .map((m) => ({ value: m, label: METHOD_LABEL[m] }))

  const activeMethod = pickValid(method ?? prefillMethod, methodOptions)
  const sources = activeMethod ? sourcesByMethod[activeMethod] : []
  const activeSource = pickValid(sourceId, sources)

  const categoryOptions = categoryOptionsFor(data.categories, 'expense', [prefill?.category_id])
  const fallbackCategory = data.categories.find((c) => c.key === UNCATEGORIZED_KEY)?.uuid ?? null
  const activeCategory = pickValid(categoryId ?? prefillCategory ?? fallbackCategory, categoryOptions)

  const parsedAmount = parseAmount(amount)
  const activeCard = activeMethod === 'credit_card' ? data.cards.find((c) => c.uuid === activeSource) : undefined
  const canMsi = Boolean(activeCard) && !prefill?.loan_installment_id && !prefill?.recurring_id && (parsedAmount === null || parsedAmount > 0)
  const months = canMsi ? Number(msiMonths) : MSI_NONE
  const msiCharges = activeCard && months > MSI_NONE && parsedAmount !== null && parsedAmount > 0
    ? msiSchedule({ date, amount: parsedAmount, months }, activeCard.statement_day)
    : []
  const refund = parsedAmount !== null && parsedAmount < 0 ? -parsedAmount : 0
  const msiPlansOnCard = activeCard && refund > 0 && !editing && !prefill?.loan_installment_id && !prefill?.recurring_id
    ? data.transactions.filter((tx) => isMsi(tx) && tx.cc_id === activeCard.uuid && tx.amount >= refund)
    : []
  const chosenPlan = msiPlansOnCard.find((tx) => tx.uuid === shortenChoice)
  const shortened = chosenPlan ? shortenMsi(msiPurchase(chosenPlan), refund) : null
  const shortenedCharges = chosenPlan && shortened && shortened !== 'delete' && activeCard
    ? msiSchedule({ date: chosenPlan.date, amount: shortened.amount, months: shortened.months }, activeCard.statement_day)
    : []

  if (data.loaded && methodOptions.length === 0) {
    return <NeedsAccount onOpenAccounts={onOpenAccounts} />
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const value = parseAmount(amount)
    if (value === null || value === 0) return setError('Escribe un monto distinto de cero.')
    if (!activeMethod || !activeSource) return setError('Elige con qué pagaste.')
    if (msiPlansOnCard.length > 0 && shortenChoice === '') return setError('Elige si este reembolso acorta un plan a meses.')
    if (chosenPlan && shortened) {
      setSaving(true)
      try {
        if (shortened === 'delete') await deleteTransaction(chosenPlan)
        else await saveTransaction(chosenPlan, { type: chosenPlan.type, date: chosenPlan.date, amount: shortened.amount, msi_months: shortened.months })
        onDone()
      } catch {
        setError('No se pudo guardar. Intenta de nuevo.')
        setSaving(false)
      }
      return
    }

    const withLines = showLines && value > 0
    let place: Place | null = null
    let newPlace: Place | null = null
    if (withLines && placeId === NEW_PLACE) {
      const resolved = resolvePlace(placeDraft, data.places)
      if ('error' in resolved) return setError(resolved.error)
      place = resolved.place
      newPlace = resolved.created ? resolved.place : null
    } else if (withLines) {
      place = data.places.find((p) => p.uuid === placeId) ?? null
    }
    const plan = withLines
      ? planLines(lines, { items: data.items, place, newPlace, date, categoryId: activeCategory ?? null, parse: parseAmount })
      : null
    if (plan && 'error' in plan) {
      setInvalidLine(plan.key ?? null)
      return setError(plan.error)
    }
    const buildLines = plan ? plan.build : existingLines.length > 0 ? () => ({ lines: [], items: [], places: [] }) : undefined

    setSaving(true)
    try {
      await saveTransaction(editing, {
        type: 'expense',
        amount: value,
        date,
        payment_method: activeMethod,
        account_id: activeMethod === 'credit_card' ? null : activeSource,
        cc_id: activeMethod === 'credit_card' ? activeSource : null,
        category_id: activeCategory ?? null,
        place_id: withLines ? (place?.uuid ?? null) : (editing?.place_id ?? null),
        notes: notes.trim(),
        recurring_id: prefill?.recurring_id ?? null,
        occurrence: prefill?.occurrence ?? null,
        loan_installment_id: prefill?.loan_installment_id ?? null,
        msi_months: activeMethod === 'credit_card' && value > 0 && months > MSI_NONE ? months : null,
      }, buildLines)
      onDone()
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <AmountField label="Monto (MXN)" value={amount} onChange={(v) => { setAmount(v); setError(null); setShortenChoice('') }} invalid={error !== null} autoFocus />
      {activeMethod && (
        <ChoiceField label="Método" value={activeMethod} onChange={setMethod} options={methodOptions} />
      )}
      {sources.length > 1 && activeSource && (
        <SelectField label={activeMethod === 'credit_card' ? 'Tarjeta' : 'Cuenta'} value={activeSource} onChange={(id) => { setSourceId(id); setShortenChoice('') }} options={sources} />
      )}
      {activeCategory && (
        <CategoryPicker categories={data.categories} kind="expense" value={activeCategory} onChange={setCategoryId} keep={[prefill?.category_id]} />
      )}
      <TextField label="Fecha" type="date" value={date} onChange={setDate} mono />
      <TextField label="Nota" value={notes} onChange={setNotes} placeholder="Opcional" />
      {parsedAmount !== null && parsedAmount < 0 ? null : showLines ? (
        <>
          <ProductLines
            lines={lines}
            onLines={(next) => { setLines(next); setError(null); setInvalidLine(null) }}
            items={data.items}
            places={data.places}
            placeId={placeId}
            onPlaceId={setPlaceId}
            placeDraft={placeDraft}
            onPlaceDraft={setPlaceDraft}
            invalidKey={invalidLine}
            amount={parsedAmount}
            onUseSum={(sum) => setAmount(String(sum))}
          />
          <button type="button" className="panel-verb" onClick={() => { setShowLines(false); setError(null); setInvalidLine(null) }}>
            {existingLines.length > 0 ? 'Quitar productos de este gasto' : 'Sin productos'}
          </button>
        </>
      ) : (
        <button type="button" className="panel-verb" onClick={() => setShowLines(true)}>
          + Productos (opcional)
        </button>
      )}
      {canMsi && <ChoiceField label="Meses sin intereses" value={msiMonths} onChange={setMsiMonths} options={MSI_OPTIONS} />}
      {msiCharges.length > 0 && activeCard ? (
        <FieldNote>
          {`${msiCharges.length} mensualidades de ${formatMoney(msiCharges[0].amount, 'MXN')}, del corte del ${formatDate(msiCharges[0].date)} al del ${formatDate(msiCharges[msiCharges.length - 1].date)}. `}
          La deuda sube el total, pero tu Disponible real solo aparta la mensualidad de cada corte.
        </FieldNote>
      ) : activeMethod === 'credit_card' ? (
        <FieldNote>Con tarjeta tu banco no cambia. Sube la deuda y baja tu Disponible real.</FieldNote>
      ) : null}
      {editing ? (
        <FieldNote>Al guardar se revierte el saldo anterior y se aplica el nuevo.</FieldNote>
      ) : prefill?.recurring_id || prefill?.loan_installment_id ? (
        <FieldNote>Este pago ya estaba apartado. Al guardarlo, tu Disponible real no cambia.</FieldNote>
      ) : (
        <FieldNote>Un monto negativo se registra como reembolso.</FieldNote>
      )}
      {msiPlansOnCard.length > 0 && (
        <>
          <ChoiceField
            label="¿Acorta un plan a meses?"
            value={shortenChoice}
            onChange={setShortenChoice}
            options={[
              { value: 'none', label: 'No, solo baja la deuda' },
              ...msiPlansOnCard.map((tx) => ({
                value: tx.uuid,
                label: `Acortar · ${tx.notes.trim() || formatDate(isoToDate(tx.date))} · ${formatMoney(tx.amount, 'MXN')}`,
              })),
            ]}
          />
          {chosenPlan && shortened === 'delete' && (
            <FieldNote>{`Se cancela esa compra y la deuda baja ${formatMoney(chosenPlan.amount, 'MXN')}. No se agrega otro movimiento.`}</FieldNote>
          )}
          {chosenPlan && shortened && shortened !== 'delete' && shortenedCharges.length > 0 && (
            <FieldNote>
              {`La compra queda en ${formatMoney(shortened.amount, 'MXN')} a ${shortened.months} meses, ${formatMoney(shortenedCharges[0].amount, 'MXN')} por corte hasta el ${formatDate(shortenedCharges[shortenedCharges.length - 1].date)}. La deuda baja ${formatMoney(refund, 'MXN')}. No se agrega otro movimiento.`}
            </FieldNote>
          )}
        </>
      )}
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel={editing ? 'Guardar cambios' : 'Guardar gasto'} saving={saving} onCancel={onDone} />
    </form>
  )
}
