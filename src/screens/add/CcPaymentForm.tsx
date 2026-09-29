import { useState, type FormEvent } from 'react'
import { AmountField, FieldError, FieldNote, FormActions, SelectField, TextField } from '../../components/fields'
import { isLiquid, selectable } from '../../db/accounts'
import { fundFromBucket } from '../../db/buckets'
import { saveTransaction } from '../../db/ledger'
import { bucketFundingOptions, type BucketFunding } from '../../lib/buckets'
import { roundMoney } from '../../lib/money'
import type { AddFormProps } from './formProps'
import { todayIso } from '../../lib/dates'
import { formatMoney } from '../../lib/format'
import { pickValid } from '../../lib/forms'
import { parseAmount } from '../../lib/parseAmount'
import { NeedsAccount } from './NeedsAccount'

export function CcPaymentForm({ data, onDone, onOpenAccounts, prefill, editing }: AddFormProps) {
  const [amount, setAmount] = useState(prefill?.amount !== undefined ? String(prefill.amount) : '')
  const [cardId, setCardId] = useState<string | null>(prefill?.cc_id ?? null)
  const [accountId, setAccountId] = useState<string | null>(prefill?.account_id ?? null)
  const [date, setDate] = useState(prefill?.date ?? todayIso())
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [fundingId, setFundingId] = useState<string | null>(null)

  const cardOptions = selectable(data.cards, [prefill?.cc_id]).map((c) => ({
    value: c.uuid,
    label: `${c.name} · debe ${formatMoney(c.current_balance, 'MXN')}`,
  }))
  const accountOptions = selectable(data.accounts, [prefill?.account_id])
    .filter(isLiquid)
    .map((a) => ({ value: a.uuid, label: `${a.name} · ${formatMoney(a.current_balance, a.currency)}` }))
  const activeCard = pickValid(cardId, cardOptions)
  const activeAccount = pickValid(accountId, accountOptions)

  if (data.loaded && (cardOptions.length === 0 || accountOptions.length === 0)) {
    return <NeedsAccount onOpenAccounts={onOpenAccounts} message="Necesitas una tarjeta y una cuenta para registrar el pago." />
  }

  const card = data.cards.find((c) => c.uuid === activeCard)
  const account = data.accounts.find((a) => a.uuid === activeAccount)
  const value = parseAmount(amount)
  const available = account ? roundMoney(account.current_balance + (editing?.account_id === account.uuid ? editing.amount : 0)) : 0
  const shortBy = account && value !== null ? roundMoney(value - available) : 0
  const fundingOptions = account ? bucketFundingOptions(data.buckets, data.bucketMoves, data.accounts, account, shortBy) : []
  const funding = fundingOptions.find((option) => option.bucket.uuid === fundingId)

  async function fund(option: BucketFunding) {
    if (!account) return
    setSaving(true)
    setError(null)
    try {
      await fundFromBucket({ ...option, from: option.account, to: account, reason: `Para pagar ${card?.name ?? 'la tarjeta'}` })
      setFundingId(null)
    } catch {
      setError('No se pudo transferir. Intenta de nuevo.')
    }
    setSaving(false)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (value === null || value <= 0) return setError('Escribe un monto mayor a cero.')
    if (!activeCard || !activeAccount) return setError('Elige la tarjeta y la cuenta.')

    setSaving(true)
    try {
      await saveTransaction(editing, {
        type: 'cc_payment',
        amount: value,
        date,
        account_id: activeAccount,
        cc_id: activeCard,
        payment_method: account?.type === 'cash' ? 'cash' : 'bank',
      })
      onDone()
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      {activeCard && <SelectField label="Tarjeta" value={activeCard} onChange={setCardId} options={cardOptions} />}
      <AmountField label="Monto pagado (MXN)" value={amount} onChange={(v) => { setAmount(v); setError(null) }} invalid={error !== null} autoFocus />
      {card && card.current_balance > 0 && (
        <div className="verb-row">
          <button type="button" className="verb-button" onClick={() => setAmount(String(card.current_balance))}>
            Pagar total · <span className="mono">{formatMoney(card.current_balance, 'MXN')}</span>
          </button>
        </div>
      )}
      {activeAccount && <SelectField label="Desde" value={activeAccount} onChange={setAccountId} options={accountOptions} />}
      <TextField label="Fecha" type="date" value={date} onChange={setDate} mono />
      {account && shortBy > 0 && (
        <div className="stat-list">
          <div className="readout">
            <span className="dim">Saldo en {account.name}</span>
            <span className="mono">{formatMoney(available, 'MXN')}</span>
          </div>
          <div className="readout">
            <span className="dim">Faltan para este pago</span>
            <span className="mono text-amber">{formatMoney(shortBy, 'MXN')}</span>
          </div>
        </div>
      )}
      {account && shortBy > 0 && !funding && (
        fundingOptions.length === 0 ? (
          <FieldNote>Este pago es mayor que el saldo de {account.name}. Puedes transferir desde otra cuenta antes de pagar.</FieldNote>
        ) : (
          <div className="verb-row">
            {fundingOptions.map((option) => (
              <button key={option.bucket.uuid} type="button" className="verb-button" onClick={() => setFundingId(option.bucket.uuid)}>
                Traer de {option.bucket.name} · <span className="mono">{formatMoney(option.amount, 'MXN')}</span>
              </button>
            ))}
          </div>
        )
      )}
      {account && funding && (
        <>
          <FieldNote>
            Se transfieren {formatMoney(funding.amount, 'MXN')} de {funding.account.name} a {account.name} y se retiran del apartado {funding.bucket.name}.
            Tu Disponible real sube esa cantidad, porque el dinero sale de ahorro.
          </FieldNote>
          <div className="verb-row">
            <button type="button" className="verb-button verb-primary" disabled={saving} onClick={() => void fund(funding)}>
              Confirmar transferencia
            </button>
            <button type="button" className="verb-button" onClick={() => setFundingId(null)}>
              Cancelar
            </button>
          </div>
        </>
      )}
      <FieldNote>
        {card?.payment_strategy === 'full'
          ? 'El pago baja tu banco y tu deuda al mismo tiempo. Tu Disponible real ya lo tenía apartado.'
          : 'El pago baja tu banco y tu deuda al mismo tiempo.'}
      </FieldNote>
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel={editing ? 'Guardar cambios' : 'Guardar pago'} saving={saving} onCancel={onDone} />
    </form>
  )
}
