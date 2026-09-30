import { useState } from 'react'
import { createSubcategory } from '../db/categories'
import type { Category, CategoryKind } from '../db/types'
import { canHaveChildren, categoryOptions, subcategoryNameError, topCategoryId } from '../lib/categories'
import { FieldError, SelectField, TextField } from './fields'

/** One picker with subcategories indented under their parent, plus an inline way to add one. */
export function CategoryPicker({
  label = 'Categoría',
  categories,
  kind,
  value,
  onChange,
  keep = [],
}: {
  label?: string
  categories: Category[]
  kind: CategoryKind
  value: string
  onChange: (id: string) => void
  keep?: (string | null | undefined)[]
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const parent = categories.find((c) => c.uuid === topCategoryId(value, categories))
  const options = categoryOptions(categories, kind, [value, ...keep])

  async function create() {
    if (!parent) return
    const problem = subcategoryNameError(name, parent, categories)
    if (problem) return setError(problem)
    try {
      const created = await createSubcategory(parent, name)
      onChange(created.uuid)
      setAdding(false)
      setName('')
      setError(null)
    } catch {
      setError('No se pudo crear. Intenta de nuevo.')
    }
  }

  return (
    <div className="category-picker">
      <SelectField label={label} value={value} onChange={onChange} options={options} />
      {parent && canHaveChildren(parent) && !adding && (
        <button type="button" className="panel-verb" onClick={() => setAdding(true)}>
          + Subcategoría en {parent.name}
        </button>
      )}
      {adding && parent && (
        <div className="field-row">
          <TextField label={`Nueva en ${parent.name}`} value={name} onChange={(v) => { setName(v); setError(null) }} placeholder="Ej. Cine" autoFocus />
          <div className="verb-row">
            <button type="button" className="verb-button" onClick={() => void create()}>
              Crear
            </button>
            <button type="button" className="verb-button" onClick={() => { setAdding(false); setError(null) }}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {error && <FieldError>{error}</FieldError>}
    </div>
  )
}
