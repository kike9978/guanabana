import { useState, type FormEvent, type ReactNode } from 'react'
import { useDossierSheet } from '../components/mobile'
import { AmountField, FieldError, FieldNote, FormActions, SelectField } from '../components/fields'
import { FooterHint, GradeCard, Panel, StatBar } from '../components/hud'
import { removeBudget, setBudget } from '../db/budgets'
import { UNCATEGORIZED_KEY } from '../db/seed'
import type { Category, PlanItem } from '../db/types'
import type { MoneyData } from '../db/useMoneyData'
import { useRecords } from '../db/useRecords'
import {
  budgetIncomeBasis,
  budgetRows,
  budgetTone,
  budgetTotals,
  expectedIncome,
  plannedByCategory,
  limitFor,
  monthKey,
  monthPace,
  shiftMonth,
  type BudgetRow,
} from '../lib/budgets'
import { categoryOptions } from '../lib/categories'
import { formatAmount, formatMoney } from '../lib/format'
import { roundMoney } from '../lib/money'
import { parseAmount } from '../lib/parseAmount'

const NEW_LIMIT = 'new'

const money = (value: number) => formatMoney(value, 'MXN')

function monthLabel(month: string): string {
  const [year, index] = month.split('-').map(Number)
  const label = new Date(year, index - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function LimitForm({
  data,
  category,
  month,
  onDone,
}: {
  data: MoneyData
  category: Category | null
  month: string
  onDone: (categoryId: string | null) => void
}) {
  const unbudgeted = categoryOptions(data.categories, 'expense').filter((option) => !limitFor(data.budgets, option.value, month))
  const [categoryId, setCategoryId] = useState(category?.uuid ?? unbudgeted[0]?.value ?? '')
  const budget = limitFor(data.budgets, categoryId, month)
  const [limit, setLimit] = useState(budget ? String(budget.limit_mxn) : '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  if (!category && unbudgeted.length === 0) {
    return <FieldNote>Todas tus categorías de gasto ya tienen límite.</FieldNote>
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const value = parseAmount(limit)
    if (!categoryId) return setError('Elige una categoría.')
    if (value === null || value <= 0) return setError('Escribe un límite mayor a cero.')
    setSaving(true)
    try {
      await setBudget(budget, categoryId, value)
      onDone(categoryId)
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      {!category && (
        <SelectField label="Categoría" value={categoryId} onChange={setCategoryId} options={unbudgeted} />
      )}
      <AmountField label="Límite al mes (MXN)" value={limit} onChange={(v) => { setLimit(v); setError(null) }} invalid={error !== null} autoFocus />
      <FieldNote>El límite se repite cada mes hasta que lo cambies.</FieldNote>
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel={budget ? 'Guardar límite' : 'Poner límite'} saving={saving} onCancel={() => onDone(category?.uuid ?? null)} />
    </form>
  )
}

function CategoryDossier({
  row,
  parent,
  data,
  month,
  pace,
  onSelect,
  onClose,
}: {
  row: BudgetRow
  parent: BudgetRow | null
  data: MoneyData
  month: string
  pace: number
  onSelect: (categoryId: string) => void
  onClose: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const onPace = row.limit === null ? null : roundMoney(row.limit * pace)

  async function remove() {
    if (!row.budget) return
    setError(null)
    try {
      await removeBudget(row.budget)
    } catch {
      setError('No se pudo quitar. Intenta de nuevo.')
    }
  }

  const aboveParent = parent !== null && parent.limit !== null && row.limit !== null && row.limit > parent.limit

  return (
    <Panel
      title={parent ? `${parent.category.name} · ${row.category.name}` : row.category.name}
      aside={
        <button type="button" className="panel-verb" onClick={onClose}>
          Cerrar
        </button>
      }
    >
      <p className={`hero-figure tone-${row.tone === 'empty' ? 'safe' : row.tone}`}>
        {formatAmount(row.spent)}
        <span className="hero-currency">MXN</span>
      </p>
      <div className="stat-list">
        {row.limit !== null && (
          <StatBar label={`Límite ${money(row.limit)}`} value={`${Math.round(row.ratio * 100)}%`} ratio={row.ratio} tone={row.tone} marker={pace} />
        )}
        {row.remaining !== null && (
          <div className="readout">
            <span className="dim">{row.remaining >= 0 ? 'Te queda' : 'Pasaste el límite por'}</span>
            <span className={`mono${row.remaining < 0 ? ' text-heat' : ''}`}>{money(Math.abs(row.remaining))}</span>
          </div>
        )}
        {onPace !== null && pace > 0 && pace < 1 && (
          <div className="readout">
            <span className="dim">Al ritmo del límite, a hoy</span>
            <span className="mono">{money(onPace)}</span>
          </div>
        )}
      </div>
      {editing || row.limit === null ? (
        <LimitForm data={data} category={row.category} month={month} onDone={() => setEditing(false)} />
      ) : (
        <div className="verb-row">
          <button type="button" className="verb-button" onClick={() => setEditing(true)}>
            <span className="key-glyph">E</span>
            Cambiar límite
          </button>
          <button type="button" className="verb-button" onClick={() => void remove()}>
            <span className="key-glyph">X</span>
            Quitar límite
          </button>
        </div>
      )}
      {parent && (
        <button type="button" className="panel-verb" onClick={() => onSelect(parent.category.uuid)}>
          ‹ {parent.category.name}
        </button>
      )}
      {row.budget?.month === null && row.limit !== null && !editing && <FieldNote>Quitar el límite no borra tus gastos.</FieldNote>}
      {aboveParent && parent?.limit != null && (
        <FieldNote>Este límite es mayor que el de {parent.category.name} ({money(parent.limit)}). El de {parent.category.name} se alcanza primero.</FieldNote>
      )}
      {parent && <FieldNote>Lo que gastas aquí también cuenta en {parent.category.name}. Este límite no se suma al total del mes.</FieldNote>}
      {error && <FieldError>{error}</FieldError>}
      {row.children.length > 0 && (
        <>
          <h3 className="field-label">Subcategorías</h3>
          <div className="stat-list">
            {row.children.map((child) => (
              <button key={child.category.uuid} type="button" className="stat-button" onClick={() => onSelect(child.category.uuid)}>
                <StatBar
                  label={child.category.archived ? `${child.category.name} · archivada` : child.category.name}
                  value={child.limit === null ? money(child.spent) : `${money(child.spent)} / ${money(child.limit)}`}
                  ratio={child.limit === null ? (row.spent > 0 ? child.spent / row.spent : 0) : child.ratio}
                  tone={child.limit === null ? 'empty' : child.tone}
                  marker={child.limit === null ? undefined : pace}
                />
              </button>
            ))}
            {row.unassigned !== 0 && (
              <StatBar label="Sin subcategoría" value={money(row.unassigned)} ratio={row.spent > 0 ? row.unassigned / row.spent : 0} tone="empty" />
            )}
          </div>
        </>
      )}
    </Panel>
  )
}

export function Presupuesto({ data, header }: { data: MoneyData; header: ReactNode }) {
  const today = new Date()
  const [month, setMonth] = useState(monthKey(today))
  const [selected, setSelected] = useState<string | null>(null)
  const dossierRef = useDossierSheet(selected, () => setSelected(null))
  const wishes = useRecords<PlanItem>('plan_items') ?? []
  const planned = plannedByCategory(wishes, data.transactions, month)
  const fallbackId = data.categories.find((c) => c.key === UNCATEGORIZED_KEY)?.uuid ?? null
  const rows = budgetRows(data.budgets, data.categories, data.transactions, month, today, fallbackId, planned)
  const plannedOf = (ids: string[]) => roundMoney(ids.reduce((sum, id) => sum + (planned.get(id) ?? 0), 0))
  const totals = budgetTotals(rows)
  const income = expectedIncome(data.recurring, data.transactions, month)
  const incomeBasis = budgetIncomeBasis(data.recurring, data.transactions, month)
  const pace = monthPace(month, today)
  const selectedParent = rows.find((row) => row.children.some((child) => child.category.uuid === selected)) ?? null
  const selectedRow = rows.find((row) => row.category.uuid === selected) ?? selectedParent?.children.find((child) => child.category.uuid === selected)
  const creating = selected === NEW_LIMIT
  const budgeted = rows.filter((row) => row.limit !== null)
  const loose = rows.filter((row) => row.limit === null)
  const share = incomeBasis > 0 ? Math.round((totals.budgeted / incomeBasis) * 100) : null
  const overall = budgetTone(totals.spentInBudgets, totals.budgeted || null, pace)

  return (
    <div className={`stage-grid${selectedRow || creating ? '' : ' stage-grid--single'}`}>
      <div className="stage-main">
        {header}
        <div className="verb-row">
          <button type="button" className="verb-button" aria-label="Mes anterior" onClick={() => setMonth(shiftMonth(month, -1))}>
            ‹
          </button>
          <span className="month-label">{monthLabel(month)}</span>
          <button type="button" className="verb-button" aria-label="Mes siguiente" onClick={() => setMonth(shiftMonth(month, 1))}>
            ›
          </button>
          <button type="button" className="verb-button" onClick={() => setSelected(NEW_LIMIT)}>
            <span className="key-glyph">N</span>
            Nuevo límite
          </button>
        </div>
        <div className="grade-row">
          <GradeCard
            grade="Presupuestado"
            title="Límites del mes"
            value={money(totals.budgeted)}
            meta={share === null ? 'Sin ingreso esperado' : `${share}% de tu ingreso esperado`}
            tone={totals.budgeted > 0 ? 'safe' : 'empty'}
          />
          <GradeCard
            grade="Gastado"
            title="En categorías con límite"
            value={money(totals.spentInBudgets)}
            meta={`Total del mes ${money(totals.spentTotal)}`}
            tone={overall}
            progress={totals.budgeted > 0 ? totals.spentInBudgets / totals.budgeted : undefined}
          />
          <GradeCard
            grade="Restante"
            title={totals.remaining >= 0 ? 'Te queda' : 'Arriba del límite'}
            value={money(Math.abs(totals.remaining))}
            meta={pace > 0 && pace < 1 ? `Va ${Math.round(pace * 100)}% del mes` : pace >= 1 ? 'Mes cerrado' : 'Mes por empezar'}
            tone={totals.budgeted === 0 ? 'empty' : totals.remaining < 0 ? 'shortfall' : overall}
          />
        </div>
        <Panel title="Por categoría">
          {rows.length === 0 ? (
            <FooterHint>Sin límites ni gastos este mes. Pon un límite para ver tu ritmo.</FooterHint>
          ) : (
            <div className="stat-list">
              {[...budgeted, ...loose].map((row) => {
                const plannedAmount = plannedOf([row.category.uuid, ...row.children.map((child) => child.category.uuid)])
                return (
                  <button
                    key={row.category.uuid}
                    type="button"
                    className="stat-button"
                    aria-pressed={row.category.uuid === selected}
                    onClick={() => setSelected(row.category.uuid === selected ? null : row.category.uuid)}
                  >
                    <StatBar
                      label={row.category.name}
                      value={row.limit === null ? `${money(row.spent)} · sin límite` : `${money(row.spent)} / ${money(row.limit)}`}
                      ratio={row.limit === null ? (totals.spentTotal > 0 ? row.spent / totals.spentTotal : 0) : row.ratio}
                      tone={row.limit === null ? 'empty' : row.tone}
                      marker={row.limit === null ? undefined : pace}
                    />
                    {plannedAmount > 0 && (
                      <span className="row-sub">
                        {`Planeado ${money(plannedAmount)}`}
                        {row.limit !== null && row.spent + plannedAmount > row.limit ? ' · con esto pasa el límite' : ''}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </Panel>
        <FooterHint>
          {income.source === 'schedule'
            ? `Ingreso esperado del mes: ${money(income.amount)}, según tus días de ingreso.${
                incomeBasis !== income.amount ? ` El porcentaje usa un mes promedio: ${money(incomeBasis)}.` : ''
              }`
            : income.source === 'received'
              ? `Sin montos en tus días de ingreso; se usa lo que ya recibiste este mes: ${money(income.amount)}.`
              : 'Agrega el monto de tus ingresos en Pagos fijos para comparar tus límites con lo que ganas.'}
          {income.unknownItems > 0 && income.source === 'schedule' ? ' Algunos ingresos no tienen monto y no se cuentan.' : ''}
        </FooterHint>
        {budgeted.length > 0 && <FooterHint>La línea en cada barra marca cuánto del mes ha pasado.</FooterHint>}
      </div>
      {creating && (
        <aside ref={dossierRef} className="dossier dossier-sheet" tabIndex={-1} aria-label="Nuevo límite">
          <Panel title="Nuevo límite">
            <LimitForm data={data} category={null} month={month} onDone={(id) => setSelected(id)} />
          </Panel>
        </aside>
      )}
      {selectedRow && (
        <aside ref={dossierRef} className="dossier dossier-sheet" tabIndex={-1} aria-label={selectedRow.category.name}>
          <CategoryDossier key={selectedRow.category.uuid} row={selectedRow} parent={selectedParent} data={data} month={month} pace={pace} onSelect={setSelected} onClose={() => setSelected(null)} />
        </aside>
      )}
    </div>
  )
}