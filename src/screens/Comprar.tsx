import { useState, type ReactNode } from 'react'
import { AmountField, FieldError, FieldNote, RangeField, SelectField, TextField } from '../components/fields'
import { FooterHint, GradeCard, Panel, type Tone } from '../components/hud'
import { newRecord, writeAcross } from '../db/db'
import { selectable } from '../db/accounts'
import type { ProjectionScenario } from '../db/types'
import type { MoneyData } from '../db/useMoneyData'
import { useRecords } from '../db/useRecords'
import { bucketsInLiquid } from '../lib/buckets'
import { expectedIncome, monthKey } from '../lib/budgets'
import { isoToDate, todayIso } from '../lib/dates'
import { formatAmount, formatDate, formatMoney } from '../lib/format'
import { roundMoney } from '../lib/money'
import { parseAmount } from '../lib/parseAmount'
import {
  habitualDailySpend,
  INCOME_SCENARIOS,
  PROJECTION_HORIZON_DAYS,
  projectPurchase,
  type IncomeScenarioId,
  type PurchaseResult,
} from '../lib/projection'

const money = (value: number) => formatMoney(value, 'MXN')
const INCOME_STEP = 500
const EXTRA_STEP = 250
const DAILY_STEP = 10

function resultTone(result: PurchaseResult): Tone {
  if (result.after < 0 || result.lowest.available < 0) return 'shortfall'
  if (result.lowest.available < result.before * 0.1) return 'tight'
  return 'safe'
}

function verdict(result: PurchaseResult): string {
  if (result.after < 0) return `Faltarían ${money(-result.after)} ese día`
  if (result.lowest.available < 0) return `Faltarían ${money(-result.lowest.available)} el ${formatDate(result.lowest.date)}`
  return `Alcanza · sobran ${money(result.lowest.available)}`
}

function toneClass(value: number): string {
  return value < 0 ? ' text-heat' : ''
}

export function Comprar({ data, header }: { data: MoneyData; header: ReactNode }) {
  const today = new Date()
  const saved = useRecords<ProjectionScenario>('projection_scenarios') ?? []
  const baseMonthly = expectedIncome(data.recurring, [], monthKey(today))
  const scheduledMonthly = baseMonthly.source === 'schedule' ? baseMonthly.amount : 0
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayIso())
  const [cardId, setCardId] = useState('')
  const [incomeMonthly, setIncomeMonthly] = useState(scheduledMonthly)
  const [extra, setExtra] = useState(0)
  const habit = habitualDailySpend(data.transactions, today)
  const [dailySpend, setDailySpend] = useState(Math.round(habit.perDay / DAILY_STEP) * DAILY_STEP)
  const [scenario, setScenario] = useState<IncomeScenarioId>('base')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState<string | null>(null)

  const value = parseAmount(amount)
  const cards = selectable(data.cards, [cardId])
  const incomeFactor = scheduledMonthly > 0 ? incomeMonthly / scheduledMonthly : 1
  const input = (factor: number) => ({
    amount: value ?? 0,
    date: date < todayIso() ? todayIso() : date,
    cardId: cardId || null,
    incomeFactor: incomeFactor * factor,
    extraExpenses: extra,
    dailySpend,
  })
  const ready = value !== null && value > 0 && Boolean(date)
  const results = ready ? INCOME_SCENARIOS.map((s) => ({ ...s, result: projectPurchase(data, today, input(s.factor)) })) : []
  const chosen = results.find((r) => r.id === scenario)?.result
  const held = bucketsInLiquid(data.buckets, data.bucketMoves, data.accounts)
  const short = chosen ? Math.max(0, -Math.min(chosen.after, chosen.lowest.available)) : 0
  const horizon = new Date(today.getFullYear(), today.getMonth(), today.getDate() + PROJECTION_HORIZON_DAYS)

  async function save() {
    if (!ready || value === null) return setError('Escribe el monto y la fecha de la compra.')
    const record = newRecord<ProjectionScenario>({
      name: name.trim() || `Compra de ${money(value)}`,
      amount: value,
      date,
      card_id: cardId || null,
      income_monthly: scheduledMonthly > 0 ? incomeMonthly : null,
      extra_expenses: extra,
      daily_spend: dailySpend,
    })
    try {
      await writeAcross([{ store: 'projection_scenarios', put: [record] }])
      setSavedNote(`Guardado: ${record.name}.`)
      setError(null)
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
    }
  }

  function open(record: ProjectionScenario) {
    setAmount(String(record.amount))
    setDate(record.date)
    setCardId(record.card_id && data.cards.some((c) => c.uuid === record.card_id) ? record.card_id : '')
    setIncomeMonthly(record.income_monthly ?? scheduledMonthly)
    setExtra(record.extra_expenses)
    setDailySpend(record.daily_spend ?? 0)
    setName(record.name)
    setSavedNote(null)
  }

  return (
    <div className={`stage-grid${chosen ? '' : ' stage-grid--single'}`}>
      <div className="stage-main">
        {header}
        <Panel title="Compra">
          <div className="form">
            <div className="field-row">
              <AmountField label="Monto (MXN)" value={amount} onChange={(v) => { setAmount(v); setSavedNote(null) }} autoFocus />
              <TextField label="Fecha" type="date" value={date} onChange={(v) => { setDate(v); setSavedNote(null) }} mono />
            </div>
            {cards.length > 0 && (
              <SelectField
                label="Pagar con"
                value={cardId}
                onChange={setCardId}
                options={[{ value: '', label: 'Banco o efectivo' }, ...cards.map((c) => ({ value: c.uuid, label: `Tarjeta ${c.name}` }))]}
              />
            )}
            {scheduledMonthly > 0 ? (
              <RangeField
                label="Ingreso esperado al mes"
                value={incomeMonthly}
                display={money(incomeMonthly)}
                min={0}
                max={Math.ceil((scheduledMonthly * 2) / INCOME_STEP) * INCOME_STEP}
                step={INCOME_STEP}
                onChange={setIncomeMonthly}
              />
            ) : (
              <FieldNote>Sin montos en tus días de ingreso, la proyección no suma ingresos futuros. Agrégalos en Pagos fijos.</FieldNote>
            )}
            <RangeField
              label="Gasto diario habitual"
              value={dailySpend}
              display={money(dailySpend)}
              min={0}
              max={Math.max(2000, Math.ceil((habit.perDay * 3) / 100) * 100)}
              step={DAILY_STEP}
              onChange={setDailySpend}
            />
            <FieldNote>
              {habit.perDay > 0
                ? `Tu promedio de gastos del día a día en los últimos ${habit.days} días es ${money(habit.perDay)}, sin pagos fijos ni cuotas.`
                : 'Aún no hay gastos para calcular tu promedio. Ajusta cuánto gastas al día.'}
            </FieldNote>
            <RangeField
              label="Gastos extra hasta esa fecha"
              value={extra}
              display={money(extra)}
              min={0}
              max={Math.max(20000, Math.ceil((value ?? 0) / EXTRA_STEP) * EXTRA_STEP)}
              step={EXTRA_STEP}
              onChange={setExtra}
            />
          </div>
        </Panel>

        <div className="grade-row">
          {INCOME_SCENARIOS.map((s) => {
            const result = results.find((r) => r.id === s.id)?.result
            return (
              <GradeCard
                key={s.id}
                grade={s.grade}
                title={`${s.title} · ingreso ×${s.factor}`}
                value={result ? money(result.after) : '—'}
                meta={result ? verdict(result) : 'Escribe un monto'}
                tone={result ? resultTone(result) : 'empty'}
                selected={result ? scenario === s.id : undefined}
                onSelect={result ? () => setScenario(s.id) : undefined}
              />
            )
          })}
        </div>

        <Panel title="Requisitos">
          <table className="roster requirements">
            <thead>
              <tr>
                <th scope="col">Concepto</th>
                <th scope="col" className="num">Requerido</th>
                <th scope="col" className="num">Proyectado</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  Disponible real
                  <span className="row-sub">{chosen ? formatDate(chosen.date) : 'El día de la compra'}</span>
                </td>
                <td className="num mono">{ready && value !== null ? money(value) : '—'}</td>
                <td className={`num mono${chosen && chosen.before < (value ?? 0) ? ' text-heat' : ''}`}>{chosen ? money(chosen.before) : '—'}</td>
              </tr>
              <tr>
                <td>Después de comprar</td>
                <td className="num mono">{chosen ? '0 o más' : '—'}</td>
                <td className={`num mono${chosen ? toneClass(chosen.after) : ''}`}>{chosen ? money(chosen.after) : '—'}</td>
              </tr>
              <tr>
                <td>
                  Punto más bajo después
                  <span className="row-sub">{chosen ? `${formatDate(chosen.lowest.date)} · revisado ${PROJECTION_HORIZON_DAYS} días` : `Hasta ${formatDate(horizon)}`}</span>
                </td>
                <td className="num mono">{chosen ? '0 o más' : '—'}</td>
                <td className={`num mono${chosen ? toneClass(chosen.lowest.available) : ''}`}>{chosen ? money(chosen.lowest.available) : '—'}</td>
              </tr>
              {chosen?.card && (
                <tr>
                  <td>
                    Deuda en {chosen.card.card.name}
                    <span className="row-sub">Tu próximo pago sube {money(value ?? 0)}</span>
                  </td>
                  <td className="num mono">{money(chosen.card.card.current_balance)}</td>
                  <td className="num mono">{money(chosen.card.debtAfter)}</td>
                </tr>
              )}
              {chosen && (
                <tr>
                  <td>
                    Apartados en banco y efectivo
                    <span className="row-sub">
                      {short === 0 ? 'No cambian' : held >= short ? 'Alcanzarían a cubrir la diferencia' : 'No alcanzan a cubrir la diferencia'}
                    </span>
                  </td>
                  <td className="num mono">{short > 0 ? money(short) : '—'}</td>
                  <td className="num mono">{money(held)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </Panel>

        {chosen && (
          <Panel title="Guardar escenario">
            <div className="form">
              <TextField label="Nombre" value={name} onChange={setName} placeholder={`Compra de ${money(value ?? 0)}`} />
              <div className="verb-row">
                <button type="button" className="verb-button" onClick={() => void save()}>
                  <span className="key-glyph">S</span>
                  Guardar escenario
                </button>
              </div>
              {savedNote && <FieldNote>{savedNote}</FieldNote>}
              {error && <FieldError>{error}</FieldError>}
            </div>
          </Panel>
        )}

        {saved.length > 0 && (
          <Panel title="Escenarios guardados">
            <table className="roster">
              <tbody>
                {[...saved].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map((record) => (
                  <tr key={record.uuid}>
                    <td>
                      {record.name}
                      <span className="row-sub">{formatDate(isoToDate(record.date))}</span>
                    </td>
                    <td className="num mono">{money(record.amount)}</td>
                    <td className="num">
                      <button type="button" className="panel-verb" onClick={() => open(record)}>
                        Abrir
                      </button>{' '}
                      <button type="button" className="panel-verb" onClick={() => void writeAcross([{ store: 'projection_scenarios', delete: [record.uuid] }])}>
                        Quitar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}

        <FooterHint>
          {!chosen
            ? 'Escribe un monto y una fecha para saber si puedes comprarlo.'
            : short > 0
              ? 'Puedes mover la fecha, bajar el monto o usar apartados. Nada se guarda hasta que tú lo registres.'
              : 'La proyección suma tus ingresos programados y resta pagos fijos, cuotas, tu gasto diario y apartados. No registra nada.'}
          {chosen && chosen.unknownIncome > 0 ? ' Los ingresos sin monto no se cuentan.' : ''}
        </FooterHint>
      </div>

      {chosen && (
        <aside className="dossier" aria-label="Disponible real por ingreso">
          <Panel title="Disponible real por ingreso">
            <p className={`hero-figure tone-${resultTone(chosen)}`}>
              {formatAmount(chosen.after)}
              <span className="hero-currency">MXN</span>
            </p>
            <table className="roster">
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col" className="num">Después de comprar</th>
                </tr>
              </thead>
              <tbody>
                {chosen.checkpoints.map((point, index) => (
                  <tr key={point.date.getTime()}>
                    <td className="mono dim">
                      {formatDate(point.date)}
                      {index === 0 && <span className="row-sub">Día de la compra</span>}
                    </td>
                    <td className={`num mono${toneClass(point.available)}`}>{money(roundMoney(point.available))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <FooterHint>Cada fila es un día de ingreso, ya con sus pagos reservados.</FooterHint>
          </Panel>
        </aside>
      )}
    </div>
  )
}
