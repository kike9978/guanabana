import { useState, type FormEvent } from 'react'
import { AmountField, FieldError, FieldNote, FormActions, SelectField, TextField } from '../../components/fields'
import { ACCOUNT_TYPE_LABEL } from '../../db/accounts'
import { draftTransaction, recordTransaction } from '../../db/ledger'
import type { MoneyData } from '../../db/useMoneyData'
import { todayIso } from '../../lib/dates'
import { pickValid } from '../../lib/forms'
import { parseAmount } from '../../lib/parseAmount'
import { NeedsAccount } from './NeedsAccount'

export function IncomeForm({ data, onDone, onOpenAccounts }: { data: MoneyData; onDone: () => void; onOpenAccounts: () => void }) {
  const [amount, setAmount] = useState('')
  const [accountId, setAccountId] = useState<string | null>(null)
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [date, setDate] = useState(todayIso())
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const accountOptions = data.accounts
    .filter((a) => a.type !== 'unassigned')
    .map((a) => ({ value: a.uuid, label: `${a.name} · ${ACCOUNT_TYPE_LABEL[a.type]}` }))
  const categoryOptions = data.categories
    .filter((c) => c.kind === 'income')
    .map((c) => ({ value: c.uuid, label: c.name }))
  const activeAccount = pickValid(accountId, accountOptions)
  const activeCategory = pickValid(categoryId, categoryOptions)

  if (data.loaded && accountOptions.length === 0) {
    return <NeedsAccount onOpenAccounts={onOpenAccounts} message="Agrega una cuenta de banco o efectivo para recibir ingresos." />
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const value = parseAmount(amount)
    if (value === null || value <= 0) return setError('Escribe un monto mayor a cero.')
    if (!activeAccount) return setError('Elige la cuenta que recibe el ingreso.')

    setSaving(true)
    try {
      await recordTransaction(
        draftTransaction({
          type: 'income',
          amount: value,
          date,
          account_id: activeAccount,
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
      <AmountField label="Monto recibido (MXN)" value={amount} onChange={(v) => { setAmount(v); setError(null) }} invalid={error !== null} autoFocus />
      {activeAccount && <SelectField label="Cuenta" value={activeAccount} onChange={setAccountId} options={accountOptions} />}
      {activeCategory && <SelectField label="Tipo" value={activeCategory} onChange={setCategoryId} options={categoryOptions} />}
      <TextField label="Fecha" type="date" value={date} onChange={setDate} mono />
      <TextField label="Nota" value={notes} onChange={setNotes} placeholder="Opcional" />
      <FieldNote>El cálculo con días trabajados y tipo de cambio CAD llega con las reglas de ahorro.</FieldNote>
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel="Guardar ingreso" saving={saving} onCancel={onDone} />
    </form>
  )
}
