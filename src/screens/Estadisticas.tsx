import { useState, type ReactNode } from 'react'
import { useDossierSheet } from '../components/mobile'
import { FooterHint, Panel, Rail, Series, StatBar } from '../components/hud'
import { UNCATEGORIZED_KEY } from '../db/seed'
import type { MoneyData } from '../db/useMoneyData'
import { formatAmount, formatCompact, formatMoney } from '../lib/format'
import {
  expenseStats,
  METHOD_LABEL,
  rangeLabel,
  STATS_WINDOWS,
  windowRanges,
  type CategoryStat,
  type ExpenseFocus,
  type Range,
  type StatsWindow,
} from '../lib/stats'

const money = (value: number) => formatMoney(value, 'MXN')

function percent(share: number): string {
  return `${Math.round(share * 100)}%`
}

function SubcategoryDossier({
  row,
  range,
  onFocus,
  onClose,
}: {
  row: CategoryStat
  range: Range
  onFocus: (focus: ExpenseFocus) => void
  onClose: () => void
}) {
  const parent = row.category
  return (
    <Panel
      title={parent.name}
      aside={
        <button type="button" className="panel-verb" onClick={onClose}>
          Cerrar
        </button>
      }
    >
      <p className="hero-figure">
        {formatAmount(row.amount)}
        <span className="hero-currency">MXN</span>
      </p>
      <div className="stat-list">
        {row.children.map((child) => {
          const name = child.category?.name ?? 'Sin subcategoría'
          return (
            <button
              key={child.category?.uuid ?? 'none'}
              type="button"
              className="stat-button"
              onClick={() =>
                onFocus({
                  label: `${parent.name} · ${name}`,
                  range,
                  categoryId: child.category?.uuid ?? parent.uuid,
                  exact: child.category === null,
                })
              }
            >
              <StatBar
                label={child.over && child.budget !== null ? `${name} · límite ${money(child.budget)}` : name}
                value={`${money(child.amount)} · ${percent(child.share)}`}
                ratio={child.share}
                tone={child.over ? 'shortfall' : child.category ? 'safe' : 'empty'}
              />
            </button>
          )
        })}
      </div>
      <div className="verb-row">
        <button type="button" className="verb-button" onClick={() => onFocus({ label: parent.name, range, categoryId: parent.uuid })}>
          <span className="key-glyph">M</span>
          Ver todos sus movimientos
        </button>
      </div>
      <FooterHint>Las subcategorías suman el total de {parent.name}.</FooterHint>
    </Panel>
  )
}

export function Estadisticas({
  header,
  data,
  span,
  onSpan,
  onFocus,
}: {
  header: ReactNode
  data: MoneyData
  span: StatsWindow
  onSpan: (span: StatsWindow) => void
  onFocus: (focus: ExpenseFocus) => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const dossierRef = useDossierSheet(selected, () => setSelected(null))
  const today = new Date()
  const ranges = windowRanges(span, data.recurring, today)
  const fallbackId = data.categories.find((c) => c.key === UNCATEGORIZED_KEY)?.uuid ?? null
  const stats = expenseStats(data, ranges, fallbackId)
  const change = stats.previousTotal > 0 ? (stats.total - stats.previousTotal) / stats.previousTotal : null
  const period = rangeLabel(ranges.current)
  const selectedRow = stats.byCategory.find((row) => row.category.uuid === selected && row.children.length > 0)

  return (
    <div className={`stage-grid${selectedRow ? '' : ' stage-grid--single'}`}>
      <div className="stage-main">
        {header}
        <Rail label="Ventana" items={STATS_WINDOWS} active={span} onSelect={onSpan} />
        <Panel title="Total gastado" aside={<span className="dim">{period}</span>}>
          <p className={`hero-figure${stats.count === 0 ? ' tone-empty' : ''}`}>
            {formatAmount(stats.total)}
            <span className="hero-currency">MXN</span>
          </p>
          <div className="readout">
            <span className="dim">Ventana anterior · {rangeLabel(ranges.previous)}</span>
            <span className="mono">
              {money(stats.previousTotal)}
              {change !== null && ` · ${change > 0 ? '+' : ''}${percent(change)}`}
            </span>
          </div>
        </Panel>

        {stats.count === 0 ? (
          <Panel>
            <FooterHint>Sin gastos en esta ventana.</FooterHint>
          </Panel>
        ) : (
          <>
            <Panel title="Por tipo de gasto">
              <div className="stat-list">
                {stats.byCategory.map((row) => (
                  <button
                    key={row.category.uuid}
                    type="button"
                    className="stat-button"
                    aria-pressed={row.children.length > 0 ? row.category.uuid === selected : undefined}
                    onClick={() =>
                      row.children.length > 0
                        ? setSelected(row.category.uuid === selected ? null : row.category.uuid)
                        : onFocus({ label: row.category.name, range: ranges.current, categoryId: row.category.uuid })
                    }
                  >
                    <StatBar
                      label={`${row.over && row.budget !== null ? `${row.category.name} · límite ${money(row.budget)}` : row.category.name}${row.children.length > 0 ? ' ›' : ''}`}
                      value={`${money(row.amount)} · ${percent(row.share)}`}
                      ratio={row.share}
                      tone={row.over ? 'shortfall' : 'safe'}
                    />
                  </button>
                ))}
              </div>
            </Panel>

            <Panel title="En el tiempo">
              <Series
                label="Gasto en el tiempo"
                columns={stats.series.map((point) => ({
                  key: point.range.from,
                  label: point.label,
                  value: point.amount,
                  previous: point.previous,
                  display: point.amount === 0 ? '—' : formatCompact(point.amount),
                }))}
                onSelect={(key) => {
                  const point = stats.series.find((p) => p.range.from === key)
                  if (point) onFocus({ label: 'Todos los gastos', range: point.range })
                }}
              />
            </Panel>

            <Panel title="Por método">
              <div className="stat-list">
                {stats.byMethod.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className="stat-button"
                    onClick={() => onFocus({ label: METHOD_LABEL[row.id], range: ranges.current, method: row.id })}
                  >
                    <StatBar label={METHOD_LABEL[row.id]} value={`${money(row.amount)} · ${percent(row.share)}`} ratio={row.share} tone={row.amount === 0 ? 'empty' : 'safe'} />
                  </button>
                ))}
              </div>
            </Panel>

            <FooterHint>
              Solo cuentan gastos; los reembolsos los restan. La línea ámbar es la ventana anterior. Toca una barra para ver sus movimientos.
            </FooterHint>
          </>
        )}
      </div>
      {selectedRow && (
        <aside ref={dossierRef} className="dossier dossier-sheet" tabIndex={-1} aria-label={selectedRow.category.name}>
          <SubcategoryDossier row={selectedRow} range={ranges.current} onFocus={onFocus} onClose={() => setSelected(null)} />
        </aside>
      )}
    </div>
  )
}
