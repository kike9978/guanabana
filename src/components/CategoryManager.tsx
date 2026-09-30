import { useState, type FormEvent } from 'react'
import { createSubcategory, deleteSubcategory, setCategoryArchived, updateSubcategory } from '../db/categories'
import type { Category, CategoryKind } from '../db/types'
import type { MoneyData } from '../db/useMoneyData'
import { canHaveChildren, categoryUsage, childrenOf, isTopLevel, moveImpact, subcategoryNameError } from '../lib/categories'
import { formatMoney } from '../lib/format'
import { FieldError, FieldNote, FormActions, SelectField, TextField } from './fields'
import { FooterHint, Rail } from './hud'

const KINDS = [
  { id: 'expense', label: 'Gastos' },
  { id: 'income', label: 'Ingresos' },
] as const satisfies readonly { id: CategoryKind; label: string }[]

const money = (value: number) => formatMoney(value, 'MXN')

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function NewSubcategory({ parent, categories, onDone }: { parent: Category; categories: Category[]; onDone: () => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const problem = subcategoryNameError(name, parent, categories)
    if (problem) return setError(problem)
    setSaving(true)
    try {
      await createSubcategory(parent, name)
      onDone()
    } catch {
      setError('No se pudo crear. Intenta de nuevo.')
      setSaving(false)
    }
  }

  return (
    <form className="form category-editor" onSubmit={submit} noValidate>
      <TextField label={`Nueva en ${parent.name}`} value={name} onChange={(v) => { setName(v); setError(null) }} invalid={error !== null} placeholder="Ej. Cine" autoFocus />
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel="Crear subcategoría" saving={saving} onCancel={onDone} />
    </form>
  )
}

function EditSubcategory({ category, data, onDone }: { category: Category; data: MoneyData; onDone: () => void }) {
  const [name, setName] = useState(category.name)
  const [parentId, setParentId] = useState(category.parent_id ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const parents = data.categories.filter((c) => c.kind === category.kind && canHaveChildren(c) && (!c.archived || c.uuid === category.parent_id))
  const parent = parents.find((c) => c.uuid === parentId)
  const oldParent = data.categories.find((c) => c.uuid === category.parent_id)
  const moving = parentId !== category.parent_id
  const impact = moveImpact(category.uuid, data.transactions)
  const usage = categoryUsage(category.uuid, data)
  const moved = [
    usage.transactions > 0 ? plural(usage.transactions, 'movimiento', 'movimientos') : null,
    usage.recurring > 0 ? plural(usage.recurring, 'pago fijo', 'pagos fijos') : null,
  ].filter((part) => part !== null)
  const movedCount = usage.transactions + usage.recurring

  async function run(write: () => Promise<void>) {
    setSaving(true)
    setError(null)
    try {
      await write()
      onDone()
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setSaving(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!parent) return setError('Elige dónde va.')
    const problem = subcategoryNameError(name, parent, data.categories, category)
    if (problem) return setError(problem)
    void run(() => updateSubcategory(category, { name, parent_id: parent.uuid }))
  }

  if (confirmDelete) {
    return (
      <div className="form category-editor">
        <FieldNote>
          Borrar {category.name}.{' '}
          {moved.length === 0 ? 'No tiene movimientos.' : `${moved.join(' y ')} ${movedCount === 1 ? 'pasa' : 'pasan'} a ${oldParent?.name ?? 'la categoría de arriba'}.`}
          {usage.budgets > 0 && ` Su límite se quita.`} Los totales de {oldParent?.name ?? 'la categoría'} no cambian.
        </FieldNote>
        {error && <FieldError>{error}</FieldError>}
        <div className="verb-row">
          <button type="button" className="verb-button verb-primary" disabled={saving} onClick={() => void run(() => deleteSubcategory(category, data))}>
            <span className="key-glyph">A</span>
            Borrar
          </button>
          <button type="button" className="verb-button" onClick={() => setConfirmDelete(false)}>
            Cancelar
          </button>
        </div>
      </div>
    )
  }

  return (
    <form className="form category-editor" onSubmit={submit} noValidate>
      <TextField label="Nombre" value={name} onChange={(v) => { setName(v); setError(null) }} invalid={error !== null} autoFocus />
      <SelectField label="Va en" value={parentId} onChange={(v) => { setParentId(v); setError(null) }} options={parents.map((c) => ({ value: c.uuid, label: c.name }))} />
      {moving && parent && (
        <FieldNote>
          {impact.count === 0
            ? 'Sin movimientos; ningún total cambia.'
            : `${plural(impact.count, 'movimiento', 'movimientos')} (${money(impact.amount)}) ${impact.count === 1 ? 'deja de contar' : 'dejan de contar'} en ${oldParent?.name ?? 'su categoría'} y ${impact.count === 1 ? 'cuenta' : 'cuentan'} en ${parent.name}.`}
        </FieldNote>
      )}
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel="Guardar" saving={saving} onCancel={onDone} />
      <div className="verb-row">
        <button type="button" className="verb-button" disabled={saving} onClick={() => void run(() => setCategoryArchived(category, !category.archived))}>
          <span className="key-glyph">R</span>
          {category.archived ? 'Restaurar' : 'Archivar'}
        </button>
        <button type="button" className="verb-button" disabled={saving} onClick={() => setConfirmDelete(true)}>
          <span className="key-glyph">X</span>
          Borrar
        </button>
      </div>
      {!category.archived && <FieldNote>Archivar la quita de las listas para elegir. Sus movimientos se quedan.</FieldNote>}
    </form>
  )
}

/** Categories by kind, each with its subcategories. Only subcategories are created, renamed, moved, archived, or deleted. */
export function CategoryManager({ data }: { data: MoneyData }) {
  const [kind, setKind] = useState<CategoryKind>('expense')
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const parents = data.categories.filter((c) => c.kind === kind && isTopLevel(c))

  return (
    <>
      <Rail label="Tipo de categoría" items={KINDS} active={kind} onSelect={(next) => { setKind(next); setEditing(null); setAdding(null) }} />
      <ul className="category-tree">
        {parents.map((parent) => {
          const children = childrenOf(parent.uuid, data.categories, true)
          return (
            <li key={parent.uuid}>
              <div className="category-row">
                <span>{parent.name}</span>
                {canHaveChildren(parent) && adding !== parent.uuid && (
                  <button type="button" className="panel-verb" onClick={() => { setAdding(parent.uuid); setEditing(null) }}>
                    + Subcategoría
                  </button>
                )}
              </div>
              {adding === parent.uuid && <NewSubcategory parent={parent} categories={data.categories} onDone={() => setAdding(null)} />}
              {children.length > 0 && (
                <ul className="category-children">
                  {children.map((child) => (
                    <li key={child.uuid}>
                      <div className="category-row">
                        <span className={child.archived ? 'dim' : undefined}>
                          {child.name}
                          {child.archived && ' · archivada'}
                        </span>
                        {editing !== child.uuid && (
                          <button type="button" className="panel-verb" onClick={() => { setEditing(child.uuid); setAdding(null) }}>
                            Editar
                          </button>
                        )}
                      </div>
                      {editing === child.uuid && <EditSubcategory key={child.updated_at} category={child} data={data} onDone={() => setEditing(null)} />}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
      <FooterHint>Lo que gastas en una subcategoría también cuenta en su categoría. “Sin categoría” no lleva subcategorías.</FooterHint>
    </>
  )
}
