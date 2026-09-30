import { useState } from 'react'
import type { AddPrefill, AddType, SubScreen } from '../app/navigation'
import { FooterHint, Panel } from '../components/hud'
import { StageHeader } from '../components/StageHeader'
import { useMoneyData } from '../db/useMoneyData'
import { dateToIso } from '../lib/dates'
import { formatCompact, formatDate, formatMoney, formatMonth } from '../lib/format'
import { dailyProjection, habitualDailySpend } from '../lib/projection'
import { groupByDay, timeline, type TimelineKind } from '../lib/timeline'

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

const KIND_LABEL: Record<TimelineKind, string> = {
  cc_due: 'Pago TDC',
  cc_statement: 'Corte TDC',
  bill: 'Pago fijo',
  income: 'Ingreso',
  loan: 'Cuota',
  loan_receivable: 'Cobro',
}

const LEGEND: TimelineKind[] = ['income', 'bill', 'loan', 'cc_due', 'cc_statement']

function monthCells(month: Date): Array<number | null> {
  const year = month.getFullYear()
  const index = month.getMonth()
  const leading = (new Date(year, index, 1).getDay() + 6) % 7
  const days = new Date(year, index + 1, 0).getDate()
  return [...Array<null>(leading).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
}

export function Tiempo({
  onAdd,
  onOpenScreen,
}: {
  onAdd: (type: AddType, prefill?: AddPrefill) => void
  onOpenScreen: (screen: SubScreen) => void
}) {
  const today = new Date()
  const data = useMoneyData()
  const [offset, setOffset] = useState(0)
  const [selectedDay, setSelectedDay] = useState(today.getDate())
  const month = new Date(today.getFullYear(), today.getMonth() + offset, 1)
  const isCurrentMonth = offset === 0
  const cells = monthCells(month)
  const events = groupByDay(timeline(data, month, new Date(month.getFullYear(), month.getMonth() + 1, 1)))
  const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const day = Math.min(selectedDay, lastDay)
  const dayEvents = events.get(day) ?? []
  const selectedDate = new Date(month.getFullYear(), month.getMonth(), day)
  const empty = data.loaded && data.cards.length === 0 && data.recurring.length === 0 && data.loans.length === 0
  const dailySpend = habitualDailySpend(data.transactions, today).perDay
  const projection = data.loaded
    ? dailyProjection(data, today, month, new Date(month.getFullYear(), month.getMonth() + 1, 1), { dailySpend })
    : new Map<string, number>()
  const projectedOn = (cell: number) => projection.get(dateToIso(new Date(month.getFullYear(), month.getMonth(), cell, 12)))
  const selectedProjection = projectedOn(day)

  function shift(delta: number) {
    setOffset(offset + delta)
    setSelectedDay(offset + delta === 0 ? today.getDate() : 1)
  }

  return (
    <div className="stage-grid">
      <div className="stage-main">
        <StageHeader title="Tiempo" />
        <div className="verb-row">
          <button type="button" className="verb-button" onClick={() => onOpenScreen('commitments')}>
            <span className="key-glyph">F</span>
            Pagos fijos
          </button>
          <button type="button" className="verb-button" onClick={() => onOpenScreen('loans')}>
            <span className="key-glyph">L</span>
            Préstamos
          </button>
        </div>
        <Panel
          title={formatMonth(month)}
          aside={
            <span className="panel-verbs">
              <button type="button" className="panel-verb" aria-label="Mes anterior" onClick={() => shift(-1)}>
                ‹
              </button>
              {!isCurrentMonth && (
                <button type="button" className="panel-verb" onClick={() => shift(-offset)}>
                  Hoy
                </button>
              )}
              <button type="button" className="panel-verb" aria-label="Mes siguiente" onClick={() => shift(1)}>
                ›
              </button>
            </span>
          }
        >
          <div className="calendar" role="grid" aria-label={formatMonth(month)}>
            {WEEKDAYS.map((weekday, index) => (
              <span key={`${weekday}-${index}`} className="calendar-weekday" role="columnheader">
                {weekday}
              </span>
            ))}
            {cells.map((cell, index) =>
              cell === null ? (
                <span key={index} className="calendar-day" role="gridcell" />
              ) : (
                <button
                  key={index}
                  type="button"
                  role="gridcell"
                  className="calendar-day"
                  aria-current={isCurrentMonth && cell === today.getDate() ? 'date' : undefined}
                  aria-selected={cell === day}
                  onClick={() => setSelectedDay(cell)}
                >
                  {cell}
                  {projectedOn(cell) !== undefined && (
                    <span className={`calendar-projection${projectedOn(cell)! < 0 ? ' text-heat' : ''}`}>{formatCompact(projectedOn(cell)!)}</span>
                  )}
                  <span className="calendar-marks">
                    {(events.get(cell) ?? []).map((event) => (
                      <span key={event.key} className={`calendar-mark mark-${event.kind}${event.paid ? ' mark-paid' : ''}`} />
                    ))}
                  </span>
                </button>
              ),
            )}
          </div>
          <div className="calendar-legend">
            {LEGEND.map((kind) => (
              <span key={kind} className="legend-item">
                <span className={`calendar-mark mark-${kind}`} />
                {KIND_LABEL[kind]}
              </span>
            ))}
          </div>
        </Panel>
        <FooterHint>
          {empty
            ? 'Agrega tus días de ingreso, pagos fijos, tarjetas o préstamos para verlos en el calendario.'
            : 'Los puntos apagados ya están registrados.'}
        </FooterHint>
        {projection.size > 0 && (
          <FooterHint>
            {dailySpend > 0
              ? `La cifra de cada día es tu Disponible real proyectado, con tus ingresos y pagos programados y tu gasto diario habitual (${formatMoney(dailySpend, 'MXN')}).`
              : 'La cifra de cada día es tu Disponible real proyectado, con tus ingresos y pagos programados.'}
          </FooterHint>
        )}
      </div>

      <aside className="dossier" aria-label="Detalle del día">
        <Panel title={formatDate(selectedDate)}>
          {selectedProjection !== undefined && (
            <div className="readout">
              <span className="dim">Disponible real proyectado</span>
              <span className={`mono${selectedProjection < 0 ? ' text-heat' : ''}`}>{formatMoney(selectedProjection, 'MXN')}</span>
            </div>
          )}
          {dayEvents.length === 0 ? (
            <FooterHint>Nada programado este día.</FooterHint>
          ) : (
            <div className="stat-list">
              {dayEvents.map((event) => (
                <div key={event.key} className="day-event">
                  <div className="readout">
                    <span>
                      {event.label}
                      <span className="row-sub">
                        {KIND_LABEL[event.kind]}
                        {event.paid && ' · Registrado'}
                      </span>
                    </span>
                    <span className={`mono${event.paid ? ' dim' : ''}`}>{event.amount === null ? '—' : formatMoney(event.amount, 'MXN')}</span>
                  </div>
                  {event.action && !event.paid && (
                    <button type="button" className="panel-verb" onClick={() => onAdd(event.action!.type, event.action!.prefill)}>
                      {event.action.type === 'income' ? 'Registrar ingreso' : 'Registrar pago'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </aside>
    </div>
  )
}
