import { useState } from 'react'
import { FooterHint, Panel } from '../components/hud'
import { StageHeader } from '../components/StageHeader'
import { useMoneyData } from '../db/useMoneyData'
import { formatDate, formatMoney, formatMonth } from '../lib/format'
import { cardEventsInMonth } from '../lib/upcoming'

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

function monthCells(month: Date): Array<number | null> {
  const year = month.getFullYear()
  const index = month.getMonth()
  const leading = (new Date(year, index, 1).getDay() + 6) % 7
  const days = new Date(year, index + 1, 0).getDate()
  return [...Array<null>(leading).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
}

export function Tiempo() {
  const today = new Date()
  const { cards } = useMoneyData()
  const [selectedDay, setSelectedDay] = useState(today.getDate())
  const cells = monthCells(today)
  const events = cardEventsInMonth(cards, today)
  const dayEvents = events.get(selectedDay) ?? []
  const selectedDate = new Date(today.getFullYear(), today.getMonth(), selectedDay)

  return (
    <div className="stage-grid">
      <div className="stage-main">
        <StageHeader title="Tiempo" />
        <Panel title={formatMonth(today)}>
          <div className="calendar" role="grid" aria-label={formatMonth(today)}>
            {WEEKDAYS.map((day, index) => (
              <span key={`${day}-${index}`} className="calendar-weekday" role="columnheader">
                {day}
              </span>
            ))}
            {cells.map((day, index) =>
              day === null ? (
                <span key={index} className="calendar-day" role="gridcell" />
              ) : (
                <button
                  key={index}
                  type="button"
                  role="gridcell"
                  className="calendar-day"
                  aria-current={day === today.getDate() ? 'date' : undefined}
                  aria-selected={day === selectedDay}
                  onClick={() => setSelectedDay(day)}
                >
                  {day}
                  <span className="calendar-marks">
                    {(events.get(day) ?? []).map((event) => (
                      <span key={event.key} className={`calendar-mark mark-${event.kind}`} />
                    ))}
                  </span>
                </button>
              ),
            )}
          </div>
        </Panel>
        <FooterHint>
          {cards.length === 0
            ? 'Todavía no hay ingresos, pagos ni fechas de corte en el calendario.'
            : 'Los ingresos y pagos recurrentes se agregarán aquí en la siguiente fase.'}
        </FooterHint>
      </div>

      <aside className="dossier" aria-label="Detalle del día">
        <Panel title={formatDate(selectedDate)}>
          {dayEvents.length === 0 ? (
            <FooterHint>Nada programado este día.</FooterHint>
          ) : (
            <div className="stat-list">
              {dayEvents.map((event) => (
                <div key={event.key} className="readout">
                  <span>{event.label}</span>
                  <span className="mono">{event.amount === null ? '—' : formatMoney(event.amount, 'MXN')}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </aside>
    </div>
  )
}
