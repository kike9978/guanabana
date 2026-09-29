import { useState, type FormEvent } from 'react'
import { AmountField, FieldError, FieldNote, FormActions, SelectField, TextField } from '../../components/fields'
import { ACCOUNT_TYPE_LABEL, isLiquid, selectable } from '../../db/accounts'
import { saveTransaction } from '../../db/ledger'
import type { MoneyData } from '../../db/useMoneyData'
import { todayIso } from '../../lib/dates'
import { formatMoney } from '../../lib/format'
import { pickValid } from '../../lib/forms'
import { parseAmount } from '../../lib/parseAmount'
import type { AddFormProps } from './formProps'
import { NeedsAccount } from './NeedsAccount'

export function TransferForm({ data, onDone, onOpenAccounts, prefill, editing }: AddFormProps) {
  const [amount, setAmount] = useState(prefill?.amount !== undefined ? String(prefill.amount) : '')
  const [fromId, setFromId] = useState<string | null>(prefill?.account_id ?? null)
  const [toId, setToId] = useState<string | null>(prefill?.to_account_id ?? null)
  const [date, setDate] = useState(prefill?.date ?? todayIso())
  const [notes, setNotes] = useState(prefill?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const accounts = selectable(data.accounts, [prefill?.account_id, prefill?.to_account_id])
  const label = (a: MoneyData['accounts'][number]) =>
    `${a.name} · ${ACCOUNT_TYPE_LABEL[a.type]} · ${formatMoney(a.current_balance, a.currency)}`
  const fromOptions = accounts.map((a) => ({ value: a.uuid, label: label(a) }))
  const activeFrom = pickValid(fromId, fromOptions)
  const toOptions = accounts
    .filter((a) => a.uuid !== activeFrom && a.type !== 'unassigned')
    .map((a) => ({ value: a.uuid, label: label(a) }))
  const activeTo = pickValid(toId, toOptions)

  if (data.loaded && (fromOptions.length === 0 || toOptions.length === 0)) {
    return <NeedsAccount onOpenAccounts={onOpenAccounts} message="Necesitas al menos dos cuentas para transferir." />
  }

  const from = data.accounts.find((a) => a.uuid === activeFrom)
  const to = data.accounts.find((a) => a.uuid === activeTo)
  const changesAvailable = from && to && isLiquid(from) !== isLiquid(to)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const value = parseAmount(amount)
    if (value === null || value <= 0) return setError('Escribe un monto mayor a cero.')
    if (!activeFrom || !activeTo) return setError('Elige las dos cuentas.')

    setSaving(true)
    try {
      await saveTransaction(editing, { type: 'transfer', amount: value, date, account_id: activeFrom, to_account_id: activeTo, notes: notes.trim() })
      onDone()
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <AmountField label="Monto (MXN)" value={amount} onChange={(v) => { setAmount(v); setError(null) }} invalid={error !== null} autoFocus />
      {activeFrom && <SelectField label="Desde" value={activeFrom} onChange={setFromId} options={fromOptions} />}
      {activeTo && <SelectField label="Hacia" value={activeTo} onChange={setToId} options={toOptions} />}
      <TextField label="Fecha" type="date" value={date} onChange={setDate} mono />
      <TextField label="Nota" value={notes} onChange={setNotes} placeholder="Opcional" />
      <FieldNote>
        {changesAvailable
          ? 'Mover dinero hacia o desde Ahorro cambia tu Disponible real.'
          : 'Entre banco, efectivo y saldo sin origen tu Disponible real no cambia.'}
      </FieldNote>
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel={editing ? 'Guardar cambios' : 'Guardar transferencia'} saving={saving} onCancel={onDone} />
    </form>
  )
}
