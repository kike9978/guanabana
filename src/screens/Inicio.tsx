import { Fragment, useState } from 'react'
import type { AddPrefill, AddType, SubScreen } from '../app/navigation'
import { FooterHint, Panel, Rail, StatBar } from '../components/hud'
import { AdjustOccurrenceForm } from '../components/AdjustOccurrenceForm'
import { OpeningBalancePanel } from '../components/OpeningBalancePanel'
import { StageHeader } from '../components/StageHeader'
import { findOpeningAccount, isLiquid } from '../db/accounts'
import { FieldError } from '../components/fields'
import { updateSettings } from '../db/buckets'
import type { Account } from '../db/types'
import { useMoneyData, type MoneyData } from '../db/useMoneyData'
import { bucketBalance } from '../lib/buckets'
import { daysBetween, isoToDate, todayIso } from '../lib/dates'
import { pendingRuleIncomes, RULE_LABEL, type PendingRule } from '../lib/incomeRules'
import { cashReviewDue, type CashReview } from '../lib/reconcile'
import { ReconcileForm } from './Cuentas'
import { formatAmount, formatDate, formatMoney } from '../lib/format'
import { outstanding } from '../lib/loans'
import { roundMoney } from '../lib/money'
import { realAvailableTone } from '../lib/realAvailable'
import { moneySnapshot } from '../lib/snapshot'
import { nextPayments, paymentLabel } from '../lib/statement'
import { adjustedNote, adjustLabel, canAdjust, timeline, type TimelineEvent } from '../lib/timeline'

const UPCOMING_DAYS = 14

function sumType(accounts: Account[], type: Account['type']): number {
  return roundMoney(accounts.filter((a) => a.type === type).reduce((sum, a) => sum + a.current_balance, 0))
}

function whenLabel(days: number): string {
  if (days < 0) return days === -1 ? 'Venció ayer' : `Venció hace ${-days} días`
  if (days === 0) return 'Hoy'
  if (days === 1) return 'Mañana'
  return `En ${days} días`
}

function amountTone(event: TimelineEvent, days: number): string {
  if (days < 0) return ' text-amber'
  if (event.kind === 'income' || event.kind === 'loan_receivable') return ' text-cyan'
  if (event.kind === 'cc_due' && days <= 3) return ' text-amber'
  return ''
}

function CashReviewPanel({ review, data, onAdd }: { review: CashReview; data: MoneyData; onAdd: (type: AddType, prefill?: AddPrefill) => void }) {
  const [counting, setCounting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { account } = review
  const markReviewed = async () => {
    if (data.settings) await updateSettings(data.settings, { cash_reviewed_at: todayIso() })
  }

  return (
    <Panel title="Revisión de efectivo">
      {counting ? (
        <ReconcileForm data={data} target={{ kind: 'account', uuid: account.uuid }} onDone={() => setCounting(false)} onSaved={markReviewed} />
      ) : (
        <>
          <div className="readout">
            <span className="dim">{account.name} según la app</span>
            <span className="mono">{formatMoney(account.current_balance, 'MXN')}</span>
          </div>
          <FooterHint>
            Tu última revisión fue el {formatDate(isoToDate(review.lastReview))}. ¿Hubo gastos en efectivo que no anotaste?
          </FooterHint>
          <div className="verb-row">
            <button type="button" className="verb-button verb-primary" onClick={() => onAdd('expense', { account_id: account.uuid })}>
              <span className="key-glyph">G</span>
              Anotar gasto
            </button>
            <button type="button" className="verb-button" onClick={() => setCounting(true)}>
              <span className="key-glyph">C</span>
              Contar efectivo
            </button>
            <button type="button" className="verb-button" onClick={() => markReviewed().catch(() => setError('No se pudo guardar. Intenta de nuevo.'))}>
              <span className="key-glyph">L</span>
              Está al día
            </button>
          </div>
          {error && <FieldError>{error}</FieldError>}
        </>
      )}
    </Panel>
  )
}

function PendingRulePanel({
  pending,
  data,
  onAdd,
}: {
  pending: PendingRule[]
  data: MoneyData
  onAdd: (type: AddType, prefill?: AddPrefill) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const dismiss = async () => {
    if (data.settings) await updateSettings(data.settings, { rule_prompt_dismissed_at: todayIso() })
  }

  return (
    <Panel title="Regla pendiente">
      <table className="roster">
        <tbody>
          {pending.map(({ income, rule }) => (
            <tr key={income.uuid}>
              <td className="mono dim">{formatDate(isoToDate(income.date))}</td>
              <td>{rule ? RULE_LABEL[rule] : 'Elige la regla'}</td>
              <td className="num mono">{formatMoney(income.amount, 'MXN')}</td>
              <td className="num">
                <button
                  type="button"
                  className="panel-verb"
                  onClick={() => onAdd('savings_rule', { income_tx_id: income.uuid, ...(rule ? { rule } : {}) })}
                >
                  Aplicar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="verb-row">
        <button type="button" className="verb-button" onClick={() => dismiss().catch(() => setError('No se pudo guardar. Intenta de nuevo.'))}>
          <span className="key-glyph">N</span>
          Ahora no
        </button>
      </div>
      <FooterHint>
        {pending.length === 1
          ? `Tu ingreso del ${formatDate(isoToDate(pending[0].income.date))} aún no tiene regla. Puedes aplicarla después desde Ahorro.`
          : 'Estos ingresos aún no tienen regla. Puedes aplicarlas después desde Ahorro.'}
      </FooterHint>
      {error && <FieldError>{error}</FieldError>}
    </Panel>
  )
}

export function Inicio({
  onAdd,
  onOpenScreen,
  onOpenAhorro,
}: {
  onAdd: (type: AddType, prefill?: AddPrefill) => void
  onOpenScreen: (screen: SubScreen) => void
  onOpenAhorro: () => void
}) {
  const data = useMoneyData()
  const [selected, setSelected] = useState<string | null>(null)
  const [adjusting, setAdjusting] = useState<string | null>(null)
  const accounts = data.accounts.filter((a) => !a.archived || a.current_balance !== 0)
  const cards = data.cards.filter((c) => !c.archived || c.current_balance !== 0)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const { cycle, commitments, breakdown } = moneySnapshot(data, now)
  const opening = findOpeningAccount(accounts)
  const hasMoneyData = accounts.length > 0 || cards.length > 0
  const hasLiquidAccounts = accounts.some((a) => a.type === 'checking' || a.type === 'cash')
  const showOpening = data.loaded && (opening ? opening.current_balance !== 0 || !hasLiquidAccounts : !hasLiquidAccounts)
  const money = (value: number) => formatMoney(value, 'MXN')
  const cashReviews = data.loaded ? cashReviewDue(data.accounts, data.transactions, data.settings ?? null, today) : []
  const pendingRules = data.loaded
    ? pendingRuleIncomes(
        data.transactions,
        data.categories,
        data.recurring,
        data.bucketMoves,
        cycle,
        data.settings?.rule_prompt_dismissed_at,
        today,
      )
    : []

  const overdueFrom = commitments.filter((item) => item.overdue).reduce((min, item) => (item.date < min ? item.date : min), cycle.start)
  const windowEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + UPCOMING_DAYS + 1)
  const upcoming = timeline(data, overdueFrom < today ? overdueFrom : today, windowEnd).filter(
    (event) => !event.paid && (event.date >= today || event.kind === 'bill' || event.kind === 'loan'),
  )
  const selectedEvent = upcoming.find((event) => event.key === selected)

  const rows = [
    { label: 'Banco', value: breakdown.bank, show: true },
    { label: 'Efectivo', value: breakdown.cash, show: true },
    { label: 'Saldo sin origen', value: breakdown.unassigned, show: breakdown.unassigned !== 0 },
    {
      id: 'card',
      label: breakdown.ccMsiPending > 0 ? `− Deuda TDC (sin ${money(breakdown.ccMsiPending)} a meses por cobrar)` : '− Deuda TDC',
      value: breakdown.ccReserve,
      show: true,
    },
    { label: '− Pagos antes del próximo ingreso', value: breakdown.billsBeforeNextIncome, show: true },
    { label: '− Facturas por pagar', value: breakdown.invoicesOutstanding, show: breakdown.invoicesOutstanding !== 0 },
    { label: '− Cuotas de préstamos antes del próximo ingreso', value: breakdown.loanInstallmentsBeforeNextIncome, show: true },
    { label: '− Apartados en banco y efectivo', value: breakdown.bucketsInLiquid, show: true },
    { label: '− Colchón', value: breakdown.buffer, show: true },
  ].filter((row) => row.show)
  const payments = nextPayments(cards, data.transactions, now)
  const cardSplits = cards
    .filter((card) => card.payment_strategy !== 'full' && payments[card.uuid].amount + payments[card.uuid].rest > 0)
    .map((card) => ({ card, payment: payments[card.uuid] }))
  const scale = Math.max(1, ...rows.map((row) => Math.abs(row.value)))
  const tone = realAvailableTone(breakdown, hasMoneyData)
  const cardDebt = roundMoney(cards.reduce((sum, c) => sum + c.current_balance, 0))
  const bucketTotal = roundMoney(data.buckets.reduce((sum, bucket) => sum + Math.max(0, bucketBalance(bucket, data.bucketMoves)), 0))
  const borrowed = data.loans.filter((loan) => loan.direction === 'borrowed' && loan.status === 'active')
  const loanDebt = outstanding('borrowed', data.loans, data.installments, data.transactions)
  const owedToMe = outstanding('lent', data.loans, data.installments, data.transactions)

  const chips = [
    { id: 'bank', label: 'Banco', value: accounts.some((a) => a.type === 'checking') ? money(sumType(accounts, 'checking')) : '—' },
    { id: 'cash', label: 'Efectivo', value: accounts.some((a) => a.type === 'cash') ? money(sumType(accounts, 'cash')) : '—' },
    ...(breakdown.unassigned !== 0 ? [{ id: 'unassigned', label: 'Sin origen', value: money(breakdown.unassigned) }] : []),
    { id: 'card', label: 'TDC', value: cards.length > 0 ? money(cardDebt) : '—' },
    { id: 'loans', label: 'Préstamos', value: borrowed.length > 0 ? money(loanDebt) : '—' },
    ...(owedToMe > 0 ? [{ id: 'owed', label: 'Te deben', value: money(owedToMe) }] : []),
    {
      id: 'savings',
      label: 'Ahorro',
      value: accounts.some((a) => !isLiquid(a)) ? money(accounts.filter((a) => !isLiquid(a)).reduce((sum, a) => sum + a.current_balance, 0)) : '—',
    },
  ]

  return (
    <div className="stage-grid">
      <div className="stage-main">
        <StageHeader title="¿Cuánto tengo de verdad?" share />
        <Rail label="Cuentas" items={chips} onSelect={(id) => onOpenScreen(id === 'loans' || id === 'owed' ? 'loans' : 'accounts')} />
        <div className="verb-row">
          <button type="button" className="verb-button" onClick={() => onAdd('expense')}>
            <span className="key-glyph">G</span>
            Gasto
          </button>
          <button type="button" className="verb-button" onClick={() => onAdd('income')}>
            <span className="key-glyph">I</span>
            Ingreso
          </button>
          <button type="button" className="verb-button" onClick={() => onOpenScreen('accounts')}>
            <span className="key-glyph">C</span>
            Cuentas
          </button>
          <button type="button" className="verb-button" onClick={() => onOpenScreen('commitments')}>
            <span className="key-glyph">F</span>
            Pagos fijos
          </button>
          <button type="button" className="verb-button" onClick={() => onOpenScreen('loans')}>
            <span className="key-glyph">L</span>
            Préstamos
          </button>
        </div>
        {showOpening && <OpeningBalancePanel key={opening?.updated_at ?? 'new'} opening={opening} />}
        {pendingRules.length > 0 && <PendingRulePanel pending={pendingRules} data={data} onAdd={onAdd} />}
        {cashReviews.map((review) => (
          <CashReviewPanel key={review.account.uuid} review={review} data={data} onAdd={onAdd} />
        ))}
        <Panel title="Próximos 14 días">
          {upcoming.length === 0 ? (
            <FooterHint>Sin pagos, cuotas ni ingresos en los próximos 14 días.</FooterHint>
          ) : (
            <>
              <table className="roster">
                <tbody>
                  {upcoming.map((event) => {
                    const days = daysBetween(today, event.date)
                    return (
                      <tr
                        key={event.key}
                        className={event.action ? 'roster-row' : undefined}
                        aria-selected={event.action ? event.key === selected : undefined}
                        tabIndex={event.action ? 0 : undefined}
                        onClick={event.action ? () => setSelected(event.key === selected ? null : event.key) : undefined}
                      >
                        <td className="mono dim">{formatDate(event.date)}</td>
                        <td>
                          {event.label}
                          <span className={`row-sub${days < 0 ? ' text-amber' : ''}`}>
                            {[whenLabel(days), adjustedNote(event)].filter(Boolean).join(' · ')}
                          </span>
                        </td>
                        <td className={`num mono${amountTone(event, days)}`}>{event.amount === null ? '—' : money(event.amount)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {selectedEvent?.action && adjusting !== selectedEvent.key && (
                <div className="verb-row">
                  <button
                    type="button"
                    className="verb-button verb-primary"
                    onClick={() => onAdd(selectedEvent.action!.type, selectedEvent.action!.prefill)}
                  >
                    <span className="key-glyph">A</span>
                    {selectedEvent.action.type === 'income' ? 'Registrar ingreso' : 'Registrar pago'}
                  </button>
                  {canAdjust(selectedEvent, today) && (
                    <button type="button" className="verb-button" onClick={() => setAdjusting(selectedEvent.key)}>
                      <span className="key-glyph">J</span>
                      {adjustLabel(selectedEvent)}
                    </button>
                  )}
                </div>
              )}
              {selectedEvent && adjusting === selectedEvent.key && (
                <AdjustOccurrenceForm key={selectedEvent.key} data={data} event={selectedEvent} onDone={() => setAdjusting(null)} />
              )}
            </>
          )}
        </Panel>
        <Panel
          title="Apartados"
          aside={
            <button type="button" className="panel-verb" onClick={onOpenAhorro}>
              Ver ahorro
            </button>
          }
        >
          {bucketTotal === 0 ? (
            <FooterHint>Sin apartados todavía. Reserva dinero en Ahorro o con las reglas de ingreso.</FooterHint>
          ) : (
            <div className="stat-list">
              {data.buckets.filter((bucket) => !bucket.archived).map((bucket) => {
                const balance = bucketBalance(bucket, data.bucketMoves)
                const target = bucket.target ?? 0
                return (
                  <StatBar
                    key={bucket.uuid}
                    label={bucket.name}
                    value={money(balance)}
                    ratio={target > 0 ? balance / target : balance / bucketTotal}
                    tone={balance > 0 ? 'safe' : 'empty'}
                  />
                )
              })}
            </div>
          )}
        </Panel>
      </div>

      <aside className="dossier" aria-label="Disponible real">
        <Panel
          title="Disponible real"
          aside={
            <button type="button" className="panel-verb" onClick={() => onOpenScreen('settings')}>
              Ajustes
            </button>
          }
        >
          <p className={`hero-figure tone-${tone}`}>
            {formatAmount(breakdown.total)}
            <span className="hero-currency">MXN</span>
          </p>
          <div className="stat-list">
            {rows.map((row) => (
              <Fragment key={row.label}>
                <StatBar
                  label={row.label}
                  value={money(row.value)}
                  ratio={Math.abs(row.value) / scale}
                  tone={hasMoneyData ? 'safe' : 'empty'}
                />
                {row.id === 'card' &&
                  cardSplits.map(({ card, payment }) => (
                    <Fragment key={card.uuid}>
                      <div className="readout">
                        <span className="dim">{`${card.name} · ${paymentLabel(card, payment)} vence el ${formatDate(payment.due)}`}</span>
                        <span className="mono">{money(payment.amount)}</span>
                      </div>
                      {payment.rest > 0 && (
                        <div className="readout">
                          <span className="dim">{`${card.name} · pasa al siguiente corte`}</span>
                          <span className="mono">{money(payment.rest)}</span>
                        </div>
                      )}
                    </Fragment>
                  ))}
              </Fragment>
            ))}
          </div>
          <div className="dossier-total">
            <span>= Seguro para gastar</span>
            <span className="mono">{money(breakdown.total)}</span>
          </div>
          {owedToMe > 0 && (
            <button type="button" className="readout readout-link" onClick={() => onOpenScreen('loans')}>
              <span className="dim">Te deben · no cuenta hasta cobrarlo</span>
              <span className="mono dim">{money(owedToMe)}</span>
            </button>
          )}
        </Panel>
        <FooterHint>
          {!hasMoneyData
            ? 'Agrega tu saldo inicial para calcular tu Disponible real.'
            : cycle.hasSchedule
              ? `Calculado hasta tu próximo ingreso, el ${formatDate(cycle.end)}.`
              : `Sin días de ingreso: se apartan los pagos de los próximos ${daysBetween(cycle.start, cycle.end)} días.`}
        </FooterHint>
        {breakdown.unassigned !== 0 && (
          <FooterHint>El saldo sin origen cuenta como disponible. Transfiérelo a banco o efectivo cuando quieras.</FooterHint>
        )}
      </aside>
    </div>
  )
}
