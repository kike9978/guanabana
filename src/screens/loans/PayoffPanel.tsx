import { useMemo, useState } from 'react'
import { AmountField, FieldNote } from '../../components/fields'
import { FooterHint, GradeCard, Panel, type Tone } from '../../components/hud'
import type { Loan } from '../../db/types'
import type { MoneyData } from '../../db/useMoneyData'
import { isoToDate } from '../../lib/dates'
import { formatCompact, formatDate, formatMoney } from '../../lib/format'
import { incomeDatesBetween, loanSeries, openRows, payoffOptions, withSchedule, type PayoffOptionId, type TimelinePoint } from '../../lib/loanTimeline'
import { summarizeLoan } from '../../lib/loans'
import { parseAmount } from '../../lib/parseAmount'
import { habitualDailySpend } from '../../lib/projection'

const money = (value: number) => formatMoney(value, 'MXN')

function pointTone(point: TimelinePoint): Tone {
  if (point.available < 0) return 'shortfall'
  if (point.installments > 0 && point.available < point.installments) return 'tight'
  return 'safe'
}

const TONE_CLASS: Record<Tone, string> = { safe: '', tight: ' text-amber', shortfall: ' text-heat', empty: ' dim' }

export function SeriesTable({ series }: { series: TimelinePoint[] }) {
  return (
    <table className="roster requirements">
      <thead>
        <tr>
          <th scope="col">Ingreso</th>
          <th scope="col" className="num">Cuotas</th>
          <th scope="col" className="num">Disponible real</th>
        </tr>
      </thead>
      <tbody>
        {series.map((point, index) => (
          <tr key={point.date.getTime()}>
            <td className="mono wrap">
              {formatDate(point.date)}
              <span className="row-sub">
                {index === 0 ? 'Hoy' : point.freed > 0 ? `Cuota liberada +${formatCompact(point.freed)}` : ''}
                {point.payoffs.length > 0 && `${index === 0 ? ' · ' : ''}Termina ${point.payoffs.join(', ')}`}
              </span>
            </td>
            <td className="num mono">{point.installments > 0 ? money(point.installments) : '—'}</td>
            <td className={`num mono${TONE_CLASS[pointTone(point)]}`}>{money(point.available)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function PayoffPanel({ loan, data }: { loan: Loan; data: MoneyData }) {
  const today = useMemo(() => new Date(), [])
  const open = openRows(loan, data)
  const [extra, setExtra] = useState(open[0] ? String(open[0].amount) : '')
  const [chosen, setChosen] = useState<PayoffOptionId>('scheduled')
  const extraValue = parseAmount(extra) ?? 0
  const summary = summarizeLoan(loan, data.installments, data.transactions)

  const plans = useMemo(() => {
    const dailySpend = habitualDailySpend(data.transactions, today).perDay
    const last = open.at(-1)?.due_date
    const incomes = last ? incomeDatesBetween(data, today, isoToDate(last)) : []
    return payoffOptions(loan, data, today, Math.max(0, extraValue), incomes).map((option) => {
      const series = loanSeries(withSchedule(data, loan, option.rows), [loan], today, { dailySpend })
      const lowest = series.reduce((min, point) => (point.available < min.available ? point : min), series[0])
      return { option, series, lowest }
    })
  }, [data, loan, today, extraValue, open])

  if (open.length === 0 || summary.remaining <= 0) return null
  const selected = plans.find((plan) => plan.option.id === chosen) ?? plans[0]
  const titles: Record<PayoffOptionId, string> = {
    scheduled: 'Pagar como está',
    extra: extraValue > 0 ? `Abono de ${money(extraValue)} por ingreso` : 'Abono por ingreso',
    now: 'Liquidar hoy',
  }

  return (
    <Panel title="¿Hasta cuándo?">
      <AmountField label="Abono extra por ingreso (MXN)" value={extra} onChange={setExtra} />
      <div className="grade-row">
        {plans.map(({ option, lowest }, index) => (
          <GradeCard
            key={option.id}
            grade={`Opción ${index + 1}`}
            title={titles[option.id]}
            value={option.payoffDate ? formatDate(isoToDate(option.payoffDate)) : '—'}
            meta={`Interés ${money(summary.interestPaid + option.futureInterest)} · mínimo ${money(lowest.available)}`}
            tone={lowest.available < 0 ? 'shortfall' : lowest.available < (open[0]?.amount ?? 0) ? 'tight' : 'safe'}
            selected={chosen === option.id}
            onSelect={() => setChosen(option.id)}
          />
        ))}
      </div>
      <SeriesTable series={selected.series} />
      <FooterHint>
        {selected.lowest.available < 0
          ? `Con esta opción tu Disponible real bajaría a ${money(selected.lowest.available)} el ${formatDate(selected.lowest.date)}.`
          : `Tu punto más bajo sería ${money(selected.lowest.available)} el ${formatDate(selected.lowest.date)}.`}
      </FooterHint>
      <FieldNote>
        Es una proyección con tus ingresos, pagos fijos y gasto diario habitual; no cambia el préstamo. Para aplicar un abono usa Abono extra.
        {chosen === 'now' && ' Revisa con quien te prestó si cobra comisión por pago anticipado.'}
      </FieldNote>
    </Panel>
  )
}
