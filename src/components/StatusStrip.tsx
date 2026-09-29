import type { DbStatus } from '../db/useLocalDb'
import { useMoneyData } from '../db/useMoneyData'
import { cycleProgress, incomeCycle } from '../lib/cycle'
import { daysBetween } from '../lib/dates'
import { formatTime } from '../lib/format'
import { useClock } from '../lib/useClock'

const DB_LABEL: Record<DbStatus['state'], string> = {
  opening: 'Abriendo datos',
  ready: 'Datos locales',
  error: 'Sin acceso a datos',
}

function daysLabel(days: number): string {
  if (days <= 0) return 'Hoy'
  if (days === 1) return 'Mañana'
  return `En ${days} días`
}

export function StatusStrip({ path, db }: { path: string[]; db: DbStatus }) {
  const now = useClock()
  const { recurring } = useMoneyData()
  const cycle = incomeCycle(recurring, now)
  const progress = cycle.hasSchedule ? cycleProgress(cycle, now) : 0
  const value = cycle.nextIncome ? daysLabel(daysBetween(now, cycle.nextIncome)) : '—'

  return (
    <header className="status-strip">
      <div className="status-id">
        <span className="status-version">GUANABANA VER 0.1</span>
        <span className="status-path">{path.join(' › ')}</span>
      </div>

      <div className="status-meter" aria-label={cycle.nextIncome ? `Próximo ingreso: ${value}` : 'Próximo ingreso: sin fecha'}>
        <span className="meter-label">Próx. ingreso</span>
        <span className="meter-track">
          <span className="meter-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
        </span>
        <span className="meter-value">{value}</span>
      </div>

      <div className="status-end">
        <span className={`status-db db-${db.state}`} title={db.state === 'error' ? db.message : undefined}>
          {DB_LABEL[db.state]}
        </span>
        <time className="status-clock" dateTime={now.toISOString()}>
          {formatTime(now)}
        </time>
      </div>
    </header>
  )
}
