import type { AddType } from '../app/navigation'
import { FooterHint, Panel, Rail, StatBar } from '../components/hud'
import { OpeningBalancePanel } from '../components/OpeningBalancePanel'
import { StageHeader } from '../components/StageHeader'
import { findOpeningAccount } from '../db/accounts'
import type { Account } from '../db/types'
import { useMoneyData } from '../db/useMoneyData'
import { daysBetween } from '../lib/dates'
import { formatAmount, formatDate, formatMoney } from '../lib/format'
import { roundMoney } from '../lib/money'
import { computeRealAvailable, realAvailableTone } from '../lib/realAvailable'
import { cardEvents } from '../lib/upcoming'

function sumType(accounts: Account[], type: Account['type']): number {
  return roundMoney(accounts.filter((a) => a.type === type).reduce((sum, a) => sum + a.current_balance, 0))
}

export function Inicio({ onAdd, onOpenAccounts }: { onAdd: (type: AddType) => void; onOpenAccounts: () => void }) {
  const data = useMoneyData()
  const { accounts, cards } = data
  const breakdown = computeRealAvailable({ accounts, cards, buffer: data.settings?.buffer_mxn ?? 0 })
  const opening = findOpeningAccount(accounts)
  const hasMoneyData = accounts.length > 0 || cards.length > 0
  const hasLiquidAccounts = accounts.some((a) => a.type === 'checking' || a.type === 'cash')
  const showOpening = opening ? opening.current_balance !== 0 || !hasLiquidAccounts : !hasLiquidAccounts
  const money = (value: number) => formatMoney(value, 'MXN')
  const today = new Date()
  const upcoming = cardEvents(cards, today, 14)

  const rows = [
    { label: 'Banco', value: breakdown.bank, show: true },
    { label: 'Efectivo', value: breakdown.cash, show: true },
    { label: 'Saldo sin origen', value: breakdown.unassigned, show: breakdown.unassigned !== 0 },
    { label: '− Deuda TDC', value: breakdown.ccReserve, show: true },
    { label: '− Pagos antes del próximo ingreso', value: breakdown.billsBeforeNextIncome, show: true },
    { label: '− Cuotas de préstamos antes del próximo ingreso', value: breakdown.loanInstallmentsBeforeNextIncome, show: true },
    { label: '− Apartados en banco y efectivo', value: breakdown.bucketsInLiquid, show: true },
    { label: '− Colchón', value: breakdown.buffer, show: true },
  ].filter((row) => row.show)
  const scale = Math.max(1, ...rows.map((row) => Math.abs(row.value)))
  const tone = realAvailableTone(breakdown, hasMoneyData)
  const cardDebt = roundMoney(cards.reduce((sum, c) => sum + c.current_balance, 0))

  const chips = [
    { id: 'bank', label: 'Banco', value: accounts.some((a) => a.type === 'checking') ? money(sumType(accounts, 'checking')) : '—' },
    { id: 'cash', label: 'Efectivo', value: accounts.some((a) => a.type === 'cash') ? money(sumType(accounts, 'cash')) : '—' },
    ...(breakdown.unassigned !== 0 ? [{ id: 'unassigned', label: 'Sin origen', value: money(breakdown.unassigned) }] : []),
    { id: 'card', label: 'TDC', value: cards.length > 0 ? money(cardDebt) : '—' },
    { id: 'loans', label: 'Préstamos', value: '—' },
    { id: 'savings', label: 'Ahorro', value: accounts.some((a) => a.type === 'savings') ? money(sumType(accounts, 'savings')) : '—' },
  ]

  return (
    <div className="stage-grid">
      <div className="stage-main">
        <StageHeader title="¿Cuánto tengo de verdad?" share />
        <Rail label="Cuentas" items={chips} onSelect={onOpenAccounts} />
        <div className="verb-row">
          <button type="button" className="verb-button" onClick={() => onAdd('expense')}>
            <span className="key-glyph">G</span>
            Gasto
          </button>
          <button type="button" className="verb-button" onClick={() => onAdd('income')}>
            <span className="key-glyph">I</span>
            Ingreso
          </button>
          <button type="button" className="verb-button" onClick={onOpenAccounts}>
            <span className="key-glyph">C</span>
            Cuentas
          </button>
        </div>
        {showOpening && <OpeningBalancePanel key={opening?.updated_at ?? 'new'} opening={opening} />}
        <Panel title="Próximos 14 días">
          {upcoming.length === 0 ? (
            <FooterHint>Sin pagos ni cortes en los próximos 14 días.</FooterHint>
          ) : (
            <table className="roster">
              <tbody>
                {upcoming.map((event) => {
                  const days = daysBetween(today, event.date)
                  return (
                    <tr key={event.key}>
                      <td className="mono dim">{formatDate(event.date)}</td>
                      <td>
                        {event.label}
                        <span className="row-sub">{days === 0 ? 'Hoy' : days === 1 ? 'Mañana' : `En ${days} días`}</span>
                      </td>
                      <td className={`num mono${event.kind === 'cc_due' && days <= 3 ? ' text-amber' : ''}`}>
                        {event.amount === null ? '—' : money(event.amount)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title="Apartados">
          <FooterHint>Tus apartados aparecerán aquí.</FooterHint>
        </Panel>
      </div>

      <aside className="dossier" aria-label="Disponible real">
        <Panel title="Disponible real">
          <p className={`hero-figure tone-${tone}`}>
            {formatAmount(breakdown.total)}
            <span className="hero-currency">MXN</span>
          </p>
          <div className="stat-list">
            {rows.map((row) => (
              <StatBar
                key={row.label}
                label={row.label}
                value={money(row.value)}
                ratio={Math.abs(row.value) / scale}
                tone={hasMoneyData ? 'safe' : 'empty'}
              />
            ))}
          </div>
          <div className="dossier-total">
            <span>= Seguro para gastar</span>
            <span className="mono">{money(breakdown.total)}</span>
          </div>
        </Panel>
        <FooterHint>
          {!hasMoneyData
            ? 'Agrega tu saldo inicial para calcular tu Disponible real.'
            : breakdown.unassigned !== 0
              ? 'El saldo sin origen cuenta como disponible. Transfiérelo a banco o efectivo cuando quieras.'
              : 'Tu banco no es lo que puedes gastar. Esto sí.'}
        </FooterHint>
      </aside>
    </div>
  )
}
