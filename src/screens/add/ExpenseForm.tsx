import { useState, type FormEvent } from 'react'
import { AmountField, ChoiceField, FieldError, FieldNote, FormActions, SelectField, TextField } from '../../components/fields'
import { selectable } from '../../db/accounts'
import { saveTransaction } from '../../db/ledger'
import { UNCATEGORIZED_KEY } from '../../db/seed'
import type { AccountType, PaymentMethod } from '../../db/types'
import type { AddFormProps } from './formProps'
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

  const categoryOptions = data.categories
    .filter((c) => c.kind === 'expense')
    .map((c) => ({ value: c.uuid, label: c.name }))
  const fallbackCategory = data.categories.find((c) => c.key === UNCATEGORIZED_KEY)?.uuid ?? null
  const activeCategory = pickValid(categoryId ?? prefillCategory ?? fallbackCategory, categoryOptions)

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
      await saveTransaction(editing, {
        type: 'expense',
        amount: value,
        date,
        payment_method: activeMethod,
        account_id: activeMethod === 'credit_card' ? null : activeSource,
        cc_id: activeMethod === 'credit_card' ? activeSource : null,
        category_id: activeCategory ?? null,
        notes: notes.trim(),
        recurring_id: prefill?.recurring_id ?? null,
        occurrence: prefill?.occurrence ?? null,
        loan_installment_id: prefill?.loan_installment_id ?? null,
      })
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
      {editing ? (
        <FieldNote>Al guardar se revierte el saldo anterior y se aplica el nuevo.</FieldNote>
      ) : prefill?.recurring_id || prefill?.loan_installment_id ? (
        <FieldNote>Este pago ya estaba apartado. Al guardarlo, tu Disponible real no cambia.</FieldNote>
      ) : (
        <FieldNote>Un monto negativo se registra como reembolso.</FieldNote>
      )}
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel={editing ? 'Guardar cambios' : 'Guardar gasto'} saving={saving} onCancel={onDone} />
    </form>
  )
}
