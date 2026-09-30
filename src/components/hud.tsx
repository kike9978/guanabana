import type { ReactNode } from 'react'

export type Tone = 'safe' | 'tight' | 'shortfall' | 'empty'

export function Panel({
  title,
  aside,
  children,
  className = '',
}: {
  title?: string
  aside?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <header className="panel-head">
          <h2 className="panel-title">{title}</h2>
          {aside}
        </header>
      )}
      <div className="panel-body">{children}</div>
    </section>
  )
}

export function FooterHint({ children }: { children: ReactNode }) {
  return <p className="footer-hint">{children}</p>
}

export interface RailItem<T extends string> {
  id: T
  label: string
  value?: string
}

export function Rail<T extends string>({
  items,
  active,
  onSelect,
  label,
}: {
  items: readonly RailItem<T>[]
  active?: T
  onSelect?: (id: T) => void
  label: string
}) {
  return (
    <nav className="rail" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="rail-chip"
          aria-pressed={active === undefined ? undefined : active === item.id}
          disabled={!onSelect}
          onClick={() => onSelect?.(item.id)}
        >
          <span className="rail-label">{item.label}</span>
          {item.value !== undefined && <span className="rail-value">{item.value}</span>}
        </button>
      ))}
    </nav>
  )
}

export interface SeriesColumn {
  key: string
  label: string
  value: number
  previous?: number
  display: string
}

/** One cyan meter per column. The amber tick is the previous window only. */
export function Series({
  columns,
  selected,
  onSelect,
  label,
}: {
  columns: SeriesColumn[]
  selected?: string | null
  onSelect?: (key: string) => void
  label: string
}) {
  const max = Math.max(1, ...columns.flatMap((c) => [c.value, c.previous ?? 0]))
  const percent = (value: number) => `${Math.round((Math.max(0, value) / max) * 100)}%`
  return (
    <div className={`series${columns.length > 8 ? ' series--dense' : ''}`} role="group" aria-label={label}>
      {columns.map((column) => (
        <button
          key={column.key}
          type="button"
          className="series-col"
          aria-pressed={selected === column.key}
          aria-label={`${column.label}: ${column.display}`}
          onClick={() => onSelect?.(column.key)}
        >
          <span className="series-value">{column.display}</span>
          <span className="series-track">
            <span className="series-fill" style={{ height: percent(column.value) }} />
            {column.previous !== undefined && column.previous > 0 && (
              <span className="series-previous" style={{ bottom: percent(column.previous) }} aria-hidden="true" />
            )}
          </span>
          <span className="series-label">{column.label}</span>
        </button>
      ))}
    </div>
  )
}

export function StatBar({
  label,
  value,
  ratio,
  tone = 'safe',
  marker,
}: {
  label: string
  value: string
  ratio: number
  tone?: Tone
  marker?: number
}) {
  const percent = (value: number) => `${Math.round(Math.min(Math.max(value, 0), 1) * 100)}%`
  return (
    <div className={`stat-bar tone-${tone}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-track">
        <span className="stat-fill" style={{ width: percent(ratio) }} />
        {marker !== undefined && <span className="stat-marker" style={{ left: percent(marker) }} aria-hidden="true" />}
      </span>
      <span className="stat-value">{value}</span>
    </div>
  )
}

export function GradeCard({
  grade,
  title,
  value,
  meta,
  tone = 'safe',
  progress,
  selected,
  onSelect,
}: {
  grade: string
  title: string
  value: string
  meta: string
  tone?: Tone
  progress?: number
  selected?: boolean
  onSelect?: () => void
}) {
  const body = (
    <>
      <span className="grade-head">{grade}</span>
      <span className="grade-body">
        <span className="grade-title">{title}</span>
        <span className="grade-value">{value}</span>
        {progress !== undefined && (
          <span className="stat-track">
            <span className="stat-fill" style={{ width: `${Math.round(Math.min(Math.max(progress, 0), 1) * 100)}%` }} />
          </span>
        )}
        <span className="grade-meta">{meta}</span>
      </span>
    </>
  )
  if (!onSelect) return <article className={`grade-card tone-${tone}`}>{body}</article>
  return (
    <button type="button" className={`grade-card tone-${tone}`} aria-pressed={selected} onClick={onSelect}>
      {body}
    </button>
  )
}
