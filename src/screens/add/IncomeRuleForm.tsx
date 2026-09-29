import { useState, type FormEvent } from 'react'
import { AmountField, FieldError, FieldNote, FormActions, SelectField } from '../../components/fields'
import { FooterHint } from '../../components/hud'
import { isLiquid } from '../../db/accounts'
import { applyIncomeRule, BUCKET_SOURCE_LABEL, type RuleMove } from '../../db/buckets'
import type { Account, BucketRule, Transaction } from '../../db/types'
import type { MoneyData } from '../../db/useMoneyData'
import { isHeldInLiquid } from '../../lib/buckets'
import { isoToDate } from '../../lib/dates'
import { formatDate, formatMoney } from '../../lib/format'
import {
  fitToAvailable,
  incomeRank,
  isRuleIncome,
  planFirstIncome,
  planSecondIncome,
  ruleMoves,
  shortfall,
  type IncomeRule,
} from '../../lib/incomeRules'
import { roundMoney } from '../../lib/money'
import { parseAmount } from '../../lib/parseAmount'
import { moneySnapshot } from '../../lib/snapshot'
import type { AddFormProps } from './formProps'

const RECENT_DAYS = 62

const RULE_SOURCE = { first: 'first_income', second: 'second_income' } as const

const money = (value: number) => formatMoney(value, 'MXN')

function Row({ label, value, strong = false, tone }: { label: string; value: number; strong?: boolean; tone?: 'amber' | 'heat' }) {
  return (
    <div className={strong ? 'dossier-total' : 'readout'}>
      <span className={strong ? undefined : 'dim'}>{label}</span>
      <span className={`mono${tone ? ` text-${tone}` : ''}`}>{money(value)}</span>
    </div>
  )
}

function incomeLabel(tx: Transaction, data: MoneyData): string {
  const category = data.categories.find((c) => c.uuid === tx.category_id)?.name ?? 'Ingreso'
  return `${formatDate(isoToDate(tx.date))} · ${category} · ${money(tx.amount)}`
}

export function IncomeRuleForm({ data, onDone, prefill }: AddFormProps) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - RECENT_DAYS)
  const candidates = data.transactions
    .filter((tx) => isRuleIncome(tx, data.categories, data.recurring) && (isoToDate(tx.date) >= cutoff || tx.uuid === prefill?.income_tx_id))
    .sort((a, b) => b.date.localeCompare(a.date))
  const [txId, setTxId] = useState(prefill?.income_tx_id ?? candidates[0]?.uuid ?? '')
  const tx = candidates.find((candidate) => candidate.uuid === txId) ?? candidates[0]
  const [rule, setRule] = useState<IncomeRule | null>(prefill?.rule ?? null)
  const activeRule = rule ?? (tx && incomeRank(tx, data.recurring)) ?? 'first'
  const account = data.accounts.find((a) => a.uuid === tx?.account_id)

  if (!tx) return <FooterHint>Registra tu ingreso principal para aplicar las reglas de ahorro.</FooterHint>
  if (!account) return <FooterHint>La cuenta de este ingreso ya no existe.</FooterHint>

  return (
    <div className="form">
      {!prefill?.income_tx_id && (
        <SelectField
          label="Ingreso"
          value={tx.uuid}
          onChange={(value) => { setTxId(value); setRule(null) }}
          options={candidates.map((candidate) => ({ value: candidate.uuid, label: incomeLabel(candidate, data) }))}
        />
      )}
      <SelectField
        label="Regla"
        value={activeRule}
        onChange={(value) => setRule(value as IncomeRule)}
        options={[
          { value: 'first', label: 'Primer ingreso · sobrante a Emergencia' },
          { value: 'second', label: 'Segundo ingreso · Retiro y Viajes' },
        ]}
      />
      {prefill?.income_tx_id && <FieldNote>{`Ingreso guardado: ${incomeLabel(tx, data)}.`}</FieldNote>}
      <RuleBody key={`${tx.uuid}-${activeRule}`} data={data} tx={tx} account={account} rule={activeRule} onDone={onDone} />
    </div>
  )
}

function RuleBody({ data, tx, account, rule, onDone }: { data: MoneyData; tx: Transaction; account: Account; rule: IncomeRule; onDone: () => void }) {
  const [actual, setActual] = useState(String(account.current_balance))
  const [amounts, setAmounts] = useState<Partial<Record<BucketRule, string>>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const source = RULE_SOURCE[rule]
  const applied = ruleMoves(tx.uuid, data.bucketMoves).filter((move) => move.source === source)
  const bucket = (type: BucketRule) => data.buckets.find((b) => b.rule_type === type)

  if (applied.length > 0) {
    return (
      <>
        <div className="stat-list">
          {applied.map((move) => (
            <Row key={move.uuid} label={data.buckets.find((b) => b.uuid === move.bucket_id)?.name ?? 'Apartado'} value={move.amount} />
          ))}
        </div>
        <FooterHint>{`Ya aplicaste la ${BUCKET_SOURCE_LABEL[source].toLowerCase()} a este ingreso.`}</FooterHint>
        <div className="verb-row">
          <button type="button" className="verb-button verb-primary" onClick={onDone}>
            <span className="key-glyph">A</span>
            Listo
          </button>
        </div>
      </>
    )
  }

  const breakdown = moneySnapshot(data, new Date()).breakdown
  const actualValue = parseAmount(actual)
  const gap = actualValue === null ? 0 : roundMoney(actualValue - account.current_balance)
  const liquidGap = isLiquid(account) ? gap : 0
  const liquid = roundMoney(breakdown.bank + breakdown.cash + breakdown.unassigned + liquidGap)
  const available = roundMoney(breakdown.total + liquidGap)
  const settings = data.settings

  const first = planFirstIncome({ liquid, income: tx.amount, reserved: breakdown.bucketsInLiquid, cardReserve: breakdown.ccReserve })
  const second = planSecondIncome({
    income: tx.amount,
    retirementPct: settings?.second_income_rule.retirement_pct ?? 0.2,
    travelMax: settings?.second_income_rule.travel_mxn ?? 5000,
    available,
  })
  const suggested: Partial<Record<BucketRule, number>> =
    rule === 'first' ? { emergency: first.suggested } : { retirement: second.retirement, travel: second.travel }
  const types = Object.keys(suggested) as BucketRule[]
  const value = (type: BucketRule) => (amounts[type] !== undefined ? parseAmount(amounts[type] || '0') : suggested[type] ?? 0)
  const text = (type: BucketRule) => amounts[type] ?? String(suggested[type] ?? 0)
  const setAmount = (type: BucketRule) => (next: string) => {
    setAmounts((current) => ({ ...current, [type]: next }))
    setError(null)
  }

  const total = roundMoney(types.reduce((sum, type) => sum + (value(type) ?? 0), 0))
  const liquidTotal = roundMoney(
    types.reduce((sum, type) => {
      const target = bucket(type)
      return sum + (target && isHeldInLiquid(target, data.accounts) ? value(type) ?? 0 : 0)
    }, 0),
  )
  const after = roundMoney(available - liquidTotal)
  const { short } = rule === 'second' ? shortfall(value('retirement') ?? 0, value('travel') ?? 0, available) : { short: 0 }
  const nothingToMove = rule === 'first' && first.suggested === 0
  const submitLabel = nothingToMove ? (gap !== 0 ? 'Guardar saldo' : 'Listo') : short > 0 ? 'Apartar de todos modos' : 'Apartar'

  function fit() {
    const fitted = fitToAvailable(value('retirement') ?? 0, value('travel') ?? 0, available)
    setAmounts({ retirement: String(fitted.retirement), travel: String(fitted.travel) })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (actualValue === null) return setError('Escribe el saldo real de la cuenta.')
    if (types.some((type) => value(type) === null || (value(type) ?? 0) < 0)) return setError('Revisa los montos.')
    if (nothingToMove && gap === 0) return onDone()
    const date = formatDate(isoToDate(tx.date))
    const reasons: Record<BucketRule, string> = {
      emergency: `Sobrante antes del ingreso del ${date}`,
      retirement: `Retiro · ingreso del ${date}`,
      travel: `Viajes · ingreso del ${date}`,
    }
    const moves: RuleMove[] = nothingToMove
      ? []
      : types.flatMap((type) => {
          const target = bucket(type)
          return target ? [{ bucket: target, amount: value(type) ?? 0, reason: reasons[type] }] : []
        })
    setSaving(true)
    try {
      await applyIncomeRule({ source, incomeTxId: tx.uuid, reconcile: gap !== 0 ? { account, actual: actualValue } : null, moves })
      onDone()
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <AmountField label={`Saldo real en ${account.name} ahora (MXN)`} value={actual} onChange={(v) => { setActual(v); setError(null) }} autoFocus />
      {gap !== 0 && (
        <>
          <Row label="Diferencia con lo calculado" value={gap} tone="amber" />
          <FieldNote>La diferencia se guarda como ajuste de saldo al confirmar.</FieldNote>
        </>
      )}

      {rule === 'first' ? (
        <>
          <div className="stat-list">
            <Row label="Banco y efectivo" value={first.liquid} />
            <Row label="− Este ingreso" value={first.income} />
            <Row label="− Ya apartado" value={first.reserved} />
            <Row label="− Deuda TDC" value={first.cardReserve} />
            <Row label="= Sobrante del ingreso anterior" value={first.remainder} strong />
          </div>
          {nothingToMove ? (
            <FooterHint>No quedó sobrante del ingreso anterior, así que esta vez la regla no aplica.</FooterHint>
          ) : (
            <AmountField label={`A ${bucket('emergency')?.name ?? 'Emergencia'} (MXN)`} value={text('emergency')} onChange={setAmount('emergency')} />
          )}
        </>
      ) : (
        <>
          <div className="field-row">
            <AmountField label={`${bucket('retirement')?.name ?? 'Retiro'} (MXN)`} value={text('retirement')} onChange={setAmount('retirement')} />
            <AmountField label={`${bucket('travel')?.name ?? 'Viajes'} (MXN)`} value={text('travel')} onChange={setAmount('travel')} />
          </div>
          <FieldNote>
            {`Sugerido: ${Math.round(second.retirementPct * 1000) / 10}% de ${money(tx.amount)} a Retiro y hasta ${money(second.travelMax)} a Viajes. Lo cambias en Ajustes.`}
          </FieldNote>
        </>
      )}

      {!nothingToMove && (
        <div className="stat-list">
          <Row label="Disponible real con este saldo" value={available} />
          <Row label="− Lo que apartas" value={total} />
          <Row label="= Disponible real después" value={after} strong tone={after < 0 ? 'heat' : undefined} />
        </div>
      )}

      {short > 0 && (
        <>
          <Row label="No alcanza por" value={short} tone="amber" />
          <FieldNote>Tus pagos antes del próximo ingreso ya están descontados. Puedes bajar los montos, omitir la regla o apartar de todos modos.</FieldNote>
          <div className="verb-row">
            <button type="button" className="verb-button" onClick={fit}>
              <span className="key-glyph">Y</span>
              Ajustar a lo que alcanza
            </button>
          </div>
        </>
      )}

      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel={submitLabel} saving={saving} onCancel={nothingToMove && gap === 0 ? undefined : onDone} cancelLabel="Omitir" />
    </form>
  )
}