import { useState, type FormEvent } from 'react'
import { AmountField, FieldError, FieldNote, FormActions, SelectField, TextField } from '../../components/fields'
import { ACCOUNT_TYPE_LABEL, isLiquid, selectable } from '../../db/accounts'
import { transferWithBuckets } from '../../db/buckets'
import { saveTransaction } from '../../db/ledger'
import type { Account } from '../../db/types'
import type { MoneyData } from '../../db/useMoneyData'
import { bucketsInAccount, unassignedIn, type HeldBucket } from '../../lib/buckets'
import { todayIso } from '../../lib/dates'
import { formatMoney } from '../../lib/format'
import { pickValid } from '../../lib/forms'
import { roundMoney } from '../../lib/money'
import { parseAmount } from '../../lib/parseAmount'
import type { AddFormProps } from './formProps'
import { NeedsAccount } from './NeedsAccount'

const NO_BUCKET = ''
const money = (value: number) => formatMoney(value, 'MXN')
const change = (before: number, after: number) => (before === after ? money(after) : `${money(before)} → ${money(after)}`)

/** One apartado is preselected; with several, the user picks, so a transfer is never tagged by guess. */
function bucketOptions(rows: HeldBucket[]) {
  const buckets = rows.map((row) => ({ value: row.bucket.uuid, label: `${row.bucket.name} · ${money(row.balance)}` }))
  const none = { value: NO_BUCKET, label: 'Sin apartado' }
  return rows.length === 1 ? [...buckets, none] : [none, ...buckets]
}

function heldIn(account: Account | undefined, data: MoneyData, editing: boolean): HeldBucket[] {
  if (!account || isLiquid(account) || editing) return []
  return bucketsInAccount(account.uuid, data.buckets, data.bucketMoves)
}

export function TransferForm({ data, onDone, onOpenAccounts, prefill, editing }: AddFormProps) {
  const [amount, setAmount] = useState(prefill?.amount !== undefined ? String(prefill.amount) : '')
  const [fromId, setFromId] = useState<string | null>(prefill?.account_id ?? null)
  const [toId, setToId] = useState<string | null>(prefill?.to_account_id ?? null)
  const [fromBucketId, setFromBucketId] = useState<string | null>(null)
  const [toBucketId, setToBucketId] = useState<string | null>(null)
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
  const fromHeld = heldIn(from, data, Boolean(editing))
  const toHeld = heldIn(to, data, Boolean(editing))
  const fromBucketOptions = bucketOptions(fromHeld)
  const toBucketOptions = bucketOptions(toHeld)
  const fromBucket = fromHeld.find((row) => row.bucket.uuid === pickValid(fromBucketId, fromBucketOptions))
  const toBucket = toHeld.find((row) => row.bucket.uuid === pickValid(toBucketId, toBucketOptions))
  const value = parseAmount(amount)
  const moved = value ?? 0
  const fromUnassigned = from && fromHeld.length > 0 ? unassignedIn(from, data.buckets, data.bucketMoves) : 0

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (value === null || value <= 0) return setError('Escribe un monto mayor a cero.')
    if (!activeFrom || !activeTo || !from || !to) return setError('Elige las dos cuentas.')
    if (fromBucket && value > fromBucket.balance) return setError(`${fromBucket.bucket.name} tiene ${money(fromBucket.balance)}.`)

    setSaving(true)
    try {
      if (fromBucket || toBucket) {
        await transferWithBuckets({
          from,
          to,
          amount: value,
          date,
          notes: notes.trim() || (toBucket ? `Al apartado ${toBucket.bucket.name}` : `Desde el apartado ${fromBucket!.bucket.name}`),
          reason: notes.trim() || `De ${from.name} a ${to.name}`,
          fromBucket: fromBucket?.bucket,
          toBucket: toBucket?.bucket,
        })
      } else {
        await saveTransaction(editing, { type: 'transfer', amount: value, date, account_id: activeFrom, to_account_id: activeTo, notes: notes.trim() })
      }
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
      {fromHeld.length > 0 && (
        <SelectField
          label="De qué apartado sale"
          value={pickValid(fromBucketId, fromBucketOptions) ?? NO_BUCKET}
          onChange={(v) => { setFromBucketId(v); setError(null) }}
          options={fromBucketOptions}
        />
      )}
      {activeTo && <SelectField label="Hacia" value={activeTo} onChange={setToId} options={toOptions} />}
      {toHeld.length > 0 && (
        <SelectField
          label="Para qué apartado"
          value={pickValid(toBucketId, toBucketOptions) ?? NO_BUCKET}
          onChange={setToBucketId}
          options={toBucketOptions}
        />
      )}
      <TextField label="Fecha" type="date" value={date} onChange={setDate} mono />
      <TextField label="Nota" value={notes} onChange={setNotes} placeholder="Opcional" />
      {(fromBucket || toBucket) && (
        <div className="stat-list">
          {fromBucket && (
            <div className="readout">
              <span className="dim">{fromBucket.bucket.name}</span>
              <span className="mono">{change(fromBucket.balance, roundMoney(fromBucket.balance - moved))}</span>
            </div>
          )}
          {toBucket && (
            <div className="readout">
              <span className="dim">{toBucket.bucket.name}</span>
              <span className="mono">{change(toBucket.balance, roundMoney(toBucket.balance + moved))}</span>
            </div>
          )}
        </div>
      )}
      <FieldNote>
        {changesAvailable
          ? 'Mover dinero hacia o desde Ahorro cambia tu Disponible real.'
          : 'Entre banco, efectivo y saldo sin origen tu Disponible real no cambia.'}
        {toBucket ? ` También se aparta para ${toBucket.bucket.name}.` : ''}
        {fromBucket ? ` Sale del apartado ${fromBucket.bucket.name}.` : ''}
      </FieldNote>
      {from && fromHeld.length > 0 && !fromBucket && value !== null && value > fromUnassigned && (
        <FieldNote>{`En ${from.name} hay ${money(Math.max(0, fromUnassigned))} sin apartar. Si este dinero es de un apartado, elige de cuál sale.`}</FieldNote>
      )}
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel={editing ? 'Guardar cambios' : 'Guardar transferencia'} saving={saving} onCancel={onDone} />
    </form>
  )
}
