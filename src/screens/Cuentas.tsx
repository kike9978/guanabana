import { useState, type FormEvent } from 'react'
import { AmountField, ChoiceField, FieldError, FieldNote, FormActions, TextField } from '../components/fields'
import { FooterHint, Panel } from '../components/hud'
import { StageHeader } from '../components/StageHeader'
import { ACCOUNT_TYPE_LABEL, STRATEGY_LABEL, createAccount, createCard } from '../db/accounts'
import type { AccountType, PaymentStrategy } from '../db/types'
import { useMoneyData } from '../db/useMoneyData'
import { formatDate, formatMoney } from '../lib/format'
import { nextDateForDay } from '../lib/dates'
import { roundMoney } from '../lib/money'
import { parseAmount, parseDay } from '../lib/parseAmount'

type NewAccountType = Exclude<AccountType, 'unassigned'>

const ACCOUNT_TYPES: { value: NewAccountType; label: string }[] = [
  { value: 'checking', label: 'Banco' },
  { value: 'cash', label: 'Efectivo' },
  { value: 'savings', label: 'Ahorro' },
]

const STRATEGIES = (Object.keys(STRATEGY_LABEL) as PaymentStrategy[]).map((value) => ({ value, label: STRATEGY_LABEL[value] }))

function AccountForm({ onDone }: { onDone: () => void }) {
  const [type, setType] = useState<NewAccountType>('checking')
  const [name, setName] = useState('')
  const [balance, setBalance] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const value = parseAmount(balance || '0')
    if (value === null) return setError('Escribe un saldo como 8500 o 8,500.50.')
    setSaving(true)
    try {
      await createAccount({ name: name.trim() || ACCOUNT_TYPE_LABEL[type], type, balance: value })
      onDone()
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <ChoiceField label="Tipo" value={type} onChange={setType} options={ACCOUNT_TYPES} />
      <TextField label="Nombre" value={name} onChange={setName} placeholder={ACCOUNT_TYPE_LABEL[type]} autoFocus />
      <AmountField label="Saldo actual (MXN)" value={balance} onChange={(v) => { setBalance(v); setError(null) }} invalid={error !== null} />
      {type === 'savings' && <FieldNote>Una cuenta de ahorro no cuenta en tu Disponible real.</FieldNote>}
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel="Guardar cuenta" saving={saving} onCancel={onDone} />
    </form>
  )
}

function CardForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [limit, setLimit] = useState('')
  const [debt, setDebt] = useState('')
  const [statementDay, setStatementDay] = useState('')
  const [dueDay, setDueDay] = useState('')
  const [strategy, setStrategy] = useState<PaymentStrategy>('full')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const limitValue = parseAmount(limit || '0')
    const debtValue = parseAmount(debt || '0')
    const statement = parseDay(statementDay)
    const due = parseDay(dueDay)
    if (!name.trim()) return setError('Ponle un nombre corto, sin el número de la tarjeta.')
    if (limitValue === null || debtValue === null) return setError('Revisa el límite y la deuda.')
    if (statement === null || due === null) return setError('El día de corte y el de pago van del 1 al 31.')

    setSaving(true)
    try {
      await createCard({
        name: name.trim(),
        limit: limitValue,
        current_balance: debtValue,
        statement_day: statement,
        due_day: due,
        payment_strategy: strategy,
      })
      onDone()
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <TextField label="Nombre" value={name} onChange={setName} placeholder="Ej. TDC Oro" autoFocus />
      <AmountField label="Límite (MXN)" value={limit} onChange={setLimit} />
      <AmountField label="Deuda actual (MXN)" value={debt} onChange={setDebt} />
      <div className="field-row">
        <TextField label="Día de corte" value={statementDay} onChange={setStatementDay} inputMode="numeric" placeholder="5" mono />
        <TextField label="Día de pago" value={dueDay} onChange={setDueDay} inputMode="numeric" placeholder="25" mono />
      </div>
      <ChoiceField label="Cómo la pagas" value={strategy} onChange={setStrategy} options={STRATEGIES} />
      <FieldNote>Con pago total, toda la deuda se aparta de tu Disponible real.</FieldNote>
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel="Guardar tarjeta" saving={saving} onCancel={onDone} />
    </form>
  )
}

export function Cuentas() {
  const data = useMoneyData()
  const [adding, setAdding] = useState<'account' | 'card' | null>(null)
  const bank = data.accounts.filter((a) => a.type === 'checking').reduce((sum, a) => sum + a.current_balance, 0)
  const accounts = [...data.accounts].sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))

  if (!data.loaded) return null

  return (
    <div className="stage-grid stage-grid--single">
      <div className="stage-main">
        <StageHeader title="Cuentas y tarjetas" />

        <Panel
          title="Cuentas"
          aside={
            adding !== 'account' && (
              <button type="button" className="panel-verb" onClick={() => setAdding('account')}>
                + Nueva cuenta
              </button>
            )
          }
        >
          {adding === 'account' && <AccountForm onDone={() => setAdding(null)} />}
          {accounts.length === 0 ? (
            <FooterHint>Aún no hay cuentas.</FooterHint>
          ) : (
            <table className="roster">
              <thead>
                <tr>
                  <th scope="col">Nombre</th>
                  <th scope="col">Tipo</th>
                  <th scope="col" className="num">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.uuid}>
                    <td>{account.name}</td>
                    <td className="dim">{ACCOUNT_TYPE_LABEL[account.type]}</td>
                    <td className="num mono">{formatMoney(account.current_balance, account.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel
          title="Tarjetas de crédito"
          aside={
            adding !== 'card' && (
              <button type="button" className="panel-verb" onClick={() => setAdding('card')}>
                + Nueva tarjeta
              </button>
            )
          }
        >
          {adding === 'card' && <CardForm onDone={() => setAdding(null)} />}
          {data.cards.length === 0 ? (
            <FooterHint>Aún no hay tarjetas.</FooterHint>
          ) : (
            <table className="roster">
              <thead>
                <tr>
                  <th scope="col">Tarjeta</th>
                  <th scope="col" className="num">Deuda</th>
                  <th scope="col" className="num">Crédito disp.</th>
                  <th scope="col">Pago</th>
                  <th scope="col" className="num">Banco tras pago</th>
                </tr>
              </thead>
              <tbody>
                {data.cards.map((card) => {
                  const after = roundMoney(bank - card.current_balance)
                  return (
                    <tr key={card.uuid}>
                      <td>
                        {card.name}
                        <span className="row-sub">
                          Corte día {card.statement_day} · {STRATEGY_LABEL[card.payment_strategy]}
                        </span>
                      </td>
                      <td className="num mono">{formatMoney(card.current_balance, 'MXN')}</td>
                      <td className="num mono">{formatMoney(card.limit - card.current_balance, 'MXN')}</td>
                      <td className="mono">{formatDate(nextDateForDay(card.due_day, new Date()))}</td>
                      <td className={`num mono${after < 0 ? ' text-heat' : ''}`}>{formatMoney(after, 'MXN')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {data.cards.length > 0 && <FooterHint>Banco tras pago: cuánto queda en tu banco si pagas el total.</FooterHint>}
        </Panel>
      </div>
    </div>
  )
}
