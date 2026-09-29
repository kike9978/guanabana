import { useState, type FormEvent } from 'react'
import { AmountField, ChoiceField, FieldError, FieldNote, FormActions, TextField } from '../components/fields'
import { FooterHint, Panel } from '../components/hud'
import { StageHeader } from '../components/StageHeader'
import {
  ACCOUNT_TYPE_LABEL,
  STRATEGY_LABEL,
  canArchive,
  createAccount,
  createCard,
  reconcileBalance,
  setAccountArchived,
  setCardArchived,
  updateAccount,
  updateCard,
} from '../db/accounts'
import type { Account, AccountType, CreditCard, PaymentStrategy } from '../db/types'
import { useMoneyData, type MoneyData } from '../db/useMoneyData'
import { formatDate, formatMoney } from '../lib/format'
import { isoToDate, nextDateForDay } from '../lib/dates'
import { roundMoney } from '../lib/money'
import { parseAmount, parseDay } from '../lib/parseAmount'
import { computeRealAvailable } from '../lib/realAvailable'

type NewAccountType = Exclude<AccountType, 'unassigned'>
export type Selection = { kind: 'account'; uuid: string } | { kind: 'card'; uuid: string }
type DossierMode = 'view' | 'edit' | 'reconcile'

const ACCOUNT_TYPES: { value: NewAccountType; label: string }[] = [
  { value: 'checking', label: 'Banco' },
  { value: 'cash', label: 'Efectivo' },
  { value: 'savings', label: 'Ahorro' },
]

const LIQUID_TYPES = ACCOUNT_TYPES.filter((option) => option.value !== 'savings')

const STRATEGIES = (Object.keys(STRATEGY_LABEL) as PaymentStrategy[]).map((value) => ({ value, label: STRATEGY_LABEL[value] }))

const money = (value: number) => formatMoney(value, 'MXN')

function AccountForm({ account, onDone }: { account?: Account; onDone: () => void }) {
  const [type, setType] = useState<NewAccountType>(account && account.type !== 'unassigned' ? account.type : 'checking')
  const [name, setName] = useState(account?.name ?? '')
  const [balance, setBalance] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const typeOptions = account ? (account.type === 'savings' ? [] : LIQUID_TYPES) : ACCOUNT_TYPES

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
        type === 'savings' && <FieldNote>Una cuenta de ahorro no cuenta en tu Disponible real.</FieldNote>
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
      const fields = { name: name.trim(), limit: limitValue, statement_day: statement, due_day: due, payment_strategy: strategy }
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
      <FieldNote>
        {card ? 'La deuda se cambia con Ajustar saldo, para que quede registrada.' : 'Con pago total, toda la deuda se aparta de tu Disponible real.'}
      </FieldNote>
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel={card ? 'Guardar cambios' : 'Guardar tarjeta'} saving={saving} onCancel={onDone} />
    </form>
  )
}

function realAvailableWith(data: MoneyData, target: Account | CreditCard, balance: number): number {
  const swap = <T extends { uuid: string; current_balance: number }>(records: T[]) =>
    records.map((record) => (record.uuid === target.uuid ? { ...record, current_balance: balance } : record))
  return computeRealAvailable({ accounts: swap(data.accounts), cards: swap(data.cards), buffer: 0 }).total
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
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  if (!record) return null

  const value = parseAmount(actual)
  const gap = value === null ? null : roundMoney(value - record.current_balance)
  const impact = value === null ? 0 : roundMoney(realAvailableWith(data, record, value) - realAvailableWith(data, record, record.current_balance))
  const isCard = target.kind === 'card'

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (value === null || !record) return setError('Escribe el saldo que ves en tu banco o en tu cartera.')
    setSaving(true)
    try {
      if (gap !== 0) await reconcileBalance(target.kind === 'account' ? { account: record as Account } : { card: record as CreditCard }, value)
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
        label={isCard ? '¿Cuánto debes de verdad? (MXN)' : '¿Cuánto hay de verdad? (MXN)'}
        value={actual}
        onChange={(v) => { setActual(v); setError(null) }}
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
          <span>Diferencia</span>
          <span className={`mono${gap ? ' text-amber' : ''}`}>{gap === null ? '—' : money(gap)}</span>
        </div>
        {gap !== null && gap !== 0 && (
          <div className="readout">
            <span className="dim">Cambio en Disponible real</span>
            <span className="mono">{impact === 0 ? 'Sin cambio' : `${impact > 0 ? '+' : ''}${money(impact)}`}</span>
          </div>
        )}
      </div>
      <FieldNote>
        {gap === 0 ? 'Todo cuadra. No hace falta ajustar.' : 'La diferencia se registra como un ajuste en Movimientos. Puedes eliminarlo después.'}
      </FieldNote>
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel={gap === 0 ? 'Listo' : 'Registrar ajuste'} saving={saving} onCancel={onDone} />
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
  const movements = data.transactions.filter((tx) =>
    card ? tx.cc_id === card.uuid : tx.account_id === record.uuid || tx.to_account_id === record.uuid,
  ).length
  const lastAdjustment = data.transactions
    .filter((tx) => tx.type === 'adjustment' && (card ? tx.cc_id === card.uuid : tx.account_id === record.uuid))
    .sort((a, b) => b.date.localeCompare(a.date))[0]

  async function toggleArchive() {
    if (!record) return
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
      {mode === 'edit' && account && <AccountForm account={account} onDone={() => setMode('view')} />}
      {mode === 'edit' && card && <CardForm card={card} onDone={() => setMode('view')} />}
      {mode === 'reconcile' && <ReconcileForm data={data} target={selection} onDone={() => setMode('view')} />}
      {mode === 'view' && (
        <>
          <div className="stat-list">
            <div className="readout">
              <span className="dim">{card ? 'Deuda' : 'Saldo'}</span>
              <span className="mono">{money(record.current_balance)}</span>
            </div>
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
          <div className="verb-row">
            {!record.archived && (
              <button type="button" className="verb-button verb-primary" onClick={() => setMode('reconcile')}>
                <span className="key-glyph">A</span>
                Ajustar saldo
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
  if (!data.loaded) return null

  const accounts = data.accounts
    .filter((a) => !a.archived)
    .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
  const cards = data.cards.filter((c) => !c.archived)
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
                {cards.map((card) => {
                  const after = roundMoney(bank - card.current_balance)
                  return (
                    <tr
                      key={card.uuid}
                      className="roster-row"
                      tabIndex={0}
                      aria-selected={isSelected('card', card.uuid)}
                      onClick={() => toggle({ kind: 'card', uuid: card.uuid })}
                    >
                      <td>
                        {card.name}
                        <span className="row-sub">
                          Corte día {card.statement_day} · {STRATEGY_LABEL[card.payment_strategy]}
                        </span>
                      </td>
                      <td className="num mono">{money(card.current_balance)}</td>
                      <td className="num mono">{money(card.limit - card.current_balance)}</td>
                      <td className="mono">{formatDate(nextDateForDay(card.due_day, new Date()))}</td>
                      <td className={`num mono${after < 0 ? ' text-heat' : ''}`}>{money(after)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {cards.length > 0 && <FooterHint>Banco tras pago: cuánto queda en tu banco si pagas el total.</FooterHint>}
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
        <aside className="dossier" aria-label="Detalle">
          <Dossier key={`${selection.kind}-${selection.uuid}`} data={data} selection={selection} onClose={() => setSelection(null)} />
        </aside>
      )}
    </div>
  )
}
