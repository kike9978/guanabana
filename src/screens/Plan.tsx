import { useState, type FormEvent, type ReactNode } from 'react'
import { AmountField, ChoiceField, FieldError, FieldNote, FormActions, RangeField, SelectField, TextField } from '../components/fields'
import { FooterHint, GradeCard, Panel, StatBar, type Tone } from '../components/hud'
import { Icon } from '../components/Icon'
import { useDossierSheet, useScrollIntoView } from '../components/mobile'
import { selectable } from '../db/accounts'
import {
  addPlanItem,
  addPlannedContribution,
  apartarForWish,
  buyPlanItem,
  makeContributionARule,
  removePlanItem,
  removePlannedContribution,
  setContributionEnabled,
  setPlanSettings,
  swapPlanOrder,
  updatePlanItem,
  type PlanItemFields,
} from '../db/plan'
import type { BucketDraw, IncomeSlot, PlanItem, PlannedContribution, SavingsBucket } from '../db/types'
import type { MoneyData } from '../db/useMoneyData'
import { useRecords } from '../db/useRecords'
import { isLiquid } from '../lib/accounts'
import { scheduledMonthlyIncome } from '../lib/budgets'
import { bucketBalance, homeAccount, targetPace } from '../lib/buckets'
import { incomeSlots } from '../lib/incomeRules'
import { categoryOptions } from '../lib/categories'
import { dateToIso, isoToDate, todayIso } from '../lib/dates'
import { formatAmount, formatDate, formatMoney } from '../lib/format'
import { roundMoney } from '../lib/money'
import { MSI_TERMS, msiAmounts } from '../lib/msi'
import { parseAmount } from '../lib/parseAmount'
import { isBought, PLAN_ASAP_MONTHS, projectPlan, sortItems, type ItemResult, type PlanResult } from '../lib/plan'
import { habitualDailySpend, INCOME_SCENARIOS, type IncomeScenarioId } from '../lib/projection'
import { moneySnapshot } from '../lib/snapshot'

const money = (value: number) => formatMoney(value, 'MXN')
const INCOME_STEP = 500
const EXTRA_STEP = 250
const DAILY_STEP = 10
const MSI_NONE = 1
const NEW_ITEM = 'new'
const TIGHT_SHARE = 0.1

const SLOT_OPTIONS: { value: IncomeSlot; label: string }[] = [
  { value: 'first', label: '1er ingreso' },
  { value: 'second', label: '2º ingreso' },
  { value: 'both', label: 'Ambos' },
]
const SLOT_LABEL: Record<IncomeSlot, string> = { first: 'Con el 1er ingreso', second: 'Con el 2º ingreso', both: 'Con cada ingreso' }

function planTone(result: PlanResult): Tone {
  if (result.lowest.available < 0) return 'shortfall'
  const start = result.points[0]?.base ?? 0
  if (start > 0 && result.lowest.available < start * TIGHT_SHARE) return 'tight'
  return 'safe'
}

function bucketName(data: MoneyData, id: string): string {
  return data.buckets.find((b) => b.uuid === id)?.name ?? 'Apartado'
}

function fundingLine(data: MoneyData, item: PlanItem): string {
  const parts: string[] = []
  const card = item.payment_method === 'credit_card' ? data.cards.find((c) => c.uuid === item.card_id) : undefined
  if (card) parts.push(`Tarjeta ${card.name}${(item.msi_months ?? 0) > 1 ? ` · ${item.msi_months} MSI` : ''}`)
  for (const draw of item.bucket_draws) if (draw.amount > 0) parts.push(`${money(draw.amount)} de ${bucketName(data, draw.bucket_id)}`)
  return parts.join(' · ')
}

function whenLine(item: PlanItem, result: ItemResult | undefined): string {
  if (item.target_date) return formatDate(isoToDate(item.target_date))
  if (result?.date) return `Lo antes posible → ${formatDate(result.date)}`
  return 'Lo antes posible'
}

function StatusCell({ item, result }: { item: PlanItem; result: ItemResult | undefined }) {
  if (!item.enabled) return <span className="dim">Apagado</span>
  if (!result) return <span className="dim">—</span>
  if (result.status === 'short') {
    return (
      <span className="text-amber">
        <Icon name="lock" size={14} /> {result.date ? `Faltan ${money(result.short)}` : `No alcanza en ${PLAN_ASAP_MONTHS} meses`}
      </span>
    )
  }
  if (result.status === 'tight') return <span className="text-amber">{result.drawCapped ? 'Apartado no alcanza' : 'Justo'}</span>
  return <span className="text-cyan">Alcanza</span>
}

function DrawLines({
  data,
  draws,
  onChange,
  noteFor,
}: {
  data: MoneyData
  draws: { bucket_id: string; amount: string }[]
  onChange: (next: { bucket_id: string; amount: string }[]) => void
  noteFor?: (bucketId: string) => string
}) {
  const buckets = data.buckets.filter((b) => !b.archived)
  if (buckets.length === 0) return <FieldNote>Aún no tienes apartados. Créalos en Ahorro.</FieldNote>
  const set = (index: number, fields: Partial<{ bucket_id: string; amount: string }>) =>
    onChange(draws.map((draw, i) => (i === index ? { ...draw, ...fields } : draw)))
  return (
    <>
      {draws.map((draw, index) => (
        <div key={index}>
          <div className="field-row">
            <SelectField label="Apartado" value={draw.bucket_id} onChange={(v) => set(index, { bucket_id: v })} options={buckets.map((b) => ({ value: b.uuid, label: b.name }))} />
            <AmountField label="Monto (MXN)" value={draw.amount} onChange={(v) => set(index, { amount: v })} />
          </div>
          <span className="panel-verbs">
            {noteFor && <span className="dim">{noteFor(draw.bucket_id)}</span>}
            <button type="button" className="panel-verb" onClick={() => onChange(draws.filter((_, i) => i !== index))}>
              Quitar
            </button>
          </span>
        </div>
      ))}
      {draws.length < buckets.length && (
        <button
          type="button"
          className="panel-verb"
          onClick={() => onChange([...draws, { bucket_id: buckets.find((b) => !draws.some((d) => d.bucket_id === b.uuid))!.uuid, amount: '' }])}
        >
          + Usar un apartado
        </button>
      )}
    </>
  )
}

function ItemForm({ data, item, items, onDone }: { data: MoneyData; item: PlanItem | null; items: PlanItem[]; onDone: (uuid: string | null) => void }) {
  const [name, setName] = useState(item?.name ?? '')
  const [amount, setAmount] = useState(item ? String(item.amount) : '')
  const [when, setWhen] = useState<'date' | 'asap'>(item && !item.target_date ? 'asap' : 'date')
  const [date, setDate] = useState(item?.target_date ?? todayIso())
  const [cardId, setCardId] = useState(item?.payment_method === 'credit_card' ? (item.card_id ?? '') : '')
  const [msiMonths, setMsiMonths] = useState(item?.msi_months ?? MSI_NONE)
  const [categoryId, setCategoryId] = useState(item?.category_id ?? '')
  const [draws, setDraws] = useState((item?.bucket_draws ?? []).map((d) => ({ bucket_id: d.bucket_id, amount: String(d.amount) })))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const cards = selectable(data.cards, [cardId])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const value = parseAmount(amount)
    if (!name.trim()) return setError('Ponle nombre a tu deseo.')
    if (value === null || value <= 0) return setError('Escribe un monto mayor a cero.')
    if (when === 'date' && !date) return setError('Elige una fecha o marca lo antes posible.')
    const parsed: BucketDraw[] = []
    for (const draw of draws) {
      const drawValue = parseAmount(draw.amount || '0')
      if (drawValue === null || drawValue < 0) return setError('Revisa los montos de los apartados.')
      if (drawValue > 0) parsed.push({ bucket_id: draw.bucket_id, amount: drawValue })
    }
    if (parsed.reduce((sum, d) => sum + d.amount, 0) > value) return setError('Los apartados suman más que el deseo.')
    const fields: PlanItemFields = {
      name: name.trim(),
      amount: value,
      target_date: when === 'date' ? date : null,
      enabled: item?.enabled ?? true,
      payment_method: cardId ? 'credit_card' : 'bank',
      card_id: cardId || null,
      msi_months: cardId && msiMonths !== MSI_NONE ? msiMonths : null,
      category_id: categoryId || null,
      bucket_draws: parsed,
      notes: item?.notes ?? '',
    }
    setSaving(true)
    try {
      if (item) {
        await updatePlanItem(item, fields)
        onDone(item.uuid)
      } else {
        onDone((await addPlanItem(items, fields)).uuid)
      }
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <TextField label="Qué quieres" value={name} onChange={(v) => { setName(v); setError(null) }} placeholder="Ej. Laptop" autoFocus={!item} />
      <AmountField label="Monto (MXN)" value={amount} onChange={(v) => { setAmount(v); setError(null) }} />
      <ChoiceField
        label="Cuándo"
        value={when}
        onChange={setWhen}
        options={[
          { value: 'date', label: 'En una fecha' },
          { value: 'asap', label: 'Lo antes posible' },
        ]}
      />
      {when === 'date' && <TextField label="Fecha" type="date" value={date} onChange={setDate} mono />}
      {cards.length > 0 && (
        <SelectField
          label="Pagar con"
          value={cardId}
          onChange={setCardId}
          options={[{ value: '', label: 'Banco o efectivo' }, ...cards.map((c) => ({ value: c.uuid, label: `Tarjeta ${c.name}` }))]}
        />
      )}
      {cardId && (
        <ChoiceField
          label="Meses sin intereses"
          value={String(msiMonths)}
          onChange={(v) => setMsiMonths(Number(v))}
          options={[{ value: String(MSI_NONE), label: 'No' }, ...MSI_TERMS.map((term) => ({ value: String(term), label: String(term) }))]}
        />
      )}
      <SelectField
        label="Categoría"
        value={categoryId}
        onChange={setCategoryId}
        options={[{ value: '', label: 'Sin categoría' }, ...categoryOptions(data.categories, 'expense', [categoryId])]}
      />
      <h3 className="field-label">Usar apartados</h3>
      <DrawLines data={data} draws={draws} onChange={setDraws} noteFor={(id) => `Hoy tiene ${money(bucketBalance(data.buckets.find((b) => b.uuid === id)!, data.bucketMoves))}`} />
      <FieldNote>
        {cardId
          ? 'Con tarjeta, lo del apartado cubre los cargos conforme entran a tu corte.'
          : 'Opcional. El plan usa lo que tendría el apartado en esa fecha, con tus reglas y aportes.'}
      </FieldNote>
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel={item ? 'Guardar deseo' : 'Agregar deseo'} saving={saving} onCancel={() => onDone(item?.uuid ?? null)} />
    </form>
  )
}

function BuyForm({ data, item, result, onDone }: { data: MoneyData; item: PlanItem; result: ItemResult | undefined; onDone: () => void }) {
  const today = new Date()
  const liquid = selectable(data.accounts).filter(isLiquid)
  const cards = selectable(data.cards, [item.card_id])
  const initialSource = item.payment_method === 'credit_card' && item.card_id ? `card:${item.card_id}` : liquid[0] ? `account:${liquid[0].uuid}` : ''
  const [amount, setAmount] = useState(String(item.amount))
  const [date, setDate] = useState(todayIso())
  const [source, setSource] = useState(initialSource)
  const [msiMonths, setMsiMonths] = useState(item.msi_months ?? MSI_NONE)
  const [categoryId, setCategoryId] = useState(item.category_id ?? '')
  const [bringTo, setBringTo] = useState(liquid[0]?.uuid ?? '')
  const planned = result?.draws.map((d) => ({ bucket_id: d.bucket.uuid, amount: d.granted })) ?? item.bucket_draws
  const [draws, setDraws] = useState(planned.map((d) => ({ bucket_id: d.bucket_id, amount: String(d.amount) })))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const cardId = source.startsWith('card:') ? source.slice(5) : null
  const account = source.startsWith('account:') ? (liquid.find((a) => a.uuid === source.slice(8)) ?? null) : null
  const value = parseAmount(amount) ?? 0
  const costNow = cardId && msiMonths > MSI_NONE && value > 0 ? msiAmounts(value, msiMonths)[0] : value
  const available = (bucket: SavingsBucket) => {
    const home = homeAccount(bucket, data.accounts)
    const balance = bucketBalance(bucket, data.bucketMoves)
    return roundMoney(Math.max(0, home ? Math.min(balance, home.current_balance) : balance))
  }
  const parsed = draws.map((d) => ({ bucket: data.buckets.find((b) => b.uuid === d.bucket_id)!, amount: parseAmount(d.amount || '0') }))
  const drawTotal = roundMoney(parsed.reduce((sum, d) => sum + (d.amount ?? 0), 0))
  const needsBringTo = parsed.some((d) => (d.amount ?? 0) > 0 && homeAccount(d.bucket, data.accounts))
  const before = moneySnapshot(data, today).breakdown.total
  const after = roundMoney(before - costNow + drawTotal)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (value <= 0) return setError('Escribe el monto que pagaste.')
    if (!cardId && !account) return setError('Elige con qué pagaste.')
    if (date > todayIso()) return setError('La fecha no puede ser futura.')
    for (const draw of parsed) {
      if (draw.amount === null || draw.amount < 0) return setError('Revisa los montos de los apartados.')
      if (draw.amount > available(draw.bucket)) return setError(`${draw.bucket.name} tiene ${money(available(draw.bucket))} hoy.`)
    }
    if (drawTotal > costNow) {
      return setError(cardId ? `Hoy tu tarjeta reserva ${money(costNow)}. Usa hasta eso de tus apartados.` : 'Los apartados suman más que la compra.')
    }
    const to = account ?? liquid.find((a) => a.uuid === bringTo) ?? null
    if (needsBringTo && !to) return setError('Elige a qué cuenta traes el dinero del apartado.')
    setSaving(true)
    try {
      await buyPlanItem(
        {
          item,
          amount: value,
          date,
          account,
          cardId,
          msiMonths: cardId && msiMonths > MSI_NONE ? msiMonths : null,
          categoryId: categoryId || null,
          draws: parsed.map((d) => ({ bucket: d.bucket, amount: d.amount ?? 0 })),
          bringTo: to,
        },
        data.accounts,
        data.bucketMoves,
      )
      onDone()
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <div className="field-row">
        <AmountField label="Pagaste (MXN)" value={amount} onChange={(v) => { setAmount(v); setError(null) }} autoFocus />
        <TextField label="Fecha" type="date" value={date} onChange={setDate} max={todayIso()} mono />
      </div>
      <SelectField
        label="Pagar con"
        value={source}
        onChange={setSource}
        options={[
          ...liquid.map((a) => ({ value: `account:${a.uuid}`, label: a.name })),
          ...cards.map((c) => ({ value: `card:${c.uuid}`, label: `Tarjeta ${c.name}` })),
        ]}
      />
      {cardId && (
        <ChoiceField
          label="Meses sin intereses"
          value={String(msiMonths)}
          onChange={(v) => setMsiMonths(Number(v))}
          options={[{ value: String(MSI_NONE), label: 'No' }, ...MSI_TERMS.map((term) => ({ value: String(term), label: String(term) }))]}
        />
      )}
      <SelectField
        label="Categoría"
        value={categoryId}
        onChange={setCategoryId}
        options={[{ value: '', label: 'Sin categoría' }, ...categoryOptions(data.categories, 'expense', [categoryId])]}
      />
      <h3 className="field-label">Usar apartados</h3>
      <DrawLines data={data} draws={draws} onChange={setDraws} noteFor={(id) => `Hoy tiene ${money(available(data.buckets.find((b) => b.uuid === id)!))}`} />
      {needsBringTo && cardId && (
        <SelectField label="Traer a" value={bringTo} onChange={setBringTo} options={liquid.map((a) => ({ value: a.uuid, label: a.name }))} />
      )}
      {cardId && item.bucket_draws.length > 0 && (
        <FieldNote>Con tarjeta solo se usa lo que tu tarjeta reserva hoy. El resto sigue en tus apartados.</FieldNote>
      )}
      <div className="stat-list">
        <div className="readout">
          <span className="dim">Disponible real hoy</span>
          <span className="mono">{money(before)}</span>
        </div>
        <div className="readout">
          <span className="dim">{cardId ? '− Lo que reserva tu tarjeta' : '− La compra'}</span>
          <span className="mono">{money(costNow)}</span>
        </div>
        {drawTotal > 0 && (
          <div className="readout">
            <span className="dim">+ De tus apartados</span>
            <span className="mono">{money(drawTotal)}</span>
          </div>
        )}
        <div className="readout">
          <span className="dim">= Disponible real después</span>
          <span className={`mono${after < 0 ? ' text-heat' : ''}`}>{money(after)}</span>
        </div>
        {parsed
          .filter((d) => (d.amount ?? 0) > 0)
          .map((d) => (
            <div key={d.bucket.uuid} className="readout">
              <span className="dim">{d.bucket.name}</span>
              <span className="mono">{`${money(bucketBalance(d.bucket, data.bucketMoves))} → ${money(roundMoney(bucketBalance(d.bucket, data.bucketMoves) - (d.amount ?? 0)))}`}</span>
            </div>
          ))}
      </div>
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel="Registrar compra" saving={saving} onCancel={onDone} />
    </form>
  )
}

function ApartarForm({ data, item, result, onDone }: { data: MoneyData; item: PlanItem; result: ItemResult | undefined; onDone: () => void }) {
  const drawn = roundMoney(item.bucket_draws.reduce((sum, draw) => sum + draw.amount, 0))
  const target = roundMoney(Math.max(0, item.amount - drawn))
  const when = item.target_date ?? (result?.date ? dateToIso(result.date) : null)
  const [name, setName] = useState(item.name)
  const [withPace, setWithPace] = useState(target > 0 && when !== null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const draft = { uuid: '', updated_at: '', name, rule_type: 'custom' as const, target, target_date: when, account_id: null }
  const pace = when && target > 0 ? targetPace(draft as SavingsBucket, 0, data.recurring, new Date()) : null
  const slot: IncomeSlot = incomeSlots(data.recurring).length > 1 ? 'both' : 'first'
  const available = moneySnapshot(data, new Date()).breakdown.total

  if (target <= 0) {
    return (
      <>
        <FooterHint>Tus apartados ya cubren este deseo.</FooterHint>
        <button type="button" className="panel-verb" onClick={onDone}>
          Cerrar
        </button>
      </>
    )
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return setError('Ponle un nombre al apartado.')
    if (data.buckets.some((bucket) => !bucket.archived && bucket.name.trim().toLowerCase() === trimmed.toLowerCase())) {
      return setError('Ya tienes un apartado con ese nombre.')
    }
    setSaving(true)
    try {
      await apartarForWish(data.buckets, item, {
        name: trimmed,
        target,
        targetDate: when,
        perIncome: withPace ? (pace?.perIncome ?? null) : null,
        income: slot,
      })
      onDone()
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <TextField label="Nombre del apartado" value={name} onChange={(v) => { setName(v); setError(null) }} autoFocus />
      <FieldNote>
        {`Meta ${money(target)}${when ? ` · ${formatDate(isoToDate(when))}` : ''}. El dinero sigue en tu banco hasta que lo apartes. Tu Disponible real hoy sigue en ${money(available)}.`}
      </FieldNote>
      {pace?.perIncome ? (
        <ChoiceField
          label="Aporte planeado"
          value={withPace ? 'yes' : 'no'}
          onChange={(v) => setWithPace(v === 'yes')}
          options={[
            { value: 'yes', label: `${money(pace.perIncome)} por ingreso` },
            { value: 'no', label: 'Sin aporte' },
          ]}
        />
      ) : (
        <FieldNote>Sin fecha o sin ingresos programados, el apartado no propone un aporte por ingreso.</FieldNote>
      )}
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel="Crear apartado" saving={saving} onCancel={onDone} />
    </form>
  )
}

function ItemDossier({
  data,
  item,
  result,
  bought,
  onEdit,
  onClose,
}: {
  data: MoneyData
  item: PlanItem
  result: ItemResult | undefined
  bought: boolean
  onEdit: () => void
  onClose: () => void
}) {
  const [buying, setBuying] = useState(false)
  const [apartar, setApartar] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = (action: () => Promise<void>) => action().catch(() => setError('No se pudo guardar. Intenta de nuevo.'))

  const closeVerb = (
    <button type="button" className="panel-verb" onClick={onClose}>
      Cerrar
    </button>
  )

  if (buying) {
    return (
      <Panel title={`Ya lo compré · ${item.name}`} aside={closeVerb}>
        <BuyForm data={data} item={item} result={result} onDone={() => setBuying(false)} />
      </Panel>
    )
  }

  if (apartar) {
    return (
      <Panel title={`Apartar para esto · ${item.name}`} aside={closeVerb}>
        <ApartarForm data={data} item={item} result={result} onDone={() => setApartar(false)} />
      </Panel>
    )
  }

  const funding = fundingLine(data, item)
  return (
    <Panel title={item.name} aside={closeVerb}>
      <div className="stat-list">
        <div className="readout">
          <span className="dim">{whenLine(item, result)}</span>
          <span className="mono">{money(item.amount)}</span>
        </div>
        {funding && <FieldNote>{funding}</FieldNote>}
      </div>
      {bought ? (
        <FooterHint>Ya lo compraste. Si borras ese movimiento, el deseo vuelve a tu lista.</FooterHint>
      ) : item.status === 'dropped' ? (
        <FooterHint>Lo descartaste. No cuenta en tu plan.</FooterHint>
      ) : !item.enabled ? (
        <FooterHint>Está apagado. Actívalo para ver si alcanza.</FooterHint>
      ) : result && result.date ? (
        <table className="roster roster-stack requirements">
          <thead>
            <tr>
              <th scope="col">Concepto</th>
              <th scope="col" className="num">Requerido</th>
              <th scope="col" className="num">Proyectado</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="roster-title">
                Costo
                <span className="row-sub">{formatDate(result.date)}</span>
              </td>
              <td className="num mono" data-label="Requerido">{money(item.amount)}</td>
              <td className="num mono" data-label="Proyectado">—</td>
            </tr>
            {result.draws.map((draw) => (
              <tr key={draw.bucket.uuid}>
                <td className="roster-title">
                  De {draw.bucket.name}
                  {draw.granted < draw.requested && <span className="row-sub text-amber">{`Solo tendría ${money(draw.granted)} ese día`}</span>}
                </td>
                <td className="num mono" data-label="Requerido">{money(draw.requested)}</td>
                <td className={`num mono${draw.granted < draw.requested ? ' text-amber' : ''}`} data-label="Proyectado">{money(draw.granted)}</td>
              </tr>
            ))}
            <tr>
              <td className="roster-title">
                De Disponible real
                <span className="row-sub">Con los deseos de arriba</span>
              </td>
              <td className="num mono" data-label="Requerido">{money(result.fromAvailable)}</td>
              <td className={`num mono${result.before < result.fromAvailable ? ' text-heat' : ''}`} data-label="Proyectado">{money(result.before)}</td>
            </tr>
            <tr>
              <td className="roster-title">Después de comprar</td>
              <td className="num mono" data-label="Requerido">0 o más</td>
              <td className={`num mono${result.after < 0 ? ' text-heat' : ''}`} data-label="Proyectado">{money(result.after)}</td>
            </tr>
            {result.lowest && (
              <tr>
                <td className="roster-title">
                  Punto más bajo después
                  <span className="row-sub">{formatDate(result.lowest.date)}</span>
                </td>
                <td className="num mono" data-label="Requerido">0 o más</td>
                <td className={`num mono${result.lowest.available < 0 ? ' text-heat' : ''}`} data-label="Proyectado">{money(result.lowest.available)}</td>
              </tr>
            )}
            {result.card && (
              <tr>
                <td className="roster-title">Deuda en {result.card.card.name}</td>
                <td className="num mono" data-label="Hoy">{money(result.card.card.current_balance)}</td>
                <td className="num mono" data-label="Después">{money(result.card.debtAfter)}</td>
              </tr>
            )}
          </tbody>
        </table>
      ) : (
        <FooterHint>{`Con tus ingresos y pagos, no alcanza en los próximos ${PLAN_ASAP_MONTHS} meses. Puedes bajar el monto, usar apartados o ponerle fecha.`}</FooterHint>
      )}
      {result?.status === 'short' && result.date && (
        <FooterHint>{`Con este deseo faltarían ${money(result.short)} el ${formatDate(result.lowest!.date)}.`}</FooterHint>
      )}
      {!bought && (
        <div className="verb-row">
          {item.status === 'planned' && (
            <>
              <button type="button" className="verb-button verb-primary" onClick={() => setBuying(true)}>
                <span className="key-glyph">A</span>
                Ya lo compré
              </button>
              <button type="button" className="verb-button" onClick={onEdit}>
                <span className="key-glyph">E</span>
                Editar
              </button>
              <button type="button" className="verb-button" onClick={() => setApartar(true)}>
                <span className="key-glyph">P</span>
                Apartar para esto
              </button>
              <button type="button" className="verb-button" onClick={() => void run(() => updatePlanItem(item, { status: 'dropped' }))}>
                <span className="key-glyph">D</span>
                Descartar
              </button>
            </>
          )}
          {item.status === 'dropped' && (
            <button type="button" className="verb-button" onClick={() => void run(() => updatePlanItem(item, { status: 'planned' }))}>
              <span className="key-glyph">R</span>
              Restaurar
            </button>
          )}
          {confirming ? (
            <button type="button" className="verb-button text-heat" onClick={() => void run(() => removePlanItem(item)).then(onClose)}>
              <span className="key-glyph">X</span>
              Confirmar quitar
            </button>
          ) : (
            <button type="button" className="verb-button" onClick={() => setConfirming(true)}>
              <span className="key-glyph">X</span>
              Quitar
            </button>
          )}
        </div>
      )}
      {error && <FieldError>{error}</FieldError>}
    </Panel>
  )
}

function ContributionForm({ data, onDone }: { data: MoneyData; onDone: () => void }) {
  const buckets = data.buckets.filter((b) => !b.archived)
  const [bucketId, setBucketId] = useState(buckets[0]?.uuid ?? '')
  const [amount, setAmount] = useState('')
  const [slot, setSlot] = useState<IncomeSlot>('both')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const value = parseAmount(amount)
    if (!bucketId) return setError('Elige un apartado.')
    if (value === null || value <= 0) return setError('Escribe un monto mayor a cero.')
    setSaving(true)
    try {
      await addPlannedContribution({ bucket_id: bucketId, amount: value, income_slot: slot })
      onDone()
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <div className="field-row">
        <SelectField label="Apartado" value={bucketId} onChange={setBucketId} options={buckets.map((b) => ({ value: b.uuid, label: b.name }))} />
        <AmountField label="Por ingreso (MXN)" value={amount} onChange={(v) => { setAmount(v); setError(null) }} autoFocus />
      </div>
      <ChoiceField label="Con qué ingreso" value={slot} onChange={setSlot} options={SLOT_OPTIONS} />
      <FieldNote>Solo cuenta en el plan. No aparta nada hasta que tú lo hagas en Ahorro. Se detiene al llegar a la meta.</FieldNote>
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel="Agregar aporte" saving={saving} onCancel={onDone} />
    </form>
  )
}

function BucketsPanel({
  data,
  result,
  contributions,
  includeRules,
}: {
  data: MoneyData
  result: PlanResult
  contributions: PlannedContribution[]
  includeRules: boolean
}) {
  const [adding, setAdding] = useState(false)
  const [ruling, setRuling] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ruleRow = contributions.find((row) => row.uuid === ruling)
  const ruleBucket = data.buckets.find((bucket) => bucket.uuid === ruleRow?.bucket_id && bucket.rule_type === 'custom' && !bucket.archived)
  const run = (action: () => Promise<void>) => action().catch(() => setError('No se pudo guardar. Intenta de nuevo.'))
  const rows = result.buckets.filter((row) => row.today !== 0 || row.end !== 0 || row.bucket.target)
  const scale = Math.max(1, ...rows.map((row) => Math.max(row.end, row.today, row.bucket.target ?? 0)))
  const endLabel = formatDate(result.horizon)

  return (
    <Panel title="Apartados proyectados">
      {data.settings && (
        <ChoiceField
          label="Incluir reglas de ahorro"
          value={includeRules ? 'yes' : 'no'}
          onChange={(v) => void run(() => setPlanSettings(data.settings!, { include_rules: v === 'yes' }))}
          options={[
            { value: 'yes', label: 'Sí' },
            { value: 'no', label: 'No' },
          ]}
        />
      )}
      {rows.length === 0 ? (
        <FooterHint>Sin apartados con saldo ni aportes en el plan.</FooterHint>
      ) : (
        <div className="stat-list">
          {rows.map((row) => {
            const target = row.bucket.target ?? 0
            const notes = [
              row.contributed > 0 ? `+${money(row.contributed)} de reglas y aportes` : '',
              row.drawn > 0 ? `−${money(row.drawn)} para deseos` : '',
              row.reachedOn ? `Meta el ${formatDate(row.reachedOn)}` : target > 0 && row.end < target ? `Faltarían ${money(roundMoney(target - row.end))} para la meta` : '',
            ].filter(Boolean)
            return (
              <div key={row.bucket.uuid}>
                <StatBar
                  label={row.bucket.name}
                  value={`${money(row.today)} → ${money(row.end)}`}
                  ratio={target > 0 ? row.end / target : row.end / scale}
                  marker={target > 0 ? row.today / target : row.today / scale}
                  tone={row.end < 0 ? 'shortfall' : 'safe'}
                />
                {notes.length > 0 && <span className="row-sub">{notes.join(' · ')}</span>}
              </div>
            )
          })}
        </div>
      )}
      <FooterHint>{`La línea marca el saldo de hoy; la barra, el saldo proyectado al ${endLabel}.`}</FooterHint>

      <h3 className="field-label">Aportes planeados</h3>
      {contributions.length > 0 && (
        <div className="roster-fit">
          <table className="roster roster-stack">
            <tbody>
              {contributions.map((row) => (
                <tr key={row.uuid} className={row.enabled ? undefined : 'dim'}>
                  <td className="roster-title">
                    {bucketName(data, row.bucket_id)}
                    <span className="row-sub">{SLOT_LABEL[row.income_slot]}</span>
                  </td>
                  <td className="num mono" data-label="Monto">{money(row.amount)}</td>
                  <td className="row-actions">
                    <span className="panel-verbs">
                      <button type="button" className="panel-verb" role="switch" aria-checked={row.enabled} onClick={() => void run(() => setContributionEnabled(row, !row.enabled))}>
                        {row.enabled ? 'Activo' : 'Apagado'}
                      </button>
                      {data.buckets.some((bucket) => bucket.uuid === row.bucket_id && bucket.rule_type === 'custom' && !bucket.archived) && (
                        <button type="button" className="panel-verb" onClick={() => setRuling(row.uuid)}>
                          Hacerlo regla
                        </button>
                      )}
                      <button type="button" className="panel-verb" onClick={() => void run(() => removePlannedContribution(row))}>
                        Quitar
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ruleRow && ruleBucket && (
        <>
          <FieldNote>
            {`${ruleBucket.name} apartará ${money(ruleRow.amount)} ${SLOT_LABEL[ruleRow.income_slot].toLowerCase()}. Hoy tu Disponible real sigue en ${money(moneySnapshot(data, new Date()).breakdown.total)}.`}
            {ruleBucket.income_share ? ` Reemplaza los ${money(ruleBucket.income_share.amount)} actuales.` : ''}
          </FieldNote>
          <div className="verb-row">
            <button type="button" className="verb-button verb-primary" onClick={() => void run(() => makeContributionARule(ruleBucket, ruleRow)).then(() => setRuling(null))}>
              Confirmar
            </button>
            <button type="button" className="verb-button" onClick={() => setRuling(null)}>
              Cancelar
            </button>
          </div>
        </>
      )}
      {adding ? (
        <ContributionForm data={data} onDone={() => setAdding(false)} />
      ) : (
        data.buckets.some((b) => !b.archived) && (
          <button type="button" className="panel-verb" onClick={() => setAdding(true)}>
            + Aporte planeado
          </button>
        )
      )}
      {error && <FieldError>{error}</FieldError>}
    </Panel>
  )
}

export function Plan({ data, header }: { data: MoneyData; header: ReactNode }) {
  const today = new Date()
  const items = useRecords<PlanItem>('plan_items') ?? []
  const contributions = useRecords<PlannedContribution>('planned_contributions') ?? []
  const includeRules = data.settings?.plan?.include_rules ?? true
  const scheduledMonthly = scheduledMonthlyIncome(data.recurring)
  const habit = habitualDailySpend(data.transactions, today)
  const [incomeMonthly, setIncomeMonthly] = useState(scheduledMonthly)
  const [dailySpend, setDailySpend] = useState(Math.round(habit.perDay / DAILY_STEP) * DAILY_STEP)
  const [extra, setExtra] = useState(0)
  const [scenario, setScenario] = useState<IncomeScenarioId>('base')
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dossierRef = useDossierSheet(selected, () => setSelected(null))
  const formRef = useScrollIntoView(selected === NEW_ITEM ? NEW_ITEM : null)

  const incomeFactor = scheduledMonthly > 0 ? incomeMonthly / scheduledMonthly : 1
  const results = INCOME_SCENARIOS.map((s) => ({
    ...s,
    result: projectPlan(data, today, { items, contributions, includeRules, incomeFactor: incomeFactor * s.factor, extraExpenses: extra, dailySpend }),
  }))
  const chosen = results.find((r) => r.id === scenario)!.result
  const byId = new Map(chosen.items.map((r) => [r.item.uuid, r]))
  const sorted = sortItems(items)
  const open = sorted.filter((item) => item.status === 'planned' && !isBought(item, data.transactions))
  const bought = sorted.filter((item) => isBought(item, data.transactions))
  const dropped = sorted.filter((item) => item.status === 'dropped' && !isBought(item, data.transactions))
  const selectedItem = items.find((item) => item.uuid === selected) ?? null
  const creating = selected === NEW_ITEM
  const tone = planTone(chosen)
  const run = (action: () => Promise<void>) => action().catch(() => setError('No se pudo guardar. Intenta de nuevo.'))

  const select = (uuid: string | null) => {
    setSelected(uuid === selected ? null : uuid)
    setEditing(false)
  }

  const roster = (rows: PlanItem[], reorder: boolean) => (
    <div className="roster-fit">
      <table className="roster roster-stack">
        <tbody>
          {rows.map((item, index) => (
            <tr
              key={item.uuid}
              className={`roster-row${item.enabled && item.status === 'planned' ? '' : ' dim'}`}
              aria-selected={item.uuid === selected}
              tabIndex={0}
              onClick={() => select(item.uuid)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') select(item.uuid)
              }}
            >
              <td className="roster-title">
                {item.name}
                <span className="row-sub">{[whenLine(item, byId.get(item.uuid)), fundingLine(data, item)].filter(Boolean).join(' · ')}</span>
              </td>
              <td className="num mono" data-label="Monto">{money(item.amount)}</td>
              <td data-label="Estado">{reorder ? <StatusCell item={item} result={byId.get(item.uuid)} /> : <span className="dim">{item.status === 'dropped' ? 'Descartado' : 'Comprado'}</span>}</td>
              <td className="row-actions" onClick={(event) => event.stopPropagation()}>
                {reorder && (
                  <span className="panel-verbs">
                    <button type="button" className="panel-verb" role="switch" aria-checked={item.enabled} onClick={() => void run(() => updatePlanItem(item, { enabled: !item.enabled }))}>
                      {item.enabled ? 'Activo' : 'Apagado'}
                    </button>
                    <button type="button" className="panel-verb" aria-label="Subir" disabled={index === 0} onClick={() => void run(() => swapPlanOrder(item, rows[index - 1]))}>
                      ‹
                    </button>
                    <button type="button" className="panel-verb" aria-label="Bajar" disabled={index === rows.length - 1} onClick={() => void run(() => swapPlanOrder(item, rows[index + 1]))}>
                      ›
                    </button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="stage-grid">
      <div className="stage-main">
        {header}
        <Panel title="Punto más bajo con tu plan">
          <p className={`hero-figure tone-${tone}`}>
            {formatAmount(chosen.lowest.available)}
            <span className="hero-currency">MXN</span>
          </p>
          <FooterHint>
            {chosen.items.length === 0
              ? 'Sin deseos activos, es tu proyección con tus pagos y reglas.'
              : chosen.lowest.available < 0
                ? `Con este plan faltarían ${money(-chosen.lowest.available)} el ${formatDate(chosen.lowest.date)}.`
                : `El ${formatDate(chosen.lowest.date)}, con tus deseos activos y tus reglas de ahorro.`}
          </FooterHint>
          <div className="verb-row">
            <button type="button" className="verb-button" onClick={() => select(NEW_ITEM)}>
              <span className="key-glyph">N</span>
              Agregar deseo
            </button>
          </div>
        </Panel>

        <Panel title="Lista de deseos">
          {open.length === 0 ? <FooterHint>Agrega lo que quieres comprar y mira cuándo te alcanza.</FooterHint> : roster(open, true)}
          {error && <FieldError>{error}</FieldError>}
        </Panel>

        <div className="grade-row">
          {results.map((s) => (
            <GradeCard
              key={s.id}
              grade={s.grade}
              title={`${s.title} · ingreso ×${s.factor}`}
              value={money(s.result.lowest.available)}
              meta={`Punto más bajo · ${formatDate(s.result.lowest.date)}`}
              tone={planTone(s.result)}
              selected={scenario === s.id}
              onSelect={() => setScenario(s.id)}
            />
          ))}
        </div>

        <BucketsPanel data={data} result={chosen} contributions={contributions} includeRules={includeRules} />

        <Panel title="Supuestos">
          <div className="form">
            {scheduledMonthly > 0 ? (
              <RangeField
                label="Ingreso esperado al mes"
                value={incomeMonthly}
                display={money(incomeMonthly)}
                min={0}
                max={Math.ceil((scheduledMonthly * 2) / INCOME_STEP) * INCOME_STEP}
                step={INCOME_STEP}
                onChange={setIncomeMonthly}
              />
            ) : (
              <FieldNote>Sin montos en tus días de ingreso, el plan no suma ingresos futuros. Agrégalos en Pagos fijos.</FieldNote>
            )}
            <RangeField
              label="Gasto diario habitual"
              value={dailySpend}
              display={money(dailySpend)}
              min={0}
              max={Math.max(2000, Math.ceil((habit.perDay * 3) / 100) * 100)}
              step={DAILY_STEP}
              onChange={setDailySpend}
            />
            <RangeField label="Gastos extra en el plan" value={extra} display={money(extra)} min={0} max={20000} step={EXTRA_STEP} onChange={setExtra} />
          </div>
        </Panel>

        {(bought.length > 0 || dropped.length > 0) && (
          <Panel title="Comprados y descartados">{roster([...bought, ...dropped], false)}</Panel>
        )}

        <FooterHint>
          Nada de esto aparta ni gasta. Solo Ya lo compré registra el movimiento.
          {chosen.unknownIncome > 0 ? ' Los ingresos sin monto no se cuentan.' : ''}
        </FooterHint>
      </div>

      {creating || (selectedItem && editing) ? (
        <aside ref={dossierRef} className="dossier dossier-sheet" tabIndex={-1} aria-label={creating ? 'Nuevo deseo' : 'Editar deseo'}>
          <div ref={formRef}>
            <Panel title={creating ? 'Nuevo deseo' : `Editar · ${selectedItem!.name}`}>
              <ItemForm
                key={selectedItem?.uuid ?? NEW_ITEM}
                data={data}
                item={creating ? null : selectedItem}
                items={items}
                onDone={(uuid) => {
                  setEditing(false)
                  setSelected(uuid)
                }}
              />
            </Panel>
          </div>
        </aside>
      ) : selectedItem ? (
        <aside ref={dossierRef} className="dossier dossier-sheet" tabIndex={-1} aria-label={selectedItem.name}>
          <ItemDossier
            key={selectedItem.uuid}
            data={data}
            item={selectedItem}
            result={byId.get(selectedItem.uuid)}
            bought={isBought(selectedItem, data.transactions)}
            onEdit={() => setEditing(true)}
            onClose={() => setSelected(null)}
          />
        </aside>
      ) : (
        <aside className="dossier" aria-label="Disponible real por ingreso">
          <Panel title="Disponible real por ingreso">
            <table className="roster">
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col" className="num">Sin deseos</th>
                  <th scope="col" className="num">Con deseos</th>
                </tr>
              </thead>
              <tbody>
                {chosen.points.map((point, index) => (
                  <tr key={point.date.getTime()}>
                    <td className="mono dim">
                      {formatDate(point.date)}
                      {index === 0 && <span className="row-sub">Hoy</span>}
                    </td>
                    <td className={`num mono${point.base < 0 ? ' text-heat' : ''}`}>{money(point.base)}</td>
                    <td className={`num mono${point.available < 0 ? ' text-heat' : ''}`}>{money(point.available)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <FooterHint>
              {includeRules
                ? 'Cada fila ya descuenta tus pagos y lo que tus reglas apartarían ese día.'
                : 'Cada fila ya descuenta tus pagos. Las reglas de ahorro no se incluyen.'}
            </FooterHint>
          </Panel>
        </aside>
      )}
    </div>
  )
}
