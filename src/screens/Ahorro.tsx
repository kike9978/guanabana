import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { AddPrefill, AddType, SubScreen } from '../app/navigation'
import { AmountField, ChoiceField, FieldError, FieldNote, FormActions, SelectField, TextField } from '../components/fields'
import { FooterHint, GradeCard, Panel, StatBar } from '../components/hud'
import { StageHeader } from '../components/StageHeader'
import { ACCOUNT_TYPE_LABEL, isLiquid, selectable } from '../db/accounts'
import {
  BUCKET_SOURCE_LABEL,
  assignUnassigned,
  createBucket,
  depositToBucket,
  fijarSaldo,
  fijarSaldoInAccount,
  fundFromBucket,
  isSystemBucket,
  moveToBucket,
  recognizeOpening,
  setBucketArchived,
  swapBucketOrder,
  transferBetweenBuckets,
  undoOpeningWithdrawal,
  updateBucket,
  withdrawFromBucket,
} from '../db/buckets'
import type { Account, IncomeShare, SavingsBucket } from '../db/types'
import { useMoneyData, type MoneyData } from '../db/useMoneyData'
import {
  bucketBalance,
  bucketHistory,
  fijarGap,
  fijarInAccountSplit,
  homeAccount,
  isHeldInLiquid,
  openingBalance,
  reservedBalance,
  setAsideThisCycle,
  targetPace,
  unassignedIn,
  withdrawSplit,
} from '../lib/buckets'
import { isoToDate } from '../lib/dates'
import { pickValid } from '../lib/forms'
import { incomeRank, isRuleIncome, RULE_LABEL, ruleApplied, ruleMoves } from '../lib/incomeRules'
import { formatAmount, formatDate, formatMoney } from '../lib/format'
import { roundMoney } from '../lib/money'
import { parseAmount } from '../lib/parseAmount'
import { moneySnapshot } from '../lib/snapshot'

type Mode = 'view' | 'add' | 'withdraw' | 'transfer' | 'setup' | 'fijar' | 'recognize'

const NEW_BUCKET = 'new'

type ShareChoice = IncomeShare['income'] | 'none'

const SHARE_OPTIONS: { value: ShareChoice; label: string }[] = [
  { value: 'none', label: 'Nada' },
  { value: 'first', label: '1er ingreso' },
  { value: 'second', label: '2º ingreso' },
  { value: 'both', label: 'Ambos' },
]

const money = (value: number) => formatMoney(value, 'MXN')

function Change({ label, before, after, total = false }: { label: string; before: number; after: number; total?: boolean }) {
  return (
    <div className={total ? 'dossier-total' : 'readout'}>
      <span className={total ? undefined : 'dim'}>{label}</span>
      <span className={`mono${after < 0 ? ' text-heat' : ''}`}>{before === after ? money(after) : `${money(before)} → ${money(after)}`}</span>
    </div>
  )
}

function MoveForm({ bucket, data, direction, onDone }: { bucket: SavingsBucket; data: MoneyData; direction: 1 | -1; onDone: () => void }) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const balance = bucketBalance(bucket, data.bucketMoves)
  const reserved = reservedBalance(bucket, data.bucketMoves)
  const liquid = isHeldInLiquid(bucket, data.accounts)
  const available = moneySnapshot(data, new Date()).breakdown.total
  const value = parseAmount(amount)
  const adding = direction === 1
  const split = !adding && value !== null ? withdrawSplit(reserved, value) : null
  const released = split && liquid ? split.fromReserved : 0
  const after = value === null ? available : adding && liquid ? roundMoney(available - value) : roundMoney(available + released)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (value === null || value <= 0) return setError('Escribe un monto mayor a cero.')
    if (!adding && value > balance) return setError(`El apartado tiene ${money(balance)}.`)
    if (!adding && !reason.trim()) return setError('Escribe para qué lo usas. Queda en el historial.')
    setSaving(true)
    try {
      if (adding) await moveToBucket(bucket, { amount: value, reason: reason.trim() || 'Apartado manual' })
      else if (split) await withdrawFromBucket(bucket, { ...split, reason: reason.trim() })
      onDone()
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <AmountField label={adding ? 'Apartar (MXN)' : 'Retirar (MXN)'} value={amount} onChange={(v) => { setAmount(v); setError(null) }} invalid={error !== null} autoFocus />
      <TextField label={adding ? 'Nota' : 'Motivo'} value={reason} onChange={setReason} placeholder={adding ? 'Opcional' : 'Ej. Reparación del auto'} />
      <div className="stat-list">
        <div className="readout">
          <span className="dim">Disponible real ahora</span>
          <span className="mono">{money(available)}</span>
        </div>
        <div className="dossier-total">
          <span>Disponible real después</span>
          <span className={`mono${after < 0 ? ' text-heat' : ''}`}>{money(after)}</span>
        </div>
      </div>
      <FieldNote>
        {!liquid
          ? 'Este apartado está en una cuenta de ahorro, así que no cambia tu Disponible real.'
          : adding
            ? 'Apartar no mueve dinero de tu banco. Lo reserva para este fin. Si guardas este dinero en otra cuenta, cámbialo en Editar → Dónde está.'
            : split && split.fromOpening > 0 && split.fromReserved === 0
              ? 'Este dinero no está en tus cuentas. Retirarlo no cambia tu Disponible real.'
              : split && split.fromOpening > 0
                ? `${money(split.fromReserved)} sale de lo reservado y libera Disponible real. ${money(split.fromOpening)} no estaba en tus cuentas y no lo cambia.`
                : 'Retirar libera el dinero para gastarlo. Tu banco no cambia.'}
      </FieldNote>
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel={adding ? 'Apartar' : 'Retirar'} saving={saving} onCancel={onDone} />
    </form>
  )
}

function BucketForm({
  bucket,
  data,
  onDone,
  onCreated,
}: {
  bucket?: SavingsBucket
  data: MoneyData
  onDone: () => void
  onCreated?: (bucket: SavingsBucket) => void
}) {
  const [name, setName] = useState(bucket?.name ?? '')
  const [target, setTarget] = useState(bucket?.target == null ? '' : String(bucket.target))
  const [targetDate, setTargetDate] = useState(bucket?.target_date ?? '')
  const [accountId, setAccountId] = useState(bucket?.account_id ?? '')
  const [shareIncome, setShareIncome] = useState<ShareChoice>(bucket?.income_share?.income ?? 'none')
  const [shareAmount, setShareAmount] = useState(bucket?.income_share ? String(bucket.income_share.amount) : '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const custom = !bucket || !isSystemBucket(bucket)
  const options = [
    { value: '', label: 'Banco o efectivo' },
    ...selectable(data.accounts, [bucket?.account_id])
      .filter((a) => !isLiquid(a))
      .map((a) => ({ value: a.uuid, label: `${a.name} · ${ACCOUNT_TYPE_LABEL[a.type]}` })),
  ]
  const balance = bucket ? bucketBalance(bucket, data.bucketMoves) : 0
  const liquidNow = bucket ? isHeldInLiquid(bucket, data.accounts) : true
  const liquidAfter = isHeldInLiquid({ account_id: accountId || null }, data.accounts)
  const impact = liquidNow === liquidAfter ? 0 : liquidAfter ? -balance : balance

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    const value = target.trim() === '' ? null : parseAmount(target)
    if (!trimmed) return setError('Ponle un nombre al apartado.')
    const duplicate = data.buckets.some((b) => b.uuid !== bucket?.uuid && !b.archived && b.name.trim().toLowerCase() === trimmed.toLowerCase())
    if (duplicate) return setError('Ya tienes un apartado con ese nombre.')
    if (target.trim() !== '' && (value === null || value < 0)) return setError('Revisa la meta.')
    if (targetDate && !value) return setError('Para usar una fecha, escribe también la meta.')
    const share = shareIncome === 'none' ? null : parseAmount(shareAmount)
    if (custom && shareIncome !== 'none' && (share === null || share <= 0)) return setError('Escribe cuánto apartar con cada ingreso.')
    const fields = {
      name: trimmed,
      target: value,
      target_date: targetDate || null,
      account_id: accountId || null,
      income_share: custom && shareIncome !== 'none' && share ? { income: shareIncome, amount: share } : null,
    }
    setSaving(true)
    try {
      if (bucket) {
        await updateBucket(bucket, fields)
        onDone()
      } else {
        onCreated?.(await createBucket(data.buckets, fields))
      }
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <TextField label="Nombre" value={name} onChange={(v) => { setName(v); setError(null) }} placeholder="Ej. Auto, Regalos, Predial" autoFocus={!bucket} />
      <div className="field-row">
        <AmountField label="Meta (MXN, opcional)" value={target} onChange={(v) => { setTarget(v); setError(null) }} autoFocus={Boolean(bucket)} />
        <TextField label="Para cuándo (opcional)" type="date" value={targetDate} onChange={(v) => { setTargetDate(v); setError(null) }} mono />
      </div>
      <SelectField label="Dónde está el dinero" value={accountId} onChange={setAccountId} options={options} />
      {impact !== 0 && (
        <div className="readout">
          <span className="dim">Cambio en Disponible real</span>
          <span className="mono">{`${impact > 0 ? '+' : ''}${money(impact)}`}</span>
        </div>
      )}
      {balance > 0 && accountId && accountId !== (bucket?.account_id ?? '') && (
        <FieldNote>{`Cambiar dónde está no transfiere dinero. Si estos ${money(balance)} ya están en esa cuenta, revisa su saldo en Cuentas.`}</FieldNote>
      )}
      <FieldNote>
        {options.length === 1
          ? 'En banco o efectivo, el apartado se descuenta de tu Disponible real. Si lo guardas en una cuenta de ahorro, agrégala en Cuentas.'
          : 'En banco o efectivo, el apartado se descuenta de tu Disponible real. En una cuenta de ahorro ya está fuera.'}
      </FieldNote>
      {custom && (
        <>
          <ChoiceField label="Con cada ingreso" value={shareIncome} onChange={(v) => { setShareIncome(v); setError(null) }} options={SHARE_OPTIONS} />
          {shareIncome !== 'none' && (
            <AmountField label="Monto sugerido por ingreso (MXN)" value={shareAmount} onChange={(v) => { setShareAmount(v); setError(null) }} />
          )}
          {shareIncome !== 'none' && (
            <FieldNote>Aparece en la regla de ese ingreso como sugerencia. Nada se aparta hasta que confirmas la regla.</FieldNote>
          )}
        </>
      )}
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel={bucket ? 'Guardar' : 'Crear apartado'} saving={saving} onCancel={onDone} />
    </form>
  )
}

function TransferForm({ bucket, data, onDone }: { bucket: SavingsBucket; data: MoneyData; onDone: () => void }) {
  const others = data.buckets.filter((b) => b.uuid !== bucket.uuid && !b.archived)
  const [toId, setToId] = useState(others[0]?.uuid ?? '')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const balance = reservedBalance(bucket, data.bucketMoves)
  const opening = openingBalance(bucket.uuid, data.bucketMoves)
  const to = others.find((b) => b.uuid === toId)
  const value = parseAmount(amount)
  const fromLiquid = isHeldInLiquid(bucket, data.accounts)
  const toLiquid = to ? isHeldInLiquid(to, data.accounts) : fromLiquid
  const impact = value === null || fromLiquid === toLiquid ? 0 : toLiquid ? -value : value

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!to) return setError('Elige a qué apartado lo mueves.')
    if (value === null || value <= 0) return setError('Escribe un monto mayor a cero.')
    if (value > balance) return setError(opening > 0 ? `Puedes mover ${money(balance)}. El resto no está en tus cuentas.` : `El apartado tiene ${money(balance)}.`)
    setSaving(true)
    try {
      await transferBetweenBuckets(bucket, to, value, reason.trim() || `De ${bucket.name} a ${to.name}`)
      onDone()
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <SelectField label="A" value={toId} onChange={setToId} options={others.map((b) => ({ value: b.uuid, label: b.name }))} />
      <AmountField label="Monto (MXN)" value={amount} onChange={(v) => { setAmount(v); setError(null) }} invalid={error !== null} autoFocus />
      <TextField label="Nota" value={reason} onChange={setReason} placeholder="Opcional" />
      <div className="readout">
        <span className="dim">Cambio en Disponible real</span>
        <span className="mono">{`${impact > 0 ? '+' : ''}${money(impact)}`}</span>
      </div>
      <FieldNote>
        Mover entre apartados no cambia tu banco. Se guarda como dos movimientos en el historial.
        {opening > 0 ? ` ${money(opening)} no están en tus cuentas; para moverlos, márcalos con Ya está en mi banco.` : ''}
      </FieldNote>
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel="Mover" saving={saving} onCancel={onDone} />
    </form>
  )
}

function FijarInAccountForm({ bucket, home, data, onDone }: { bucket: SavingsBucket; home: Account; data: MoneyData; onDone: () => void }) {
  const balance = bucketBalance(bucket, data.bucketMoves)
  const unassigned = unassignedIn(home, data.buckets, data.bucketMoves)
  const [total, setTotal] = useState(String(balance))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const value = parseAmount(total)
  const gap = value === null ? 0 : roundMoney(value - balance)
  const { fromUnassigned, added } = fijarInAccountSplit(gap, unassigned)
  const unassignedAfter = roundMoney(unassigned - fromUnassigned - Math.min(0, gap))
  const available = moneySnapshot(data, new Date()).breakdown.total

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (value === null || value < 0) return setError('Escribe cuánto hay hoy en este apartado.')
    setSaving(true)
    try {
      await fijarSaldoInAccount(bucket, home, gap, unassigned)
      onDone()
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <AmountField label="¿Cuánto hay hoy en este apartado? (MXN)" value={total} onChange={(v) => { setTotal(v); setError(null) }} invalid={error !== null} autoFocus />
      <div className="stat-list">
        <Change label={bucket.name} before={balance} after={value === null ? balance : value} />
        <Change label={home.name} before={home.current_balance} after={roundMoney(home.current_balance + added)} />
        <Change label={`Sin apartar en ${home.name}`} before={unassigned} after={unassignedAfter} />
        <Change label="Disponible real" before={available} after={available} total />
      </div>
      <FieldNote>
        {gap < 0
          ? `Los ${money(-gap)} que bajas se quedan en ${home.name}, sin apartar. Si ${home.name} tiene menos, actualiza su saldo en Cuentas.`
          : fromUnassigned > 0 && added > 0
            ? `Se toman ${money(fromUnassigned)} que ya estaban en ${home.name} sin apartar, y ${home.name} sube ${money(added)} con un ajuste. Tus otras cuentas y tu Disponible real no cambian.`
            : fromUnassigned > 0
              ? `Estos pesos ya estaban en ${home.name} sin apartar. ${home.name} no cambia, ni tu Disponible real.`
              : `${home.name} sube lo mismo que el apartado, con un ajuste. Tus otras cuentas y tu Disponible real no cambian.`}
      </FieldNote>
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel="Fijar saldo" saving={saving} onCancel={onDone} />
    </form>
  )
}

function DepositForm({ bucket, home, data, onDone }: { bucket: SavingsBucket; home: Account; data: MoneyData; onDone: () => void }) {
  const [amount, setAmount] = useState('')
  const [fromId, setFromId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const unassigned = unassignedIn(home, data.buckets, data.bucketMoves)
  const options = [
    ...selectable(data.accounts)
      .filter((a) => a.uuid !== home.uuid)
      .map((a) => ({ value: a.uuid, label: `${a.name} · ${ACCOUNT_TYPE_LABEL[a.type]} · ${money(a.current_balance)}` })),
    { value: home.uuid, label: `Ya está en ${home.name} · ${money(Math.max(0, unassigned))} sin apartar` },
  ]
  const activeFrom = pickValid(fromId, options)
  const from = data.accounts.find((a) => a.uuid === activeFrom)
  const inPlace = from?.uuid === home.uuid
  const value = parseAmount(amount)
  const moved = value ?? 0
  const balance = bucketBalance(bucket, data.bucketMoves)
  const available = moneySnapshot(data, new Date()).breakdown.total
  const leavesLiquid = Boolean(from && !inPlace && isLiquid(from))
  const shown = value === null ? 'Se transfiere el monto' : `Se transfieren ${money(value)}`

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!from) return setError('Elige de dónde sale el dinero.')
    if (value === null || value <= 0) return setError('Escribe un monto mayor a cero.')
    if (inPlace && value > unassigned) return setError(`En ${home.name} hay ${money(Math.max(0, unassigned))} sin apartar.`)
    setSaving(true)
    try {
      if (inPlace) await assignUnassigned(bucket, home, value)
      else await depositToBucket({ bucket, from, to: home, amount: value, reason: reason.trim() || `Desde ${from.name}` })
      onDone()
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <AmountField label="Depositar (MXN)" value={amount} onChange={(v) => { setAmount(v); setError(null) }} invalid={error !== null} autoFocus />
      {activeFrom && <SelectField label="Desde" value={activeFrom} onChange={(v) => { setFromId(v); setError(null) }} options={options} />}
      <div className="readout">
        <span className="dim">Hacia</span>
        <span>{home.name}</span>
      </div>
      {!inPlace && <TextField label="Nota" value={reason} onChange={setReason} placeholder="Opcional" />}
      <div className="stat-list">
        {from && !inPlace && <Change label={from.name} before={from.current_balance} after={roundMoney(from.current_balance - moved)} />}
        {!inPlace && <Change label={home.name} before={home.current_balance} after={roundMoney(home.current_balance + moved)} />}
        {inPlace && <Change label={`Sin apartar en ${home.name}`} before={unassigned} after={roundMoney(unassigned - moved)} />}
        <Change label={bucket.name} before={balance} after={roundMoney(balance + moved)} />
        <Change label="Disponible real" before={available} after={leavesLiquid ? roundMoney(available - moved) : available} total />
      </div>
      <FieldNote>
        {inPlace
          ? `No se mueve dinero entre cuentas. Estos pesos ya están en ${home.name}; solo quedan apartados para ${bucket.name}.`
          : `${shown} de ${from?.name ?? 'la cuenta'} a ${home.name}, para ${bucket.name}. ${leavesLiquid ? 'Tu Disponible real baja esa cantidad.' : 'Tu Disponible real no cambia.'}`}
      </FieldNote>
      {from && !inPlace && value !== null && value > from.current_balance && (
        <FieldNote>{`${from.name} tiene ${money(from.current_balance)}. Si su saldo no coincide, ajústalo en Cuentas.`}</FieldNote>
      )}
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel="Depositar" saving={saving} onCancel={onDone} />
    </form>
  )
}

function ReleaseForm({ bucket, home, data, onDone }: { bucket: SavingsBucket; home: Account; data: MoneyData; onDone: () => void }) {
  const [amount, setAmount] = useState('')
  const [toId, setToId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const options = [
    ...selectable(data.accounts)
      .filter((a) => a.uuid !== home.uuid && isLiquid(a))
      .map((a) => ({ value: a.uuid, label: `Traer a ${a.name} · ${money(a.current_balance)}` })),
    { value: home.uuid, label: `Se queda en ${home.name}, sin apartar` },
  ]
  const activeTo = pickValid(toId, options)
  const to = data.accounts.find((a) => a.uuid === activeTo)
  const stays = to?.uuid === home.uuid
  const value = parseAmount(amount)
  const moved = value ?? 0
  const balance = bucketBalance(bucket, data.bucketMoves)
  const reserved = reservedBalance(bucket, data.bucketMoves)
  const unassigned = unassignedIn(home, data.buckets, data.bucketMoves)
  const available = moneySnapshot(data, new Date()).breakdown.total
  const shown = value === null ? 'Se transfiere el monto' : `Se transfieren ${money(value)}`

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!to) return setError('Elige a dónde va el dinero.')
    if (value === null || value <= 0) return setError('Escribe un monto mayor a cero.')
    if (value > balance) return setError(`El apartado tiene ${money(balance)}.`)
    if (!reason.trim()) return setError('Escribe para qué lo usas. Queda en el historial.')
    if (!stays && value > home.current_balance) return setError(`En ${home.name} hay ${money(home.current_balance)}. Si no coincide, actualiza su saldo en Cuentas.`)
    setSaving(true)
    try {
      if (stays) await withdrawFromBucket(bucket, { ...withdrawSplit(reserved, value), reason: reason.trim() })
      else await fundFromBucket({ bucket, from: home, to, amount: value, reason: reason.trim() })
      onDone()
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <AmountField label="Retirar (MXN)" value={amount} onChange={(v) => { setAmount(v); setError(null) }} invalid={error !== null} autoFocus />
      {activeTo && <SelectField label="A dónde va" value={activeTo} onChange={(v) => { setToId(v); setError(null) }} options={options} />}
      <TextField label="Motivo" value={reason} onChange={setReason} placeholder="Ej. Vuelo a Oaxaca" />
      <div className="stat-list">
        <Change label={bucket.name} before={balance} after={roundMoney(balance - moved)} />
        {stays && <Change label={`Sin apartar en ${home.name}`} before={unassigned} after={roundMoney(unassigned + moved)} />}
        {to && !stays && <Change label={home.name} before={home.current_balance} after={roundMoney(home.current_balance - moved)} />}
        {to && !stays && <Change label={to.name} before={to.current_balance} after={roundMoney(to.current_balance + moved)} />}
        <Change label="Disponible real" before={available} after={stays ? available : roundMoney(available + moved)} total />
      </div>
      <FieldNote>
        {stays
          ? `El dinero sigue en ${home.name}, sin apartar. Tu Disponible real no cambia.`
          : `${shown} de ${home.name} a ${to?.name ?? 'la cuenta'}. Tu Disponible real sube esa cantidad.`}
      </FieldNote>
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel="Retirar" saving={saving} onCancel={onDone} />
    </form>
  )
}

function FijarForm({ bucket, data, onDone }: { bucket: SavingsBucket; data: MoneyData; onDone: () => void }) {
  const balance = bucketBalance(bucket, data.bucketMoves)
  const reserved = reservedBalance(bucket, data.bucketMoves)
  const [total, setTotal] = useState(String(balance))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const value = parseAmount(total)
  const gap = value === null ? null : fijarGap(balance, reserved, value)
  const available = moneySnapshot(data, new Date()).breakdown.total

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (value === null || value < 0) return setError('Escribe el saldo del apartado.')
    if (!gap || 'error' in gap) return setError(`Ya hay ${money(reserved)} reservados desde tus cuentas. Para bajar de eso, usa Retirar.`)
    setSaving(true)
    try {
      await fijarSaldo(bucket, gap.gap)
      onDone()
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <AmountField label="Saldo del apartado (MXN)" value={total} onChange={(v) => { setTotal(v); setError(null) }} invalid={error !== null} autoFocus />
      <div className="stat-list">
        <div className="readout">
          <span className="dim">Apartado ahora</span>
          <span className="mono">{money(balance)}</span>
        </div>
        <div className="readout">
          <span className="dim">Saldo que fijas</span>
          <span className="mono">{value === null ? '—' : money(value)}</span>
        </div>
        <div className="readout">
          <span className="dim">Disponible real</span>
          <span className="mono">{money(available)}</span>
        </div>
      </div>
      <FieldNote>Este dinero no está en tus cuentas. No cambia tu banco ni tu Disponible real.</FieldNote>
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel="Fijar saldo" saving={saving} onCancel={onDone} />
    </form>
  )
}

function RecognizeForm({ bucket, data, onDone }: { bucket: SavingsBucket; data: MoneyData; onDone: () => void }) {
  const opening = openingBalance(bucket.uuid, data.bucketMoves)
  const liquid = isHeldInLiquid(bucket, data.accounts)
  const available = moneySnapshot(data, new Date()).breakdown.total
  const after = liquid ? roundMoney(available - opening) : available
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      await recognizeOpening(bucket, opening)
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
          <span className="dim">Disponible real ahora</span>
          <span className="mono">{money(available)}</span>
        </div>
        <div className="dossier-total">
          <span>Disponible real después</span>
          <span className={`mono${after < 0 ? ' text-heat' : ''}`}>{money(after)}</span>
        </div>
      </div>
      <FieldNote>
        {liquid
          ? `${money(opening)} pasan a estar reservados desde tus cuentas, así que tu Disponible real baja. Tu banco no cambia.`
          : `${money(opening)} pasan a la reserva de este apartado. Está en una cuenta de ahorro, así que tu Disponible real no cambia.`}
      </FieldNote>
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel="Ya está en mi banco" saving={saving} onCancel={onDone} />
    </form>
  )
}

function BucketDossier({ bucket, data, onClose }: { bucket: SavingsBucket; data: MoneyData; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('view')
  const [error, setError] = useState<string | null>(null)
  const balance = bucketBalance(bucket, data.bucketMoves)
  const reserved = reservedBalance(bucket, data.bucketMoves)
  const opening = openingBalance(bucket.uuid, data.bucketMoves)
  const history = bucketHistory(bucket, data.bucketMoves)
  const reversed = new Set(data.bucketMoves.flatMap((move) => (move.reverses_id ? [move.reverses_id] : [])))
  const account = data.accounts.find((a) => a.uuid === bucket.account_id)
  const home = homeAccount(bucket, data.accounts)
  const homeUnassigned = home ? unassignedIn(home, data.buckets, data.bucketMoves) : 0
  const pace = targetPace(bucket, balance, data.recurring, new Date())
  const cycleSetAside = setAsideThisCycle(bucket, data.bucketMoves, data.recurring, new Date())
  const required = cycleSetAside.required
  const custom = !isSystemBucket(bucket)
  const customs = data.buckets.filter((b) => !isSystemBucket(b) && !b.archived)
  const position = customs.findIndex((b) => b.uuid === bucket.uuid)
  const hasOthers = data.buckets.some((b) => b.uuid !== bucket.uuid && !b.archived)
  const done = () => setMode('view')

  async function run(action: () => Promise<void>) {
    setError(null)
    try {
      await action()
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
    }
  }

  return (
    <Panel
      title={bucket.name}
      className="bucket-dossier"
      aside={
        <span className="panel-verbs">
          {custom && position > 0 && (
            <button type="button" className="panel-verb" aria-label="Mover antes" onClick={() => run(() => swapBucketOrder(bucket, customs[position - 1]))}>
              ‹
            </button>
          )}
          {custom && position >= 0 && position < customs.length - 1 && (
            <button type="button" className="panel-verb" aria-label="Mover después" onClick={() => run(() => swapBucketOrder(bucket, customs[position + 1]))}>
              ›
            </button>
          )}
          <button type="button" className="panel-verb" onClick={onClose}>
            Cerrar
          </button>
        </span>
      }
    >
      <p className="hero-figure">
        {formatAmount(balance)}
        <span className="hero-currency">MXN</span>
      </p>
      <div className="stat-list">
        {bucket.target !== null && bucket.target > 0 && (
          <StatBar label={`Meta ${money(bucket.target)}`} value={`${Math.round((balance / bucket.target) * 100)}%`} ratio={balance / bucket.target} />
        )}
        {pace && bucket.target_date && (
          <div className="readout">
            <span className="dim">
              {pace.remaining === 0
                ? 'Meta cumplida'
                : pace.overdue
                  ? `La fecha ya pasó · faltan`
                  : `Por ingreso hasta el ${formatDate(isoToDate(bucket.target_date))} (${pace.events})`}
            </span>
            <span className={`mono${pace.overdue ? ' text-amber' : ''}`}>{money(pace.overdue ? pace.remaining : pace.perIncome ?? 0)}</span>
          </div>
        )}
        {pace && pace.remaining > 0 && required !== null && (
          <>
            <table className="roster requirements">
              <thead>
                <tr>
                  <th scope="col" className="wrap">Ingreso del {formatDate(cycleSetAside.since)}</th>
                  <th scope="col" className="num">Requerido</th>
                  <th scope="col" className="num">Apartado</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="dim wrap">Al ritmo de la meta</td>
                  <td className="num mono">{money(required)}</td>
                  <td className={`num mono${cycleSetAside.amount < required ? ' text-amber' : ''}`}>{money(cycleSetAside.amount)}</td>
                </tr>
              </tbody>
            </table>
            <FieldNote>
              {cycleSetAside.amount >= required
                ? 'Este ingreso ya apartó lo del ritmo.'
                : `A este ingreso le faltan ${money(roundMoney(required - cycleSetAside.amount))} para ir al ritmo. Lo que no apartes se reparte en los ingresos que quedan.`}
            </FieldNote>
          </>
        )}
        {opening > 0 && (
          <>
            <div className="readout">
              <span className="dim">Reservado de tus cuentas</span>
              <span className="mono">{money(reserved)}</span>
            </div>
            <div className="readout">
              <span className="dim">Saldo ya apartado · no está en tus cuentas</span>
              <span className="mono">{money(opening)}</span>
            </div>
          </>
        )}
        <div className="readout">
          <span className="dim">Dónde está</span>
          <span>{account ? account.name : 'Banco o efectivo'}</span>
        </div>
        {home && homeUnassigned !== 0 && (
          <div className="readout">
            <span className="dim">{homeUnassigned > 0 ? `Sin apartar en ${home.name}` : `Tus apartados pasan el saldo de ${home.name}`}</span>
            <span className={`mono${homeUnassigned < 0 ? ' text-amber' : ''}`}>{money(Math.abs(homeUnassigned))}</span>
          </div>
        )}
        {bucket.income_share && (
          <div className="readout">
            <span className="dim">Con cada ingreso · {SHARE_OPTIONS.find((o) => o.value === bucket.income_share?.income)?.label}</span>
            <span className="mono">{money(bucket.income_share.amount)}</span>
          </div>
        )}
      </div>

      {mode === 'add' && (home ? <DepositForm bucket={bucket} home={home} data={data} onDone={done} /> : <MoveForm bucket={bucket} data={data} direction={1} onDone={done} />)}
      {mode === 'withdraw' && (home ? <ReleaseForm bucket={bucket} home={home} data={data} onDone={done} /> : <MoveForm bucket={bucket} data={data} direction={-1} onDone={done} />)}
      {mode === 'transfer' && <TransferForm bucket={bucket} data={data} onDone={done} />}
      {mode === 'setup' && <BucketForm bucket={bucket} data={data} onDone={done} />}
      {mode === 'fijar' && (home ? <FijarInAccountForm bucket={bucket} home={home} data={data} onDone={done} /> : <FijarForm bucket={bucket} data={data} onDone={done} />)}
      {mode === 'recognize' && <RecognizeForm bucket={bucket} data={data} onDone={done} />}
      {mode === 'view' && (
        <div className="verb-row">
          <button type="button" className="verb-button verb-primary" onClick={() => setMode('add')}>
            <span className="key-glyph">A</span>
            {home ? 'Depositar' : 'Apartar'}
          </button>
          {balance > 0 && (
            <button type="button" className="verb-button" onClick={() => setMode('withdraw')}>
              <span className="key-glyph">R</span>
              Retirar
            </button>
          )}
          <button type="button" className="verb-button" onClick={() => setMode('fijar')}>
            <span className="key-glyph">F</span>
            Fijar saldo
          </button>
          {opening > 0 && (
            <button type="button" className="verb-button" onClick={() => setMode('recognize')}>
              <span className="key-glyph">Y</span>
              Ya está en mi banco
            </button>
          )}
          {reserved > 0 && hasOthers && (
            <button type="button" className="verb-button" onClick={() => setMode('transfer')}>
              <span className="key-glyph">T</span>
              Mover
            </button>
          )}
          <button type="button" className="verb-button" onClick={() => setMode('setup')}>
            <span className="key-glyph">E</span>
            Editar
          </button>
          {custom && balance === 0 && (
            <button type="button" className="verb-button" onClick={() => run(async () => { await setBucketArchived(bucket, true); onClose() })}>
              <span className="key-glyph">X</span>
              Archivar
            </button>
          )}
        </div>
      )}
      {mode === 'view' && home && homeUnassigned < 0 && (
        <FieldNote>{`Tus apartados en ${home.name} suman ${money(-homeUnassigned)} más que su saldo. Ajústalo en Cuentas → ${home.name}.`}</FieldNote>
      )}
      {mode === 'view' && custom && balance !== 0 && <FieldNote>Para archivarlo, retira o mueve su saldo primero.</FieldNote>}
      {error && <FieldError>{error}</FieldError>}

      {history.length === 0 ? (
        <FooterHint>Sin movimientos todavía.</FooterHint>
      ) : (
        <table className="roster">
          <thead>
            <tr>
              <th scope="col">Fecha</th>
              <th scope="col">Motivo</th>
              <th scope="col" className="num">Monto</th>
            </tr>
          </thead>
          <tbody>
            {history.map((move) => (
              <tr key={move.uuid}>
                <td className="mono dim">{formatDate(isoToDate(move.date))}</td>
                <td className="wrap">
                  {move.reason}
                  <span className="row-sub">{BUCKET_SOURCE_LABEL[move.source]}</span>
                  {move.source === 'opening' && move.amount < 0 && !move.reverses_id && !reversed.has(move.uuid) && (
                    <button type="button" className="panel-verb" onClick={() => run(() => undoOpeningWithdrawal(move))}>
                      Deshacer
                    </button>
                  )}
                </td>
                <td className={`num mono${move.amount > 0 ? ' text-cyan' : ''}`}>{money(move.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  )
}

const RULES_WINDOW_DAYS = 62

function RulesPanel({ data, onAdd }: { data: MoneyData; onAdd: (type: AddType, prefill?: AddPrefill) => void }) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - RULES_WINDOW_DAYS)
  const incomes = data.transactions
    .filter((tx) => isRuleIncome(tx, data.categories, data.recurring) && isoToDate(tx.date) >= cutoff)
    .sort((a, b) => b.date.localeCompare(a.date))

  return (
    <Panel
      title="Reglas de ingreso"
      aside={
        <button type="button" className="panel-verb" onClick={() => onAdd('savings_rule')}>
          Aplicar regla
        </button>
      }
    >
      {incomes.length === 0 ? (
        <FooterHint>Cuando registres tu ingreso principal, aquí ves qué regla le toca y si ya la aplicaste.</FooterHint>
      ) : (
        <table className="roster">
          <thead>
            <tr>
              <th scope="col">Fecha</th>
              <th scope="col">Regla</th>
              <th scope="col" className="num">Apartado</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {incomes.map((tx) => {
              const rule = incomeRank(tx, data.recurring)
              const moves = ruleMoves(tx.uuid, data.bucketMoves)
              const applied = ruleApplied(tx.uuid, rule, data.bucketMoves)
              const moved = roundMoney(moves.reduce((sum, move) => sum + move.amount, 0))
              return (
                <tr key={tx.uuid}>
                  <td className="mono dim">{formatDate(isoToDate(tx.date))}</td>
                  <td>
                    {rule ? RULE_LABEL[rule] : 'Elige la regla'}
                    <span className="row-sub">{`Ingreso ${money(tx.amount)}`}</span>
                  </td>
                  <td className={`num mono${moved > 0 ? ' text-cyan' : ' dim'}`}>{moves.length > 0 ? money(moved) : 'Sin aplicar'}</td>
                  <td className="num">
                    {!applied && (
                      <button type="button" className="panel-verb" onClick={() => onAdd('savings_rule', { income_tx_id: tx.uuid, ...(rule ? { rule } : {}) })}>
                        Aplicar
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </Panel>
  )
}

export function Ahorro({
  onOpenScreen,
  onAdd,
}: {
  onOpenScreen: (screen: SubScreen) => void
  onAdd: (type: AddType, prefill?: AddPrefill) => void
}) {
  const data = useMoneyData()
  const [selected, setSelected] = useState<string | null>(null)
  const dossierRef = useRef<HTMLElement>(null)
  const dossierKey = selected
  useEffect(() => {
    if (!dossierKey) return
    if (!window.matchMedia('(max-width: 899px)').matches) return
    dossierRef.current?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dossierKey])
  if (!data.loaded) return null

  const active = data.buckets.filter((bucket) => !bucket.archived)
  const archived = data.buckets.filter((bucket) => bucket.archived)
  const selectedBucket = active.find((bucket) => bucket.uuid === selected)
  const creating = selected === NEW_BUCKET
  const total = roundMoney(active.reduce((sum, bucket) => sum + bucketBalance(bucket, data.bucketMoves), 0))
  const openingTotal = roundMoney(active.reduce((sum, bucket) => sum + Math.max(0, openingBalance(bucket.uuid, data.bucketMoves)), 0))

  return (
    <div className={`stage-grid${selectedBucket || creating ? '' : ' stage-grid--single'}`}>
      <div className="stage-main">
        <StageHeader title="Ahorro" share />
        <div className="verb-row">
          <button type="button" className="verb-button" onClick={() => setSelected(NEW_BUCKET)}>
            <span className="key-glyph">N</span>
            Nuevo apartado
          </button>
          <button type="button" className="verb-button" onClick={() => onOpenScreen('settings')}>
            <span className="key-glyph">S</span>
            Ajustes
          </button>
        </div>
        <div className="grade-row">
          {active.map((bucket, index) => {
            const balance = bucketBalance(bucket, data.bucketMoves)
            const hasTarget = bucket.target !== null && bucket.target > 0
            return (
              <GradeCard
                key={bucket.uuid}
                grade={`Apartado ${index + 1}`}
                title={bucket.name}
                value={money(balance)}
                meta={hasTarget ? `Meta ${money(bucket.target!)}` : 'Sin meta'}
                progress={hasTarget ? balance / bucket.target! : undefined}
                tone={balance > 0 ? 'safe' : 'empty'}
                selected={bucket.uuid === selected}
                onSelect={() => setSelected(bucket.uuid === selected ? null : bucket.uuid)}
              />
            )
          })}
        </div>
        <FooterHint>
          {total > 0
            ? `Tienes ${money(total)} apartados.${openingTotal > 0 ? ` ${money(openingTotal)} no están en tus cuentas.` : ''} Lo reservado en banco o efectivo ya no cuenta como disponible.`
            : 'Tus apartados se llenan a mano o con las reglas del primer y segundo ingreso.'}
        </FooterHint>
        <RulesPanel data={data} onAdd={onAdd} />
        {archived.length > 0 && (
          <Panel title="Archivados">
            <table className="roster">
              <tbody>
                {archived.map((bucket) => (
                  <tr key={bucket.uuid}>
                    <td>{bucket.name}</td>
                    <td className="num">
                      <button type="button" className="panel-verb" onClick={() => void setBucketArchived(bucket, false)}>
                        Restaurar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
      </div>
      {creating && (
        <aside ref={dossierRef} className="dossier dossier-sheet" tabIndex={-1} aria-label="Nuevo apartado">
          <Panel title="Nuevo apartado">
            <BucketForm data={data} onDone={() => setSelected(null)} onCreated={(bucket) => setSelected(bucket.uuid)} />
          </Panel>
        </aside>
      )}
      {selectedBucket && (
        <aside ref={dossierRef} className="dossier dossier-sheet" tabIndex={-1} aria-label={selectedBucket.name}>
          <BucketDossier key={selectedBucket.uuid} bucket={selectedBucket} data={data} onClose={() => setSelected(null)} />
        </aside>
      )}
    </div>
  )
}
