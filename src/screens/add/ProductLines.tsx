import { ChoiceField, FieldNote, SelectField, TextField } from '../../components/fields'
import type { PlaceDraft } from '../../db/priceBook'
import type { Item, Place, PriceUnit } from '../../db/types'
import { formatMoney } from '../../lib/format'
import { roundMoney } from '../../lib/money'
import { parseAmount } from '../../lib/parseAmount'
import {
  comparablePrice,
  emptyLine,
  formatUnitPrice,
  matchName,
  NEW_ITEM,
  NEW_PLACE,
  NO_PLACE,
  pendingMatch,
  PLACE_KINDS,
  PRICE_UNITS,
  resolveLine,
  type LineDraft,
} from '../../lib/priceBook'

const ITEM_LIST_ID = 'price-book-items'

function LineRow({
  draft,
  items,
  invalid,
  onChange,
  onRemove,
}: {
  draft: LineDraft
  items: Item[]
  invalid: boolean
  onChange: (next: LineDraft) => void
  onRemove: () => void
}) {
  const near = pendingMatch(draft, items)
  const confirmed = draft.itemChoice && draft.itemChoice !== NEW_ITEM ? items.find((i) => i.uuid === draft.itemChoice) : undefined
  const resolved = resolveLine(draft, parseAmount)
  const priced = 'error' in resolved || resolved.unit_price === null ? null : comparablePrice(draft.unit, resolved.unit_price)

  function rename(name: string) {
    const exact = matchName(name, items).exact
    onChange({ ...draft, name, itemChoice: null, unit: exact && !draft.qty.trim() ? exact.default_unit : draft.unit })
  }

  return (
    <li className={`product-line${invalid ? ' is-invalid' : ''}`}>
      <div className="product-line-head">
        <TextField label="Producto" value={draft.name} onChange={rename} placeholder="Ej. Leche" list={ITEM_LIST_ID} invalid={invalid} />
        <button type="button" className="panel-verb" onClick={onRemove}>
          Quitar
        </button>
      </div>
      <div className="product-line-grid">
        <TextField label="Cant." value={draft.qty} onChange={(qty) => onChange({ ...draft, qty })} inputMode="decimal" placeholder="1" mono />
        <SelectField label="Unidad" value={draft.unit} onChange={(unit) => onChange({ ...draft, unit: unit as PriceUnit })} options={PRICE_UNITS.map((u) => ({ value: u, label: u }))} />
        <TextField label="Precio c/u" value={draft.unitPrice} onChange={(unitPrice) => onChange({ ...draft, unitPrice })} inputMode="decimal" placeholder="0.00" mono />
        <TextField label="Total" value={draft.total} onChange={(total) => onChange({ ...draft, total })} inputMode="decimal" placeholder="0.00" mono />
      </div>
      {near.length > 0 ? (
        <div className="product-match">
          <span className="dim">¿Es {near.length === 1 ? `«${near[0].name}»` : 'uno de estos'}?</span>
          <div className="verb-row">
            {near.slice(0, 3).map((item) => (
              <button key={item.uuid} type="button" className="verb-button" onClick={() => onChange({ ...draft, itemChoice: item.uuid })}>
                Sí, {item.name}
              </button>
            ))}
            <button type="button" className="verb-button" onClick={() => onChange({ ...draft, itemChoice: NEW_ITEM })}>
              Es otro
            </button>
          </div>
        </div>
      ) : (
        <FieldNote>
          {confirmed ? `Se guarda como ${confirmed.name}. ` : ''}
          {'error' in resolved
            ? draft.name.trim()
              ? 'Escribe el total, o la cantidad y el precio.'
              : ''
            : priced
              ? `${formatMoney(resolved.line_total, 'MXN')} · ${formatUnitPrice(priced.price, priced.family)}`
              : `${formatMoney(resolved.line_total, 'MXN')} · sin cantidad, sin precio unitario`}
        </FieldNote>
      )}
    </li>
  )
}

export function ProductLines({
  lines,
  onLines,
  items,
  places,
  placeId,
  onPlaceId,
  placeDraft,
  onPlaceDraft,
  invalidKey,
  amount,
  onUseSum,
}: {
  lines: LineDraft[]
  onLines: (lines: LineDraft[]) => void
  items: Item[]
  places: Place[]
  placeId: string
  onPlaceId: (id: string) => void
  placeDraft: PlaceDraft
  onPlaceDraft: (draft: PlaceDraft) => void
  invalidKey: string | null
  amount: number | null
  onUseSum: (sum: number) => void
}) {
  const totals = lines.map((line) => resolveLine(line, parseAmount)).flatMap((r) => ('error' in r ? [] : [r.line_total]))
  const sum = roundMoney(totals.reduce((a, b) => a + b, 0))

  return (
    <fieldset className="product-lines">
      <legend className="field-label">Productos</legend>
      <SelectField
        label="Lugar"
        value={placeId}
        onChange={onPlaceId}
        options={[{ value: '', label: NO_PLACE }, ...places.map((p) => ({ value: p.uuid, label: p.area ? `${p.name} · ${p.area}` : p.name })), { value: NEW_PLACE, label: '+ Nuevo lugar' }]}
      />
      {placeId === NEW_PLACE && (
        <>
          <TextField label="Nombre del lugar" value={placeDraft.name} onChange={(name) => onPlaceDraft({ ...placeDraft, name })} placeholder="Ej. Chedraui" />
          <ChoiceField label="Tipo" value={placeDraft.kind} onChange={(kind) => onPlaceDraft({ ...placeDraft, kind })} options={PLACE_KINDS} />
          <TextField label="Colonia o ciudad" value={placeDraft.area} onChange={(area) => onPlaceDraft({ ...placeDraft, area })} placeholder="Opcional" />
        </>
      )}
      <ul className="product-list">
        {lines.map((line) => (
          <LineRow
            key={line.key}
            draft={line}
            items={items}
            invalid={line.key === invalidKey}
            onChange={(next) => onLines(lines.map((l) => (l.key === line.key ? next : l)))}
            onRemove={() => onLines(lines.filter((l) => l.key !== line.key))}
          />
        ))}
      </ul>
      <datalist id={ITEM_LIST_ID}>
        {items.map((item) => (
          <option key={item.uuid} value={item.name} />
        ))}
      </datalist>
      <div className="verb-row">
        <button type="button" className="verb-button" onClick={() => onLines([...lines, emptyLine()])}>
          <span className="key-glyph">+</span>
          Otro producto
        </button>
        {amount !== null && sum > 0 && sum !== amount && (
          <button type="button" className="verb-button" onClick={() => onUseSum(sum)}>
            Usar {formatMoney(sum, 'MXN')} como monto
          </button>
        )}
      </div>
      {amount !== null && sum > 0 && sum !== amount && (
        <FieldNote>
          Los productos suman {formatMoney(sum, 'MXN')} y el gasto es {formatMoney(amount, 'MXN')}. Puede faltar algo del ticket; se guarda igual.
        </FieldNote>
      )}
      <FieldNote>Los productos solo explican el gasto. No cambian tu saldo ni tu Disponible real.</FieldNote>
    </fieldset>
  )
}
