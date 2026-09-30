import { useState, type FormEvent } from 'react'
import { AmountField, ChoiceField, FieldError, FieldNote, FormActions, SelectField, TextField } from '../../components/fields'
import { isLiquid, selectable } from '../../db/accounts'
import { recordExtraPayment } from '../../db/commitments'
import type { Account, Loan, PaymentMethod } from '../../db/types'
import type { MoneyData } from '../../db/useMoneyData'
import { isoToDate, todayIso } from '../../lib/dates'
import { formatDate, formatMoney } from '../../lib/format'
import { pickValid } from '../../lib/forms'
import { isUnscheduled, planExtraPayment, summarizeLoan, type ExtraMode } from '../../lib/loans'
import { parseAmount } from '../../lib/parseAmount'

const MODES: { value: ExtraMode; label: string }[] = [
  { value: 'shorten', label: 'Terminar antes' },
  { value: 'lower', label: 'Bajar la cuota' },
]

const METHOD: Record<Account['type'], PaymentMethod | null> = {
  checking: 'bank',
  cash: 'cash',
  unassigned: 'unassigned',
  savings: null,
}

const money = (value: number) => formatMoney(value, 'MXN')
const date = (iso: string | undefined) => (iso ? formatDate(isoToDate(iso)) : '—')

export function ExtraPaymentForm({ loan, data, onDone }: { loan: Loan; data: MoneyData; onDone: () => void }) {
  const borrowed = loan.direction === 'borrowed'
  const unscheduled = isUnscheduled(loan)
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<ExtraMode>('shorten')
  const [accountId, setAccountId] = useState<string | null>(loan.pay_from_account_id)
  const [day, setDay] = useState(todayIso())
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const summary = summarizeLoan(loan, data.installments, data.transactions)
  const accountOptions = selectable(data.accounts)
    .filter(isLiquid)
    .map((a) => ({ value: a.uuid, label: `${a.name} · ${money(a.current_balance)}` }))
  const activeAccount = pickValid(accountId, accountOptions)
  const value = parseAmount(amount)
  const valid = value !== null && value > 0 && value <= summary.remaining
  const plan = valid ? planExtraPayment(loan, data.installments, data.transactions, value, mode) : null
  const newNext = plan?.rows[0]
  const newPayoff = plan?.rows.at(-1)?.due_date

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (value === null || value <= 0) return setError('Escribe un monto mayor a cero.')
    if (value > summary.remaining) return setError(`El abono no puede ser mayor al restante, ${money(summary.remaining)}.`)
    if (!activeAccount) return setError(borrowed ? 'Elige de qué cuenta sale el abono.' : 'Elige la cuenta que recibe el abono.')
    const account = data.accounts.find((a) => a.uuid === activeAccount)
    const categoryKey = borrowed ? 'loan_payment' : 'loan_repayment'

    setSaving(true)
    try {
      await recordExtraPayment(loan, data, {
        amount: value,
        date: day,
        account_id: activeAccount,
        payment_method: account ? METHOD[account.type] : null,
        category_id: data.categories.find((c) => c.key === categoryKey)?.uuid ?? null,
        mode,
      })
      onDone()
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <AmountField
        label={unscheduled ? (borrowed ? 'Pago (MXN)' : 'Cobro (MXN)') : 'Abono extra (MXN)'}
        value={amount}
        onChange={(v) => { setAmount(v); setError(null) }}
        invalid={error !== null}
        autoFocus
      />
      {!unscheduled && <ChoiceField label="Qué hacer con el abono" value={mode} onChange={setMode} options={MODES} />}
      {activeAccount && (
        <SelectField label={borrowed ? 'Sale de' : 'Llega a'} value={activeAccount} onChange={setAccountId} options={accountOptions} />
      )}
      <TextField label="Fecha" type="date" value={day} onChange={setDay} mono />

      <table className="roster">
        <thead>
          <tr>
            <th scope="col" />
            <th scope="col" className="num">Ahora</th>
            <th scope="col" className="num">Con abono</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="dim">Restante</td>
            <td className="num mono">{money(summary.remaining)}</td>
            <td className="num mono text-cyan">{plan ? money(plan.remaining) : '—'}</td>
          </tr>
          {!unscheduled && (
          <>
          <tr>
            <td className="dim">Cuotas</td>
            <td className="num mono">{summary.installmentsLeft}</td>
            <td className="num mono">{plan ? plan.rows.length : '—'}</td>
          </tr>
          <tr>
            <td className="dim">Cuota</td>
            <td className="num mono">{summary.next ? money(summary.next.amount) : '—'}</td>
            <td className="num mono">{plan ? (newNext ? money(newNext.amount) : 'Liquidado') : '—'}</td>
          </tr>
          <tr>
            <td className="dim">Termina</td>
            <td className="num mono">{date(summary.next ? summary.payoffDate : undefined)}</td>
            <td className="num mono">{plan ? (newPayoff ? date(newPayoff) : 'Hoy') : '—'}</td>
          </tr>
          </>
          )}
        </tbody>
      </table>
      <FieldNote>
        {unscheduled
          ? borrowed
            ? 'El pago sale de tu banco en esa fecha y baja lo que debes.'
            : 'El cobro sube tu banco en esa fecha y baja lo que te deben.'
          : borrowed
            ? 'El abono baja tu banco hoy. Las cuotas pagadas no cambian; solo se recalculan las pendientes.'
            : 'El cobro sube tu banco hoy. Las cuotas cobradas no cambian; solo se recalculan las pendientes.'}
      </FieldNote>
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel={unscheduled ? (borrowed ? 'Registrar pago' : 'Registrar cobro') : 'Registrar abono'} saving={saving} onCancel={onDone} />
    </form>
  )
}
