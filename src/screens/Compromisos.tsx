import { useState, type FormEvent } from 'react'
import { AmountField, FieldError, FieldNote, FormActions, SelectField, TextField } from '../components/fields'
import { FooterHint, Panel } from '../components/hud'
import { StageHeader } from '../components/StageHeader'
import { isLiquid, selectable } from '../db/accounts'
import { createRecurring, deleteRecurring, updateRecurring } from '../db/commitments'
import type { RecurringItem } from '../db/types'
import { useMoneyData, type MoneyData } from '../db/useMoneyData'
import { nextDateForDay, todayIso } from '../lib/dates'
import { formatDate, formatMoney } from '../lib/format'
import { pickValid } from '../lib/forms'
import { categoryOptions as categoryOptionsFor } from '../lib/categories'
import { parseAmount, parseDay } from '../lib/parseAmount'
import { CategoryPicker } from '../components/CategoryPicker'

type Kind = RecurringItem['type']

const COPY: Record<Kind, { title: string; add: string; empty: string; namePlaceholder: string; amountLabel: string }> = {
  income: {
    title: 'Ingresos esperados',
    add: '+ Día de ingreso',
    empty: 'Agrega los días en que recibes ingreso. Así Guanabana sabe cuándo es tu próximo ingreso.',
    namePlaceholder: 'Ej. Primer ingreso',
    amountLabel: 'Monto estimado (MXN, opcional)',
  },
  bill: {
    title: 'Pagos fijos',
    add: '+ Pago fijo',
    empty: 'Agrega renta, servicios o suscripciones. Se apartan de tu Disponible real antes de tu próximo ingreso.',
    namePlaceholder: 'Ej. Renta',
    amountLabel: 'Monto (MXN)',
  },
}

function RecurringForm({ kind, data, item, onDone }: { kind: Kind; data: MoneyData; item?: RecurringItem; onDone: () => void }) {
  const [name, setName] = useState(item?.name ?? '')
  const [amount, setAmount] = useState(item?.amount != null ? String(item.amount) : '')
  const [day, setDay] = useState(item ? String(item.due_day) : '')
  const [accountId, setAccountId] = useState<string | null>(item?.account_id ?? null)
  const [categoryId, setCategoryId] = useState<string | null>(item?.category_id ?? null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const copy = COPY[kind]

  const accountOptions = [
    { value: '', label: 'Sin cuenta fija' },
    ...selectable(data.accounts, [item?.account_id]).filter(isLiquid).map((a) => ({ value: a.uuid, label: a.name })),
  ]
  const categoryKind = kind === 'bill' ? 'expense' : 'income'
  const categoryOptions = categoryOptionsFor(data.categories, categoryKind, [item?.category_id])
  const activeCategory = pickValid(categoryId, categoryOptions)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const dueDay = parseDay(day)
    const value = amount.trim() === '' ? null : parseAmount(amount)
    if (!name.trim()) return setError('Ponle un nombre.')
    if (dueDay === null) return setError('El día va del 1 al 31.')
    if (kind === 'bill' && (value === null || value <= 0)) return setError('Escribe el monto del pago.')
    if (amount.trim() !== '' && value === null) return setError('Revisa el monto.')

    setSaving(true)
    try {
      const fields = {
        name: name.trim(),
        amount: value,
        due_day: dueDay,
        account_id: accountId || null,
        category_id: activeCategory ?? null,
      }
      if (item) await updateRecurring(item, fields)
      else await createRecurring({ ...fields, type: kind, start_date: todayIso(), active: true })
      onDone()
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <TextField label="Nombre" value={name} onChange={setName} placeholder={copy.namePlaceholder} autoFocus />
      <div className="field-row">
        <TextField label="Día del mes" value={day} onChange={setDay} inputMode="numeric" placeholder={kind === 'income' ? '15' : '1'} mono />
        <AmountField label={copy.amountLabel} value={amount} onChange={setAmount} />
      </div>
      <SelectField label={kind === 'income' ? 'Llega a' : 'Se paga desde'} value={accountId ?? ''} onChange={setAccountId} options={accountOptions} />
      {activeCategory && (
        <CategoryPicker categories={data.categories} kind={categoryKind} value={activeCategory} onChange={setCategoryId} keep={[item?.category_id]} />
      )}
      {item ? (
        <FieldNote>Los pagos que ya registraste no cambian.</FieldNote>
      ) : (
        kind === 'income' && <FieldNote>Si cobras dos veces al mes, agrega los dos días por separado.</FieldNote>
      )}
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel={item ? 'Guardar cambios' : 'Guardar'} saving={saving} onCancel={onDone} />
    </form>
  )
}

function RecurringPanel({ kind, data }: { kind: Kind; data: MoneyData }) {
  const [adding, setAdding] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const copy = COPY[kind]
  const editingItem = data.recurring.find((item) => item.uuid === editing)
  const items = data.recurring.filter((item) => item.type === kind).sort((a, b) => a.due_day - b.due_day)
  const today = new Date()

  return (
    <Panel
      title={copy.title}
      aside={
        !adding && (
          <button type="button" className="panel-verb" onClick={() => setAdding(true)}>
            {copy.add}
          </button>
        )
      }
    >
      {adding && <RecurringForm kind={kind} data={data} onDone={() => setAdding(false)} />}
      {editingItem && <RecurringForm key={editingItem.uuid} kind={kind} data={data} item={editingItem} onDone={() => setEditing(null)} />}
      {items.length === 0 ? (
        !adding && <FooterHint>{copy.empty}</FooterHint>
      ) : (
        <table className="roster">
          <thead>
            <tr>
              <th scope="col">Nombre</th>
              <th scope="col">Día</th>
              <th scope="col">Siguiente</th>
              <th scope="col" className="num">Monto</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.uuid}>
                <td>{item.name}</td>
                <td className="mono dim">{item.due_day}</td>
                <td className="mono dim">{formatDate(nextDateForDay(item.due_day, today))}</td>
                <td className="num mono">{item.amount === null ? '—' : formatMoney(item.amount, 'MXN')}</td>
                <td className="num">
                  {confirming === item.uuid ? (
                    <>
                      <button type="button" className="panel-verb text-heat" onClick={() => deleteRecurring(item)}>
                        Confirmar
                      </button>{' '}
                      <button type="button" className="panel-verb" onClick={() => setConfirming(null)}>
                        No
                      </button>
                    </>
                  ) : (
                    <span className="panel-verbs">
                      <button
                        type="button"
                        className="panel-verb"
                        onClick={() => {
                          setAdding(false)
                          setEditing(item.uuid)
                        }}
                      >
                        Editar
                      </button>
                      <button type="button" className="panel-verb" onClick={() => setConfirming(item.uuid)}>
                        Quitar
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  )
}

export function Compromisos() {
  const data = useMoneyData()
  if (!data.loaded) return null

  return (
    <div className="stage-grid stage-grid--single">
      <div className="stage-main">
        <StageHeader title="Ingresos y pagos fijos" />
        <RecurringPanel kind="income" data={data} />
        <RecurringPanel kind="bill" data={data} />
        <FooterHint>Quitar un pago fijo no borra los pagos que ya registraste.</FooterHint>
      </div>
    </div>
  )
}
