import { useState, type FormEvent } from 'react'
import { AmountField, FieldError, FieldNote, FormActions, SelectField, TextField } from '../../components/fields'
import { ACCOUNT_TYPE_LABEL, selectable } from '../../db/accounts'
import { saveTransaction } from '../../db/ledger'
import { incomeRank, isRuleIncome, scheduledIncomeMatches } from '../../lib/incomeRules'
import type { AddFormProps } from './formProps'
import { isoToDate, todayIso } from '../../lib/dates'
import { formatDate } from '../../lib/format'
import { pickValid } from '../../lib/forms'
import { categoryOptions as categoryOptionsFor } from '../../lib/categories'
import { parseAmount } from '../../lib/parseAmount'
import { CategoryPicker } from '../../components/CategoryPicker'
import { NeedsAccount } from './NeedsAccount'

export function IncomeForm({ data, onDone, onNext, onOpenAccounts, prefill, editing }: AddFormProps) {
  const [amount, setAmount] = useState(prefill?.amount !== undefined ? String(prefill.amount) : '')
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
  const categoryOptions = categoryOptionsFor(data.categories, 'income', [prefill?.category_id])
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

  const clear = (setter: (value: string) => void) => (value: string) => {
    setter(value)
    setError(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!activeAccount) return setError('Elige la cuenta que recibe el ingreso.')

    const value = parseAmount(amount)
    if (value === null || value <= 0) return setError('Escribe un monto mayor a cero.')

    setSaving(true)
    try {
      const savedId = await saveTransaction(editing, {
        type: 'income',
        amount: value,
        date,
        account_id: activeAccount,
        category_id: activeCategory ?? null,
        notes: notes.trim(),
        recurring_id: linkedId,
        occurrence: linkedOccurrence,
        loan_installment_id: prefill?.loan_installment_id ?? null,
      })
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
      <AmountField label="Monto recibido (MXN)" value={amount} onChange={clear(setAmount)} invalid={error !== null} autoFocus />
      {activeAccount && <SelectField label="Cuenta" value={activeAccount} onChange={setAccountId} options={accountOptions} />}
      {activeCategory && (
        <CategoryPicker label="Tipo" categories={data.categories} kind="income" value={activeCategory} onChange={setCategoryId} keep={[prefill?.category_id]} />
      )}
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
