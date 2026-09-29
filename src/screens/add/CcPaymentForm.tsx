import { useState, type FormEvent } from 'react'
import { AmountField, FieldError, FieldNote, FormActions, SelectField, TextField } from '../../components/fields'
import { isLiquid } from '../../db/accounts'
import { draftTransaction, recordTransaction } from '../../db/ledger'
import type { MoneyData } from '../../db/useMoneyData'
import { todayIso } from '../../lib/dates'
import { formatMoney } from '../../lib/format'
import { pickValid } from '../../lib/forms'
import { parseAmount } from '../../lib/parseAmount'
import { NeedsAccount } from './NeedsAccount'

export function CcPaymentForm({ data, onDone, onOpenAccounts }: { data: MoneyData; onDone: () => void; onOpenAccounts: () => void }) {
  const [amount, setAmount] = useState('')
  const [cardId, setCardId] = useState<string | null>(null)
  const [accountId, setAccountId] = useState<string | null>(null)
  const [date, setDate] = useState(todayIso())
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const cardOptions = data.cards.map((c) => ({ value: c.uuid, label: `${c.name} · debe ${formatMoney(c.current_balance, 'MXN')}` }))
  const accountOptions = data.accounts
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

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (value === null || value <= 0) return setError('Escribe un monto mayor a cero.')
    if (!activeCard || !activeAccount) return setError('Elige la tarjeta y la cuenta.')

    setSaving(true)
    try {
      await recordTransaction(
        draftTransaction({ type: 'cc_payment', amount: value, date, account_id: activeAccount, cc_id: activeCard, payment_method: account?.type === 'cash' ? 'cash' : 'bank' }),
      )
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
      {account && value !== null && value > account.current_balance && (
        <FieldNote>Este pago es mayor que el saldo de {account.name}. Revisa si necesitas mover dinero de ahorro.</FieldNote>
      )}
      <FieldNote>
        {card?.payment_strategy === 'full'
          ? 'El pago baja tu banco y tu deuda al mismo tiempo. Tu Disponible real ya lo tenía apartado.'
          : 'El pago baja tu banco y tu deuda al mismo tiempo.'}
      </FieldNote>
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel="Guardar pago" saving={saving} onCancel={onDone} />
    </form>
  )
}
