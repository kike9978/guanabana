import { useState, type FormEvent } from 'react'
import { AmountField, FieldError, FieldNote, FormActions, SelectField, TextField } from '../components/fields'
import { FooterHint, Panel } from '../components/hud'
import { StageHeader } from '../components/StageHeader'
import { isLiquid, selectable } from '../db/accounts'
import { createRecurring, deleteRecurring, updateRecurring } from '../db/commitments'
import type { RecurringItem, Transaction } from '../db/types'
import { useMoneyData, type MoneyData } from '../db/useMoneyData'
import { billCommitments, incomeCycle, itemOccurrences, nextOccurrences, repeatOf, sumCommitments } from '../lib/cycle'
import { dateToIso, isoToDate, todayIso } from '../lib/dates'
import { formatDate, formatMoney } from '../lib/format'
import { pickValid } from '../lib/forms'
import { categoryOptions as categoryOptionsFor } from '../lib/categories'
import { roundMoney } from '../lib/money'
import { parseAmount, parseDay } from '../lib/parseAmount'
import {
  needsStart,
  parseRepeatKey,
  REPEAT_OPTIONS,
  repeatKey,
  repeatLabel,
  startChoices,
  weekdayOf,
  WEEKDAYS,
  type RepeatKey,
} from '../lib/repeat'
import { CategoryPicker } from '../components/CategoryPicker'

type Kind = RecurringItem['type']

const DEFAULT_WEEKDAY = 5
const PREVIEW_COUNT = 3

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

const money = (value: number) => formatMoney(value, 'MXN')

function unrecordedBefore(item: RecurringItem, transactions: Transaction[], from: Date, today: Date): string[] {
  const recorded = new Set(transactions.filter((tx) => tx.recurring_id === item.uuid && tx.occurrence).map((tx) => tx.occurrence))
  return itemOccurrences(item, from, today)
    .map(dateToIso)
    .filter((occurrence) => occurrence >= item.start_date && !recorded.has(occurrence))
}

function RecurringForm({ kind, data, item, onDone }: { kind: Kind; data: MoneyData; item?: RecurringItem; onDone: () => void }) {
  const today = new Date()
  const todayKey = todayIso()
  const itemKey = item ? repeatKey(item) : null
  const itemWeekday = item && repeatOf(item).frequency === 'weekly' ? weekdayOf(item) : null
  const [name, setName] = useState(item?.name ?? '')
  const [amount, setAmount] = useState(item?.amount != null ? String(item.amount) : '')
  const [repeat, setRepeat] = useState<RepeatKey>(itemKey ?? 'm1')
  const [weekday, setWeekday] = useState(String(itemWeekday ?? DEFAULT_WEEKDAY))
  const [day, setDay] = useState(item ? String(item.due_day) : '')
  const [start, setStart] = useState<string | null>(null)
  const [sourceId, setSourceId] = useState<string | null>(item?.cc_id ?? item?.account_id ?? null)
  const [categoryId, setCategoryId] = useState<string | null>(item?.category_id ?? null)
  const [letGo, setLetGo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const copy = COPY[kind]

  const accountOptions = [
    { value: '', label: 'Sin cuenta fija' },
    ...selectable(data.accounts, [item?.account_id]).filter(isLiquid).map((a) => ({ value: a.uuid, label: a.name })),
    ...(kind === 'bill' ? selectable(data.cards, [item?.cc_id]).map((c) => ({ value: c.uuid, label: `${c.name} · TDC` })) : []),
  ]
  const activeSource = pickValid(sourceId, accountOptions)
  const isCard = data.cards.some((c) => c.uuid === activeSource)
  const categoryKind = kind === 'bill' ? 'expense' : 'income'
  const categoryOptions = categoryOptionsFor(data.categories, categoryKind, [item?.category_id])
  const activeCategory = pickValid(categoryId, categoryOptions)

  const repeatOptions = REPEAT_OPTIONS.filter((option) => kind === 'bill' || !option.billOnly)
  const { frequency, interval } = parseRepeatKey(repeat)
  const weekly = frequency === 'weekly'
  const weekdayValue = Number(weekday)
  const dueDay = parseDay(day)
  const phaseKnown = weekly || dueDay !== null
  const samePhase =
    item !== undefined && repeat === itemKey && (weekly ? weekdayValue === itemWeekday : dueDay === item.due_day)

  const choices = needsStart(repeat) && phaseKnown ? startChoices(repeat, weekdayValue, dueDay ?? 1, today).map(dateToIso) : []
  const currentNext = item && samePhase ? nextOccurrences(item, today, 1)[0] : undefined
  const defaultStart = currentNext && choices.includes(dateToIso(currentNext)) ? dateToIso(currentNext) : choices[0]
  const chosenStart = start && choices.includes(start) ? start : defaultStart

  function startDate(): string {
    if (item && samePhase && (!needsStart(repeat) || chosenStart === defaultStart)) return item.start_date
    if (needsStart(repeat)) return chosenStart
    if (weekly) return dateToIso(startChoices('w1', weekdayValue, 1, today)[0])
    return item && item.start_date < todayKey ? item.start_date : todayKey
  }

  const draft: RecurringItem | null = phaseKnown
    ? {
        ...(item ?? { uuid: 'draft', updated_at: '', type: kind, active: true, account_id: null, category_id: null }),
        name,
        amount: amount.trim() === '' ? null : parseAmount(amount),
        frequency,
        interval,
        due_day: weekly ? (item?.due_day ?? isoToDate(startDate()).getDate()) : dueDay!,
        start_date: startDate(),
      }
    : null
  const preview = draft ? nextOccurrences(draft, today, PREVIEW_COUNT) : []

  const scheduleChanged =
    item !== undefined &&
    draft !== null &&
    (repeat !== itemKey || draft.due_day !== item.due_day || draft.start_date !== item.start_date)
  const cycle = incomeCycle(data.recurring, today)
  const lost =
    item && draft && scheduleChanged
      ? (() => {
          const kept = new Set(unrecordedBefore(draft, data.transactions, cycle.start, today))
          return unrecordedBefore(item, data.transactions, cycle.start, today).filter((occurrence) => !kept.has(occurrence))
        })()
      : []
  const orphaned =
    item && draft && scheduleChanged
      ? data.overrides.filter((row) => {
          if (row.recurring_id !== item.uuid || row.occurrence < todayKey) return false
          const date = isoToDate(row.occurrence)
          return itemOccurrences(draft, date, new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 12)).length === 0
        })
      : []
  const keptOverrides = data.overrides.filter((row) => !orphaned.includes(row))
  const availableChange =
    item && draft && kind === 'bill'
      ? roundMoney(
          sumCommitments(billCommitments([item], data.transactions, cycle, today, data.overrides)) -
            sumCommitments(billCommitments([draft], data.transactions, cycle, today, keptOverrides)),
        )
      : 0

  async function submit(event: FormEvent) {
    event.preventDefault()
    const value = amount.trim() === '' ? null : parseAmount(amount)
    if (!name.trim()) return setError('Ponle un nombre.')
    if (!weekly && dueDay === null) return setError('El día va del 1 al 31.')
    if (kind === 'bill' && (value === null || value <= 0)) return setError('Escribe el monto del pago.')
    if (amount.trim() !== '' && value === null) return setError('Revisa el monto.')
    if (!draft) return
    if ((lost.length > 0 || orphaned.length > 0) && !letGo) {
      setLetGo(true)
      return setError(null)
    }

    setSaving(true)
    try {
      const fields = {
        name: name.trim(),
        amount: value,
        frequency,
        interval,
        due_day: draft.due_day,
        start_date: draft.start_date,
        account_id: isCard ? null : activeSource || null,
        cc_id: isCard ? (activeSource ?? null) : null,
        category_id: activeCategory ?? null,
      }
      if (item) await updateRecurring(item, fields, orphaned.map((row) => row.uuid))
      else await createRecurring({ ...fields, type: kind, active: true })
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
        <SelectField label="Se repite" value={repeat} onChange={(value) => setRepeat(value as RepeatKey)} options={repeatOptions} />
        {weekly ? (
          <SelectField label="Día" value={weekday} onChange={setWeekday} options={WEEKDAYS.map((label, index) => ({ value: String(index), label }))} />
        ) : (
          <TextField label="Día del mes" value={day} onChange={setDay} inputMode="numeric" placeholder={kind === 'income' ? '15' : '1'} mono />
        )}
      </div>
      {choices.length > 1 && (
        <SelectField
          label={weekly ? `¿Cuál ${WEEKDAYS[weekdayValue]} es el próximo?` : '¿Cuándo es el próximo?'}
          value={chosenStart}
          onChange={setStart}
          options={choices.map((iso) => ({ value: iso, label: formatDate(isoToDate(iso)) }))}
        />
      )}
      {preview.length > 0 && <FieldNote>{`Próximas: ${preview.map((date) => formatDate(date)).join(' · ')}`}</FieldNote>}
      <AmountField label={copy.amountLabel} value={amount} onChange={setAmount} />
      <SelectField label={kind === 'income' ? 'Llega a' : 'Se paga desde'} value={activeSource ?? ''} onChange={setSourceId} options={accountOptions} />
      {isCard && <FieldNote>Con tarjeta tu banco no cambia. Se aparta de tu Disponible real y, al registrarlo, sube la deuda de la tarjeta.</FieldNote>}
      {activeCategory && (
        <CategoryPicker categories={data.categories} kind={categoryKind} value={activeCategory} onChange={setCategoryId} keep={[item?.category_id]} />
      )}
      {item ? (
        <FieldNote>Los pagos que ya registraste no cambian.</FieldNote>
      ) : (
        kind === 'income' && <FieldNote>Si cobras el 15 y el 30, agrega los dos días por separado. Si cobras cada viernes, elige Cada semana.</FieldNote>
      )}
      {orphaned.length > 0 && (
        <FieldNote>
          {`Estos ajustes caen en fechas que ya no se repiten y se quitan al guardar: ${orphaned
            .map((row) => `${formatDate(isoToDate(row.occurrence))} (${money(row.amount)})`)
            .join(', ')}.`}
        </FieldNote>
      )}
      {lost.length > 0 && (
        <FieldNote>
          {`Con el cambio ya no quedan pendientes: ${lost.map((iso) => formatDate(isoToDate(iso))).join(', ')}. ${
            kind === 'bill' ? 'Si ya se pagaron' : 'Si ya llegaron'
          }, regístralos antes de guardar.`}
        </FieldNote>
      )}
      {availableChange !== 0 && (
        <FieldNote>{`Disponible real ${availableChange > 0 ? 'sube' : 'baja'} ${money(Math.abs(availableChange))} con el cambio.`}</FieldNote>
      )}
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel={letGo ? 'Guardar de todos modos' : item ? 'Guardar cambios' : 'Guardar'} saving={saving} onCancel={onDone} />
    </form>
  )
}

function RecurringPanel({ kind, data }: { kind: Kind; data: MoneyData }) {
  const [adding, setAdding] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const copy = COPY[kind]
  const editingItem = data.recurring.find((item) => item.uuid === editing)
  const today = new Date()
  const items = data.recurring
    .filter((item) => item.type === kind)
    .map((item) => ({ item, next: nextOccurrences(item, today, 1)[0] }))
    .sort((a, b) => (a.next?.getTime() ?? Infinity) - (b.next?.getTime() ?? Infinity))

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
              <th scope="col">Se repite</th>
              <th scope="col">Siguiente</th>
              <th scope="col" className="num">Monto</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {items.map(({ item, next }) => (
              <tr key={item.uuid}>
                <td>{item.name}</td>
                <td className="dim">{repeatLabel(item)}</td>
                <td className="mono dim">{next ? formatDate(next) : '—'}</td>
                <td className="num mono">{item.amount === null ? '—' : money(item.amount)}</td>
                <td className="num">
                  {confirming === item.uuid ? (
                    <>
                      <button type="button" className="panel-verb text-heat" onClick={() => deleteRecurring(item, data.overrides)}>
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
