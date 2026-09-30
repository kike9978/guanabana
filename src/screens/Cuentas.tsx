import { useState, type FormEvent } from 'react'
import { useDossierSheet } from '../components/mobile'
import { AmountField, ChoiceField, FieldError, FieldNote, FormActions, TextField } from '../components/fields'
import { FooterHint, Panel, StatBar } from '../components/hud'
import { StageHeader } from '../components/StageHeader'
import {
  ACCOUNT_TYPE_LABEL,
  STRATEGY_LABEL,
  canArchive,
  createAccount,
  createCard,
  isLiquid,
  reconcileBalance,
  setAccountArchived,
  setCardArchived,
  updateAccount,
  updateCard,
} from '../db/accounts'
import { updateSavingsBalance } from '../db/buckets'
import type { Account, AccountType, CreditCard, PaymentStrategy } from '../db/types'
import { useMoneyData, type MoneyData } from '../db/useMoneyData'
import { bucketsInAccount, proportionalSplit, unassignedIn } from '../lib/buckets'
import { formatDate, formatMoney } from '../lib/format'
import { categoryLabel } from '../lib/categories'
import { dateToIso, isoToDate } from '../lib/dates'
import { roundMoney } from '../lib/money'
import { parseAmount, parseDay } from '../lib/parseAmount'
import { msiPendingByCard, msiPlans, msiPostedCount, msiPurchase, msiSchedule, payableBalance } from '../lib/msi'
import { computeRealAvailable } from '../lib/realAvailable'
import { moneySnapshot } from '../lib/snapshot'
import { lastCut, nextPayment, nextPayments, paymentLabel, statementOpenForPayment } from '../lib/statement'

type NewAccountType = Exclude<AccountType, 'unassigned'>
export type Selection = { kind: 'account'; uuid: string } | { kind: 'card'; uuid: string }
type DossierMode = 'view' | 'edit' | 'reconcile' | 'cover'

const ACCOUNT_TYPES: { value: NewAccountType; label: string }[] = [
  { value: 'checking', label: ACCOUNT_TYPE_LABEL.checking },
  { value: 'cash', label: ACCOUNT_TYPE_LABEL.cash },
  { value: 'savings', label: ACCOUNT_TYPE_LABEL.savings },
]

const STRATEGIES = (Object.keys(STRATEGY_LABEL) as PaymentStrategy[]).map((value) => ({ value, label: STRATEGY_LABEL[value] }))

const money = (value: number) => formatMoney(value, 'MXN')

function AccountForm({ account, data, onDone }: { account?: Account; data?: MoneyData; onDone: () => void }) {
  const [type, setType] = useState<NewAccountType>(account && account.type !== 'unassigned' ? account.type : 'checking')
  const [name, setName] = useState(account?.name ?? '')
  const [balance, setBalance] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const typeOptions = account?.type === 'unassigned' ? [] : ACCOUNT_TYPES
  const typeChanged = Boolean(account && account.type !== 'unassigned' && type !== account.type)
  const availability = account && data && typeChanged
    ? (() => {
        const now = new Date()
        const shifted = { ...data, accounts: data.accounts.map((row) => (row.uuid === account.uuid ? { ...row, type } : row)) }
        return { before: moneySnapshot(data, now).breakdown.total, after: moneySnapshot(shifted, now).breakdown.total }
      })()
    : null

  async function submit(event: FormEvent) {
    event.preventDefault()
    const value = parseAmount(balance || '0')
    if (value === null) return setError('Escribe un saldo como 8500 o 8,500.50.')
    setSaving(true)
    try {
      const finalName = name.trim() || ACCOUNT_TYPE_LABEL[type]
      if (account) await updateAccount(account, { name: finalName, type })
      else await createAccount({ name: finalName, type, balance: value })
      onDone()
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      {typeOptions.length > 0 && <ChoiceField label="Tipo" value={type} onChange={setType} options={typeOptions} />}
      <TextField label="Nombre" value={name} onChange={setName} placeholder={ACCOUNT_TYPE_LABEL[type]} autoFocus />
      {!account && (
        <AmountField label="Saldo actual (MXN)" value={balance} onChange={(v) => { setBalance(v); setError(null) }} invalid={error !== null} />
      )}
      {account ? (
        <FieldNote>El saldo se cambia con Ajustar saldo, para que quede registrado.</FieldNote>
      ) : (
        !isLiquid({ type }) && (
          <FieldNote>No cuenta en tu Disponible real. Si su saldo cambia por rendimientos, actualízalo desde aquí y reparte la diferencia en tus apartados.</FieldNote>
        )
      )}
      {availability && (
        <FieldNote>
          {availability.before === availability.after
            ? 'Tu Disponible real no cambia.'
            : `Tu Disponible real ${availability.after > availability.before ? 'sube' : 'baja'} ${money(Math.abs(availability.after - availability.before))}.`}
        </FieldNote>
      )}
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel={account ? 'Guardar cambios' : 'Guardar cuenta'} saving={saving} onCancel={onDone} />
    </form>
  )
}

function CardForm({ card, onDone }: { card?: CreditCard; onDone: () => void }) {
  const [name, setName] = useState(card?.name ?? '')
  const [limit, setLimit] = useState(card ? String(card.limit) : '')
  const [debt, setDebt] = useState('')
  const [statementDay, setStatementDay] = useState(card ? String(card.statement_day) : '')
  const [dueDay, setDueDay] = useState(card ? String(card.due_day) : '')
  const [strategy, setStrategy] = useState<PaymentStrategy>(card?.payment_strategy ?? 'full')
  const today = new Date()
  const initialCut = card ? dateToIso(lastCut(card.statement_day, today)) : null
  const keeps = card?.statement_date != null && card.statement_date === initialCut
  const [statementBalance, setStatementBalance] = useState(keeps && card?.statement_balance != null ? String(card.statement_balance) : '')
  const [minimum, setMinimum] = useState(keeps && card?.minimum_payment != null ? String(card.minimum_payment) : '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const parsedStatementDay = parseDay(statementDay)
  const parsedDueDay = parseDay(dueDay)
  const cut = parsedStatementDay === null ? null : lastCut(parsedStatementDay, today)
  const askStatement =
    strategy !== 'full' &&
    cut !== null &&
    parsedDueDay !== null &&
    statementOpenForPayment({ statement_day: parsedStatementDay!, due_day: parsedDueDay }, today)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const limitValue = parseAmount(limit || '0')
    const debtValue = parseAmount(debt || '0')
    const statement = parsedStatementDay
    const due = parsedDueDay
    const statementValue = askStatement && statementBalance.trim() ? parseAmount(statementBalance) : null
    const minimumValue = askStatement && strategy === 'minimum' && minimum.trim() ? parseAmount(minimum) : null
    if (!name.trim()) return setError('Ponle un nombre corto, sin el número de la tarjeta.')
    if (limitValue === null || debtValue === null) return setError('Revisa el límite y la deuda.')
    if (statement === null || due === null) return setError('El día de corte y el de pago van del 1 al 31.')
    if ((statementBalance.trim() && askStatement && (statementValue === null || statementValue < 0)) || (minimumValue !== null && minimumValue < 0)) {
      return setError('Revisa el saldo al corte y el pago mínimo.')
    }
    if (minimum.trim() && askStatement && strategy === 'minimum' && minimumValue === null) return setError('Revisa el pago mínimo.')
    if (minimumValue !== null && statementValue !== null && minimumValue > statementValue) {
      return setError('El pago mínimo no puede ser mayor que el saldo al corte.')
    }

    setSaving(true)
    try {
      const entered = statementValue !== null || minimumValue !== null
      const fields = {
        name: name.trim(),
        limit: limitValue,
        statement_day: statement,
        due_day: due,
        payment_strategy: strategy,
        statement_balance: statementValue,
        minimum_payment: minimumValue,
        statement_date: entered && cut ? dateToIso(cut) : null,
      }
      if (card) await updateCard(card, fields)
      else await createCard({ ...fields, current_balance: debtValue })
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
      {!card && <AmountField label="Deuda actual (MXN)" value={debt} onChange={setDebt} />}
      <div className="field-row">
        <TextField label="Día de corte" value={statementDay} onChange={setStatementDay} inputMode="numeric" placeholder="5" mono />
        <TextField label="Día de pago" value={dueDay} onChange={setDueDay} inputMode="numeric" placeholder="25" mono />
      </div>
      <ChoiceField label="Cómo la pagas" value={strategy} onChange={setStrategy} options={STRATEGIES} />
      {askStatement && cut && (
        <>
          <div className="field-row">
            <AmountField
              label="Saldo al último corte (MXN)"
              value={statementBalance}
              onChange={(v) => { setStatementBalance(v); setError(null) }}
            />
            {strategy === 'minimum' && (
              <AmountField label="Pago mínimo de este corte (MXN)" value={minimum} onChange={(v) => { setMinimum(v); setError(null) }} />
            )}
          </div>
          <FieldNote>
            {`Opcional. Es lo de tu estado de cuenta del corte del ${formatDate(cut)}. Déjalo vacío para calcularlo con tus movimientos.`}
            {keeps && card?.statement_balance != null && statementBalance !== String(card.statement_balance)
              ? ` Antes: ${money(card.statement_balance)} al corte.`
              : ''}
            {keeps && card?.minimum_payment != null && minimum !== String(card.minimum_payment) ? ` Antes: ${money(card.minimum_payment)} de mínimo.` : ''}
          </FieldNote>
        </>
      )}
      <FieldNote>
        {card
          ? 'La deuda se cambia con Ajustar saldo, para que quede registrada.'
          : 'Toda la deuda se aparta de tu Disponible real. Cómo la pagas solo cambia el monto de tu próximo pago.'}
      </FieldNote>
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel={card ? 'Guardar cambios' : 'Guardar tarjeta'} saving={saving} onCancel={onDone} />
    </form>
  )
}

function realAvailableWith(data: MoneyData, target: Account | CreditCard, balance: number): number {
  const swap = <T extends { uuid: string; current_balance: number }>(records: T[]) =>
    records.map((record) => (record.uuid === target.uuid ? { ...record, current_balance: balance } : record))
  const cards = swap(data.cards)
  return computeRealAvailable({
    accounts: swap(data.accounts),
    cards,
    buffer: 0,
    msiPending: msiPendingByCard(data.transactions, cards, new Date()),
  }).total
}

export function ReconcileForm({
  data,
  target,
  onDone,
  onSaved,
}: {
  data: MoneyData
  target: Selection
  onDone: () => void
  onSaved?: () => Promise<void>
}) {
  const record = target.kind === 'account' ? data.accounts.find((a) => a.uuid === target.uuid) : data.cards.find((c) => c.uuid === target.uuid)
  const [actual, setActual] = useState('')
  const [lines, setLines] = useState<Record<string, string> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  if (!record) return null

  const value = parseAmount(actual)
  const gap = value === null ? null : roundMoney(value - record.current_balance)
  const impact = value === null ? 0 : roundMoney(realAvailableWith(data, record, value) - realAvailableWith(data, record, record.current_balance))
  const isCard = target.kind === 'card'
  const cardMsi = isCard ? (msiPendingByCard(data.transactions, [record as CreditCard], new Date())[record.uuid] ?? 0) : 0
  const savingsAccount = !isCard && !isLiquid(record as Account) ? (record as Account) : null
  const held = savingsAccount ? bucketsInAccount(savingsAccount.uuid, data.buckets, data.bucketMoves) : []
  const splitting = held.length > 0 && gap !== null && gap !== 0
  const suggested = splitting ? proportionalSplit(gap, held.map((row) => ({ id: row.bucket.uuid, weight: row.balance }))) : {}
  const lineText = (id: string) => (lines ? (lines[id] ?? '') : String(suggested[id] ?? 0))
  const lineValue = (id: string) => (lines ? parseAmount(lines[id] || '0') : (suggested[id] ?? 0))
  const assigned = roundMoney(held.reduce((sum, row) => sum + (lineValue(row.bucket.uuid) ?? 0), 0))
  const leftover = gap === null ? 0 : roundMoney(gap - assigned)
  const unassigned = savingsAccount ? unassignedIn(savingsAccount, data.buckets, data.bucketMoves) : 0
  const unassignedAfter = roundMoney(unassigned + leftover)

  function editLine(id: string, text: string) {
    const current = Object.fromEntries(held.map((row) => [row.bucket.uuid, lineText(row.bucket.uuid)]))
    setLines({ ...current, [id]: text })
    setError(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (value === null || !record) return setError('Escribe el saldo que ves en tu banco o en tu cartera.')
    if (splitting) {
      if (held.some((row) => lineValue(row.bucket.uuid) === null)) return setError('Revisa el monto de cada apartado.')
      const below = held.find((row) => row.balance + (lineValue(row.bucket.uuid) ?? 0) < 0)
      if (below) return setError(`${below.bucket.name} tiene ${money(below.balance)}. No puede quedar abajo de cero.`)
      if (unassignedAfter < 0 && unassignedAfter < unassigned) return setError(`Tus apartados sumarían más que el saldo de ${record.name}.`)
    }
    setSaving(true)
    try {
      if (splitting && savingsAccount) {
        await updateSavingsBalance(
          savingsAccount,
          value,
          held.map((row) => ({ bucket: row.bucket, amount: lineValue(row.bucket.uuid) ?? 0 })),
        )
      } else if (gap !== 0) {
        await reconcileBalance(target.kind === 'account' ? { account: record as Account } : { card: record as CreditCard }, value)
      }
      await onSaved?.()
      onDone()
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <AmountField
        label={isCard ? '¿Cuánto debes de verdad? (MXN)' : savingsAccount ? `¿Cuánto hay hoy en ${record.name}? (MXN)` : '¿Cuánto hay de verdad? (MXN)'}
        value={actual}
        onChange={(v) => { setActual(v); setLines(null); setError(null) }}
        invalid={error !== null}
        autoFocus
      />
      <div className="stat-list">
        <div className="readout">
          <span className="dim">Calculado</span>
          <span className="mono">{money(record.current_balance)}</span>
        </div>
        <div className="readout">
          <span className="dim">Real</span>
          <span className="mono">{value === null ? '—' : money(value)}</span>
        </div>
        <div className="dossier-total">
          <span>{savingsAccount && gap ? (gap > 0 ? 'Rendimientos' : 'Ajuste') : 'Diferencia'}</span>
          <span className={`mono${gap ? ' text-amber' : ''}`}>{gap === null ? '—' : `${gap > 0 && savingsAccount ? '+' : ''}${money(gap)}`}</span>
        </div>
        {gap !== null && gap !== 0 && (
          <div className="readout">
            <span className="dim">Cambio en Disponible real</span>
            <span className="mono">{impact === 0 ? 'Sin cambio' : `${impact > 0 ? '+' : ''}${money(impact)}`}</span>
          </div>
        )}
      </div>
      {splitting && (
        <>
          {held.map((row) => (
            <AmountField
              key={row.bucket.uuid}
              label={`${row.bucket.name} · tiene ${money(row.balance)} (MXN)`}
              value={lineText(row.bucket.uuid)}
              onChange={(v) => editLine(row.bucket.uuid, v)}
            />
          ))}
          <div className="stat-list">
            <div className="readout">
              <span className="dim">Sin apartar</span>
              <span className="mono">{`${leftover > 0 ? '+' : ''}${money(leftover)}`}</span>
            </div>
            <div className="readout">
              <span className="dim">{`Sin apartar en ${record.name} después`}</span>
              <span className={`mono${unassignedAfter < 0 ? ' text-amber' : ''}`}>{money(unassignedAfter)}</span>
            </div>
          </div>
          <div className="verb-row">
            <button type="button" className="verb-button" onClick={() => setLines(null)}>
              Repartir por saldo
            </button>
            <button type="button" className="verb-button" onClick={() => setLines(Object.fromEntries(held.map((row) => [row.bucket.uuid, '0'])))}>
              Todo a Sin apartar
            </button>
          </div>
        </>
      )}
      {isCard && cardMsi > 0 && (
        <FieldNote>Escribe la deuda total, con los {money(cardMsi)} a meses que aún no llegan a tu estado de cuenta.</FieldNote>
      )}
      <FieldNote>
        {gap === 0
          ? 'Todo cuadra. No hace falta ajustar.'
          : splitting
            ? 'La diferencia se reparte en tus apartados. Lo que no asignes queda sin apartar. Se registra como un ajuste que puedes eliminar después.'
            : 'La diferencia se registra como un ajuste en Movimientos. Puedes eliminarlo después.'}
      </FieldNote>
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel={gap === 0 ? 'Listo' : 'Registrar ajuste'} saving={saving} onCancel={onDone} />
    </form>
  )
}

function CoverForm({ data, account, onDone }: { data: MoneyData; account: Account; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const held = roundMoney(bucketsInAccount(account.uuid, data.buckets, data.bucketMoves).reduce((sum, row) => sum + row.balance, 0))
  const gap = roundMoney(held - account.current_balance)
  const impact = roundMoney(realAvailableWith(data, account, held) - realAvailableWith(data, account, account.current_balance))

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      await reconcileBalance({ account }, held)
      onDone()
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <div className="stat-list">
        <div className="readout">
          <span className="dim">{`Saldo de ${account.name}`}</span>
          <span className="mono">{money(account.current_balance)}</span>
        </div>
        <div className="readout">
          <span className="dim">Suma de tus apartados</span>
          <span className="mono">{money(held)}</span>
        </div>
        <div className="dossier-total">
          <span>Ajuste</span>
          <span className="mono text-amber">{`+${money(gap)}`}</span>
        </div>
        <div className="readout">
          <span className="dim">Cambio en Disponible real</span>
          <span className="mono">{impact === 0 ? 'Sin cambio' : `${impact > 0 ? '+' : ''}${money(impact)}`}</span>
        </div>
      </div>
      <FieldNote>{`${account.name} queda en ${money(held)}, lo que suman tus apartados. Tus otras cuentas no cambian. Se registra como un ajuste que puedes eliminar después.`}</FieldNote>
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel="Registrar ajuste" saving={saving} onCancel={onDone} />
    </form>
  )
}

function Dossier({ data, selection, onClose }: { data: MoneyData; selection: Selection; onClose: () => void }) {
  const [mode, setMode] = useState<DossierMode>('view')
  const [error, setError] = useState<string | null>(null)
  const account = selection.kind === 'account' ? data.accounts.find((a) => a.uuid === selection.uuid) : undefined
  const card = selection.kind === 'card' ? data.cards.find((c) => c.uuid === selection.uuid) : undefined
  const record = account ?? card
  if (!record) return null

  const isOpening = account?.type === 'unassigned'
  const isSavings = account !== undefined && !isLiquid(account)
  const held = account && isSavings ? bucketsInAccount(account.uuid, data.buckets, data.bucketMoves) : []
  const unassigned = account && held.length > 0 ? unassignedIn(account, data.buckets, data.bucketMoves) : 0
  const scale = Math.max(1, account?.current_balance ?? 0, ...held.map((row) => row.balance))
  const movements = data.transactions.filter((tx) =>
    card ? tx.cc_id === card.uuid : tx.account_id === record.uuid || tx.to_account_id === record.uuid,
  ).length
  const lastAdjustment = data.transactions
    .filter((tx) => tx.type === 'adjustment' && (card ? tx.cc_id === card.uuid : tx.account_id === record.uuid))
    .sort((a, b) => b.date.localeCompare(a.date))[0]
  const now = new Date()
  const msiPending = card ? (msiPendingByCard(data.transactions, [card], now)[card.uuid] ?? 0) : 0
  const payment = card ? nextPayment(card, data.transactions, now) : null
  const msiRows = card
    ? msiPlans(data.transactions, card)
        .map((tx) => {
          const charges = msiSchedule(msiPurchase(tx), card.statement_day)
          const posted = msiPostedCount(charges, now)
          return { tx, charges, posted, concept: categoryLabel(tx.category_id, data.categories) ?? (tx.notes || 'Compra') }
        })
        .filter((row) => row.posted < row.charges.length)
        .sort((a, b) => a.tx.date.localeCompare(b.tx.date))
    : []

  async function toggleArchive() {
    if (!record) return
    if (!record.archived && held.length > 0) {
      return setError('Hay apartados en esta cuenta. Cambia su Dónde está en Ahorro antes de archivarla.')
    }
    if (!record.archived && !canArchive(record)) {
      return setError(card ? 'Liquida la deuda o ajústala a 0 antes de archivar.' : 'Deja el saldo en 0 antes de archivar: transfiérelo o ajústalo.')
    }
    try {
      if (account) await setAccountArchived(account, !account.archived)
      if (card) await setCardArchived(card, !card.archived)
      onClose()
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
    }
  }

  return (
    <Panel
      title={record.name}
      aside={
        <button type="button" className="panel-verb" onClick={onClose}>
          Cerrar
        </button>
      }
    >
      {mode === 'edit' && account && <AccountForm account={account} data={data} onDone={() => setMode('view')} />}
      {mode === 'edit' && card && <CardForm card={card} onDone={() => setMode('view')} />}
      {mode === 'reconcile' && <ReconcileForm data={data} target={selection} onDone={() => setMode('view')} />}
      {mode === 'cover' && account && <CoverForm data={data} account={account} onDone={() => setMode('view')} />}
      {mode === 'view' && (
        <>
          <div className="stat-list">
            <div className="readout">
              <span className="dim">{card ? 'Deuda' : 'Saldo'}</span>
              <span className="mono">{money(record.current_balance)}</span>
            </div>
            {card && msiPending > 0 && (
              <>
                <div className="readout">
                  <span className="dim">A meses por cobrar</span>
                  <span className="mono">{money(msiPending)}</span>
                </div>
                <div className="readout">
                  <span className="dim">Pago sin meses por cobrar</span>
                  <span className="mono">{money(payableBalance(card, { [card.uuid]: msiPending }))}</span>
                </div>
              </>
            )}
            {payment && card && card.payment_strategy !== 'full' && payment.amount + payment.rest > 0 && (
              <>
                {card.payment_strategy === 'minimum' && payment.minimum !== null && (
                  <div className="readout">
                    <span className="dim">Saldo al corte</span>
                    <span className="mono">{money(payment.statement)}</span>
                  </div>
                )}
                <div className="readout">
                  <span className="dim">{`Próximo pago (${paymentLabel(card, payment)}) · ${formatDate(payment.due)}`}</span>
                  <span className="mono">{money(payment.amount)}</span>
                </div>
                {payment.rest > 0 && (
                  <div className="readout">
                    <span className="dim">Pasa al siguiente corte</span>
                    <span className="mono">{money(payment.rest)}</span>
                  </div>
                )}
              </>
            )}
            <div className="readout">
              <span className="dim">Tipo</span>
              <span>{account ? ACCOUNT_TYPE_LABEL[account.type] : `TDC · ${STRATEGY_LABEL[card!.payment_strategy]}`}</span>
            </div>
            <div className="readout">
              <span className="dim">Movimientos</span>
              <span className="mono">{movements}</span>
            </div>
            <div className="readout">
              <span className="dim">Último ajuste</span>
              <span className="mono">{lastAdjustment ? formatDate(isoToDate(lastAdjustment.date)) : '—'}</span>
            </div>
          </div>
          {held.length > 0 && (
            <div className="stat-list">
              {held.map((row) => (
                <StatBar key={row.bucket.uuid} label={row.bucket.name} value={money(row.balance)} ratio={row.balance / scale} />
              ))}
              <StatBar label="Sin apartar" value={money(unassigned)} ratio={unassigned / scale} tone={unassigned < 0 ? 'tight' : 'safe'} />
            </div>
          )}
          {unassigned < 0 && account && (
            <>
              <FieldNote>{`Tus apartados suman ${money(-unassigned)} más que el saldo de ${account.name}.`}</FieldNote>
              <div className="verb-row">
                <button type="button" className="verb-button" onClick={() => setMode('cover')}>
                  {`Ajustar ${account.name} a tus apartados`}
                </button>
              </div>
            </>
          )}
          {msiRows.length > 0 && (
            <div className="roster-fit">
            <table className="roster roster-stack">
              <thead>
                <tr>
                  <th scope="col">Meses sin intereses</th>
                  <th scope="col" className="num">Mensualidad</th>
                  <th scope="col">Última</th>
                </tr>
              </thead>
              <tbody>
                {msiRows.map((row) => (
                  <tr key={row.tx.uuid}>
                    <td className="roster-title">
                      {row.concept}
                      <span className="row-sub">{`${row.posted} de ${row.charges.length} · ${money(row.tx.amount)}`}</span>
                    </td>
                    <td className="num mono" data-label="Mensualidad">{money(row.charges[0].amount)}</td>
                    <td className="mono dim" data-label="Última">{formatDate(row.charges[row.charges.length - 1].date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
          <div className="verb-row">
            {!record.archived && (
              <button type="button" className="verb-button verb-primary" onClick={() => setMode('reconcile')}>
                <span className="key-glyph">A</span>
                {isSavings ? 'Actualizar saldo' : 'Ajustar saldo'}
              </button>
            )}
            {!record.archived && !isOpening && (
              <button type="button" className="verb-button" onClick={() => setMode('edit')}>
                <span className="key-glyph">E</span>
                Editar
              </button>
            )}
            {!isOpening && (
              <button type="button" className="verb-button" onClick={toggleArchive}>
                <span className="key-glyph">X</span>
                {record.archived ? 'Restaurar' : 'Archivar'}
              </button>
            )}
          </div>
          {error && <FieldError>{error}</FieldError>}
          <FooterHint>
            {record.archived
              ? 'Archivada: no aparece al registrar, pero su historial se queda.'
              : isOpening
                ? 'El saldo sin origen se ajusta desde Inicio o se transfiere a una cuenta.'
                : isSavings
                  ? 'Actualiza el saldo cuando veas tu estado de cuenta. Los rendimientos se reparten en tus apartados.'
                  : 'Ajusta cuando tu banco o tu cartera no coincida con la app.'}
          </FooterHint>
        </>
      )}
    </Panel>
  )
}

export function Cuentas() {
  const data = useMoneyData()
  const [adding, setAdding] = useState<'account' | 'card' | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const dossierRef = useDossierSheet(selection ? `${selection.kind}-${selection.uuid}` : null, () => setSelection(null))
  if (!data.loaded) return null

  const accounts = data.accounts
    .filter((a) => !a.archived)
    .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
  const cards = data.cards.filter((c) => !c.archived)
  const msiPending = msiPendingByCard(data.transactions, cards, new Date())
  const payments = nextPayments(cards, data.transactions, new Date())
  const splitsPayment = cards.some((card) => card.payment_strategy !== 'full')
  const archived: { selection: Selection; name: string; label: string; balance: number }[] = [
    ...data.accounts
      .filter((a) => a.archived)
      .map((a) => ({ selection: { kind: 'account', uuid: a.uuid } as Selection, name: a.name, label: ACCOUNT_TYPE_LABEL[a.type], balance: a.current_balance })),
    ...data.cards
      .filter((c) => c.archived)
      .map((c) => ({ selection: { kind: 'card', uuid: c.uuid } as Selection, name: c.name, label: 'TDC', balance: c.current_balance })),
  ]
  const bank = accounts.filter((a) => a.type === 'checking').reduce((sum, a) => sum + a.current_balance, 0)
  const isSelected = (kind: Selection['kind'], uuid: string) => selection?.kind === kind && selection.uuid === uuid
  const toggle = (next: Selection) => setSelection(isSelected(next.kind, next.uuid) ? null : next)

  return (
    <div className={`stage-grid${selection ? '' : ' stage-grid--single'}`}>
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
                  <tr
                    key={account.uuid}
                    className="roster-row"
                    tabIndex={0}
                    aria-selected={isSelected('account', account.uuid)}
                    onClick={() => toggle({ kind: 'account', uuid: account.uuid })}
                  >
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
          {cards.length === 0 ? (
            <FooterHint>Aún no hay tarjetas.</FooterHint>
          ) : (
            <div className="roster-fit">
              <div className="card-roster-head" aria-hidden="true">
                <span>Tarjeta</span>
                <span className="num">Deuda</span>
                <span className="num">Crédito disp.</span>
                <span>Pago</span>
                <span className="num">Banco tras pago</span>
              </div>
              <ul className="card-roster">
                {cards.map((card) => {
                  const payment = payments[card.uuid]
                  const after = roundMoney(bank - payment.amount)
                  const selected = isSelected('card', card.uuid)
                  return (
                    <li key={card.uuid}>
                      <button
                        type="button"
                        className="roster-row card-roster-row"
                        aria-pressed={selected}
                        onClick={() => toggle({ kind: 'card', uuid: card.uuid })}
                      >
                        <span data-field="name">
                          <span className="card-name">{card.name}</span>
                          <span className="row-sub">
                            Corte día {card.statement_day} · {STRATEGY_LABEL[card.payment_strategy]}
                            {msiPending[card.uuid] ? ` · ${money(msiPending[card.uuid])} a meses` : ''}
                            {card.payment_strategy !== 'full' && payment.rest > 0 ? ` · ${money(payment.rest)} al siguiente corte` : ''}
                          </span>
                        </span>
                        <span data-field="debt" className="num mono">
                          <span className="cell-label">Deuda</span>
                          {money(card.current_balance)}
                        </span>
                        <span data-field="credit" className="num mono">
                          <span className="cell-label">Crédito disp.</span>
                          {money(card.limit - card.current_balance)}
                        </span>
                        <span data-field="due" className="mono">
                          <span className="cell-label">Pago</span>
                          {formatDate(payment.due)}
                        </span>
                        <span data-field="after" className={`num mono${after < 0 ? ' text-heat' : ''}`}>
                          <span className="cell-label">Banco tras pago</span>
                          {money(after)}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
          {cards.length > 0 && (
            <FooterHint>
              {Object.keys(msiPending).length > 0
                ? 'Banco tras pago: cuánto queda en tu banco si pagas el total, sin las mensualidades que aún no llegan.'
                : 'Banco tras pago: cuánto queda en tu banco si pagas el total.'}
              {splitsPayment ? ' Con saldo al corte o pago mínimo, si pagas lo que vence.' : ''}
            </FooterHint>
          )}
        </Panel>

        {archived.length > 0 && (
          <Panel title="Archivadas">
            <table className="roster">
              <tbody>
                {archived.map((row) => (
                  <tr
                    key={row.selection.uuid}
                    className="roster-row dim"
                    tabIndex={0}
                    aria-selected={isSelected(row.selection.kind, row.selection.uuid)}
                    onClick={() => toggle(row.selection)}
                  >
                    <td>{row.name}</td>
                    <td className="dim">{row.label}</td>
                    <td className={`num mono${row.balance !== 0 ? ' text-amber' : ''}`}>{money(row.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
      </div>

      {selection && (
        <aside ref={dossierRef} className="dossier dossier-sheet" tabIndex={-1} aria-label="Detalle">
          <Dossier key={`${selection.kind}-${selection.uuid}`} data={data} selection={selection} onClose={() => setSelection(null)} />
        </aside>
      )}
    </div>
  )
}
