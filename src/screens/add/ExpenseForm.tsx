import { useState, type FormEvent } from 'react'
import { AmountField, ChoiceField, FieldError, FieldNote, FormActions, SelectField, TextField } from '../../components/fields'
import { draftTransaction, recordTransaction } from '../../db/ledger'
import { UNCATEGORIZED_KEY } from '../../db/seed'
import type { PaymentMethod } from '../../db/types'
import type { MoneyData } from '../../db/useMoneyData'
import { todayIso } from '../../lib/dates'
import { formatMoney } from '../../lib/format'
import { pickValid } from '../../lib/forms'
import { parseAmount } from '../../lib/parseAmount'
import { NeedsAccount } from './NeedsAccount'

const METHOD_LABEL: Record<PaymentMethod, string> = {
  bank: 'Banco',
  cash: 'Efectivo',
  credit_card: 'TDC',
  unassigned: 'Sin origen',
}

export function ExpenseForm({ data, onDone, onOpenAccounts }: { data: MoneyData; onDone: () => void; onOpenAccounts: () => void }) {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod | null>(null)
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [date, setDate] = useState(todayIso())
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const sourcesByMethod: Record<PaymentMethod, { value: string; label: string }[]> = {
    bank: data.accounts.filter((a) => a.type === 'checking').map((a) => ({ value: a.uuid, label: a.name })),
    cash: data.accounts.filter((a) => a.type === 'cash').map((a) => ({ value: a.uuid, label: a.name })),
    credit_card: data.cards.map((c) => ({ value: c.uuid, label: c.name })),
    unassigned: data.accounts
      .filter((a) => a.type === 'unassigned' && a.current_balance !== 0)
      .map((a) => ({ value: a.uuid, label: `${a.name} · ${formatMoney(a.current_balance, a.currency)}` })),
  }
  const methodOptions = (Object.keys(METHOD_LABEL) as PaymentMethod[])
    .filter((m) => sourcesByMethod[m].length > 0)
    .map((m) => ({ value: m, label: METHOD_LABEL[m] }))

  const activeMethod = pickValid(method, methodOptions)
  const sources = activeMethod ? sourcesByMethod[activeMethod] : []
  const activeSource = pickValid(sourceId, sources)

  const categoryOptions = data.categories
    .filter((c) => c.kind === 'expense')
    .map((c) => ({ value: c.uuid, label: c.name }))
  const fallbackCategory = data.categories.find((c) => c.key === UNCATEGORIZED_KEY)?.uuid ?? null
  const activeCategory = pickValid(categoryId ?? fallbackCategory, categoryOptions)

  if (data.loaded && methodOptions.length === 0) {
    return <NeedsAccount onOpenAccounts={onOpenAccounts} />
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const value = parseAmount(amount)
    if (value === null || value === 0) return setError('Escribe un monto distinto de cero.')
    if (!activeMethod || !activeSource) return setError('Elige con qué pagaste.')

    setSaving(true)
    try {
      await recordTransaction(
        draftTransaction({
          type: 'expense',
          amount: value,
          date,
          payment_method: activeMethod,
          account_id: activeMethod === 'credit_card' ? null : activeSource,
          cc_id: activeMethod === 'credit_card' ? activeSource : null,
          category_id: activeCategory ?? null,
          notes: notes.trim(),
        }),
      )
      onDone()
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <AmountField label="Monto (MXN)" value={amount} onChange={(v) => { setAmount(v); setError(null) }} invalid={error !== null} autoFocus />
      {activeMethod && (
        <ChoiceField label="Método" value={activeMethod} onChange={setMethod} options={methodOptions} />
      )}
      {sources.length > 1 && activeSource && (
        <SelectField label={activeMethod === 'credit_card' ? 'Tarjeta' : 'Cuenta'} value={activeSource} onChange={setSourceId} options={sources} />
      )}
      {activeCategory && (
        <SelectField label="Categoría" value={activeCategory} onChange={setCategoryId} options={categoryOptions} />
      )}
      <TextField label="Fecha" type="date" value={date} onChange={setDate} mono />
      <TextField label="Nota" value={notes} onChange={setNotes} placeholder="Opcional" />
      {activeMethod === 'credit_card' && (
        <FieldNote>Con tarjeta tu banco no cambia. Sube la deuda y baja tu Disponible real.</FieldNote>
      )}
      <FieldNote>Un monto negativo se registra como reembolso.</FieldNote>
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel="Guardar gasto" saving={saving} onCancel={onDone} />
    </form>
  )
}
