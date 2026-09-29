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

export function StatBar({
  label,
  value,
  ratio,
  tone = 'safe',
}: {
  label: string
  value: string
  ratio: number
  tone?: Tone
}) {
  const width = `${Math.round(Math.min(Math.max(ratio, 0), 1) * 100)}%`
  return (
    <div className={`stat-bar tone-${tone}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-track">
        <span className="stat-fill" style={{ width }} />
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
