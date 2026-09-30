import { useState, type FormEvent } from 'react'
import { AmountField, FieldError, FieldNote, FormActions, SelectField } from '../../components/fields'
import { FooterHint } from '../../components/hud'
import { isLiquid } from '../../db/accounts'
import { applyIncomeRule, BUCKET_SOURCE_LABEL, type RuleMove } from '../../db/buckets'
import type { Account, BucketRule, SavingsBucket, Transaction } from '../../db/types'
import type { MoneyData } from '../../db/useMoneyData'
import { isHeldInLiquid } from '../../lib/buckets'
import { isoToDate } from '../../lib/dates'
import { formatDate, formatMoney } from '../../lib/format'
import {
  customShares,
  fitInOrder,
  incomeRank,
  isRuleIncome,
  planFirstIncome,
  planSecondIncome,
  RULE_SOURCE,
  ruleMoves,
  type IncomeRule,
} from '../../lib/incomeRules'
import { roundMoney } from '../../lib/money'
import { parseAmount } from '../../lib/parseAmount'
import { moneySnapshot } from '../../lib/snapshot'
import type { AddFormProps } from './formProps'

const RECENT_DAYS = 62

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

interface Line {
  key: string
  bucket: SavingsBucket | undefined
  label: string
  suggested: number
  reason: string
}

function RuleBody({ data, tx, account, rule, onDone }: { data: MoneyData; tx: Transaction; account: Account; rule: IncomeRule; onDone: () => void }) {
  const [actual, setActual] = useState(String(account.current_balance))
  const [amounts, setAmounts] = useState<Record<string, string>>({})
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
  const date = formatDate(isoToDate(tx.date))
  const system = (type: BucketRule, fallback: string, suggested: number, reason: string): Line => ({
    key: type,
    bucket: bucket(type),
    label: bucket(type)?.name ?? fallback,
    suggested,
    reason,
  })
  const customs = customShares(data.buckets, rule)
  const lines: Line[] = [
    ...(rule === 'first'
      ? [system('emergency', 'Emergencia', first.suggested, `Sobrante antes del ingreso del ${date}`)]
      : [
          system('retirement', 'Retiro', second.retirement, `Retiro · ingreso del ${date}`),
          system('travel', 'Viajes', second.travel, `Viajes · ingreso del ${date}`),
        ]),
    ...customs.map((share) => ({
      key: share.bucket.uuid,
      bucket: share.bucket,
      label: share.bucket.name,
      suggested: share.amount,
      reason: `${share.bucket.name} · ingreso del ${date}`,
    })),
  ]
  const value = (line: Line) => (amounts[line.key] !== undefined ? parseAmount(amounts[line.key] || '0') : line.suggested)
  const text = (line: Line) => amounts[line.key] ?? String(line.suggested)
  const setAmount = (line: Line) => (next: string) => {
    setAmounts((current) => ({ ...current, [line.key]: next }))
    setError(null)
  }
  const field = (line: Line) => <AmountField key={line.key} label={`A ${line.label} (MXN)`} value={text(line)} onChange={setAmount(line)} />

  const total = roundMoney(lines.reduce((sum, line) => sum + (value(line) ?? 0), 0))
  const liquidTotal = roundMoney(
    lines.reduce((sum, line) => sum + (line.bucket && isHeldInLiquid(line.bucket, data.accounts) ? value(line) ?? 0 : 0), 0),
  )
  const after = roundMoney(available - liquidTotal)
  const short = rule === 'second' || customs.length > 0 ? roundMoney(Math.max(0, total - Math.max(0, available))) : 0
  const noRemainder = rule === 'first' && first.suggested === 0
  const nothingToMove = noRemainder && customs.length === 0
  const submitLabel = nothingToMove ? (gap !== 0 ? 'Guardar saldo' : 'Listo') : short > 0 ? 'Apartar de todos modos' : 'Apartar'

  function fit() {
    const fitted = fitInOrder(lines.map((line) => value(line) ?? 0), available)
    setAmounts(Object.fromEntries(lines.map((line, index) => [line.key, String(fitted[index])])))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (actualValue === null) return setError('Escribe el saldo real de la cuenta.')
    if (lines.some((line) => value(line) === null || (value(line) ?? 0) < 0)) return setError('Revisa los montos.')
    if (nothingToMove && gap === 0) return onDone()
    const moves: RuleMove[] = lines.flatMap((line) =>
      line.bucket && !(noRemainder && line.key === 'emergency') ? [{ bucket: line.bucket, amount: value(line) ?? 0, reason: line.reason }] : [],
    )
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
          {noRemainder ? (
            <FooterHint>
              {customs.length > 0
                ? 'No quedó sobrante del ingreso anterior, así que esta vez no va nada a Emergencia.'
                : 'No quedó sobrante del ingreso anterior, así que esta vez la regla no aplica.'}
            </FooterHint>
          ) : (
            field(lines[0])
          )}
        </>
      ) : (
        <>
          <div className="field-row">{lines.slice(0, 2).map(field)}</div>
          <FieldNote>
            {`Sugerido: ${Math.round(second.retirementPct * 1000) / 10}% de ${money(tx.amount)} a Retiro y hasta ${money(second.travelMax)} a Viajes. Lo cambias en Ajustes.`}
          </FieldNote>
        </>
      )}

      {customs.length > 0 && (
        <>
          {lines.slice(rule === 'first' ? 1 : 2).map(field)}
          <FieldNote>Montos sugeridos en cada apartado. Los cambias en Ahorro.</FieldNote>
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