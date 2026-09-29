import type { DbStatus } from '../db/useLocalDb'
import { formatTime } from '../lib/format'
import { useClock } from '../lib/useClock'

const DB_LABEL: Record<DbStatus['state'], string> = {
  opening: 'Abriendo datos',
  ready: 'Datos locales',
  error: 'Sin acceso a datos',
}

export function StatusStrip({ path, db }: { path: string[]; db: DbStatus }) {
  const now = useClock()

  return (
    <header className="status-strip">
      <div className="status-id">
        <span className="status-version">PUENTE VER 0.1</span>
        <span className="status-path">{path.join(' › ')}</span>
      </div>

      <div className="status-meter" aria-label="Próximo ingreso: sin fecha">
        <span className="meter-label">Próx. ingreso</span>
        <span className="meter-track">
          <span className="meter-fill" style={{ width: '0%' }} />
        </span>
        <span className="meter-value">—</span>
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
