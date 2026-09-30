import { useState, type ReactNode } from 'react'
import { useDossierSheet } from '../components/mobile'
import { TextField } from '../components/fields'
import { FooterHint, Panel, Rail, Series } from '../components/hud'
import type { MoneyData } from '../db/useMoneyData'
import { isoToDate } from '../lib/dates'
import { formatAmount, formatDate, formatMoney } from '../lib/format'
import { roundMoney } from '../lib/money'
import {
  BASE_UNIT,
  cheapestRecent,
  formatUnitPrice,
  normalizeName,
  observationsOf,
  placeName,
  priceRoster,
  refundTransactionIds,
  RECENT_DAYS,
  type PriceObservation,
  type PriceRow,
  type UnitFamily,
} from '../lib/priceBook'

const FAMILY_LABEL: Record<UnitFamily, string> = { piece: 'Por pieza', weight: 'Por kg', volume: 'Por litro' }
const ALL_PLACES = 'all'
const NO_PLACE_KEY = 'none'
const SERIES_MAX = 24

const shortDate = (iso: string) => isoToDate(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })

function lastPriceLabel(row: PriceRow): string {
  return row.last ? formatUnitPrice(row.last.price, row.last.family) : `${formatMoney(row.lastLine.line_total, 'MXN')} · sin precio unitario`
}

function ItemDossier({ row, data, onClose }: { row: PriceRow; data: MoneyData; onClose: () => void }) {
  const observations = observationsOf(row.item.uuid, data.lines, data.places, refundTransactionIds(data.transactions))
  const families = [...new Set(observations.map((o) => o.family))]
  const [family, setFamily] = useState<UnitFamily | null>(row.last?.family ?? families[0] ?? null)
  const [placeFilter, setPlaceFilter] = useState(ALL_PLACES)
  const inFamily = observations.filter((o) => o.family === family)
  const placeKey = (o: PriceObservation) => o.line.place_id ?? NO_PLACE_KEY
  const placeItems = [
    { id: ALL_PLACES, label: 'Todos' },
    ...[...new Map(inFamily.map((o) => [placeKey(o), placeName(o.place)])).entries()].map(([id, label]) => ({ id, label })),
  ]
  const shown = placeFilter === ALL_PLACES ? inFamily : inFamily.filter((o) => placeKey(o) === placeFilter)
  const last = inFamily[inFamily.length - 1] ?? null
  const cheapest = cheapestRecent(inFamily, new Date())
  const gap = last && cheapest ? roundMoney(last.price - cheapest.price) : 0

  return (
    <Panel
      title={row.item.name}
      aside={
        <button type="button" className="panel-verb" onClick={onClose}>
          Cerrar
        </button>
      }
    >
      {last && family ? (
        <p className="hero-figure">
          {formatAmount(last.price)}
          <span className="hero-currency">MXN / {BASE_UNIT[family]}</span>
        </p>
      ) : (
        <FooterHint>Sin cantidad en sus compras, así que no hay precio unitario que comparar.</FooterHint>
      )}
      {families.length > 1 && family && (
        <Rail label="Unidad" items={families.map((f) => ({ id: f, label: FAMILY_LABEL[f] }))} active={family} onSelect={(next) => { setFamily(next); setPlaceFilter(ALL_PLACES) }} />
      )}
      {placeItems.length > 2 && <Rail label="Lugar" items={placeItems} active={placeFilter} onSelect={setPlaceFilter} />}
      {shown.length > 0 && family && (
        <Series
          label={`Precio de ${row.item.name} por fecha`}
          columns={shown.slice(-SERIES_MAX).map((o) => ({
            key: o.line.uuid,
            label: shortDate(o.line.date),
            value: o.price,
            display: formatAmount(o.price),
          }))}
        />
      )}
      {last && cheapest && family && (
        <>
          <table className="roster requirements">
            <thead>
              <tr>
                <th scope="col" className="wrap">Últimos {RECENT_DAYS} días</th>
                <th scope="col">Lugar</th>
                <th scope="col" className="num">{`MXN / ${BASE_UNIT[family]}`}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="dim wrap">Más barato · {shortDate(cheapest.line.date)}</td>
                <td>{placeName(cheapest.place)}</td>
                <td className="num mono">{formatAmount(cheapest.price)}</td>
              </tr>
              <tr>
                <td className="dim wrap">Último pagado · {shortDate(last.line.date)}</td>
                <td>{placeName(last.place)}</td>
                <td className={`num mono${gap > 0 ? ' text-amber' : ''}`}>{formatAmount(last.price)}</td>
              </tr>
            </tbody>
          </table>
          <FooterHint>
            {gap > 0
              ? `En ${placeName(cheapest.place)} estuvo ${formatMoney(gap, 'MXN')} / ${BASE_UNIT[family]} más barato.`
              : 'Tu última compra fue la más barata reciente.'}
          </FooterHint>
        </>
      )}
      <div className="roster-fit">
      <table className="roster roster-stack">
        <thead>
          <tr>
            <th scope="col">Fecha</th>
            <th scope="col">Lugar</th>
            <th scope="col" className="num">Cant.</th>
            <th scope="col" className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {data.lines
            .filter((line) => line.item_id === row.item.uuid)
            .filter((line) => placeFilter === ALL_PLACES || (line.place_id ?? NO_PLACE_KEY) === placeFilter)
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((line) => (
              <tr key={line.uuid}>
                <td className="mono dim roster-title">{formatDate(isoToDate(line.date))}</td>
                <td data-label="Lugar">{placeName(data.places.find((p) => p.uuid === line.place_id) ?? null)}</td>
                <td className="num mono" data-label="Cant.">{line.qty === null ? '—' : `${line.qty} ${line.unit}`}</td>
                <td className="num mono" data-label="Total">{formatAmount(line.line_total)}</td>
              </tr>
            ))}
        </tbody>
      </table>
      </div>
    </Panel>
  )
}

export function Precios({ header, data }: { header: ReactNode; data: MoneyData }) {
  const [selected, setSelected] = useState<string | null>(null)
  const dossierRef = useDossierSheet(selected, () => setSelected(null))
  const [query, setQuery] = useState('')
  const roster = priceRoster(data.items, data.lines, data.places, refundTransactionIds(data.transactions))
  const needle = normalizeName(query)
  const rows = needle ? roster.filter((row) => row.item.normalized_name.includes(needle)) : roster
  const selectedRow = roster.find((row) => row.item.uuid === selected)

  return (
    <div className={`stage-grid${selectedRow ? '' : ' stage-grid--single'}`}>
      <div className="stage-main">
        {header}
        {roster.length === 0 ? (
          <Panel>
            <FooterHint>Los precios aparecen cuando agregues productos a un gasto.</FooterHint>
          </Panel>
        ) : (
          <>
            {roster.length > 8 && <TextField label="Buscar producto" value={query} onChange={setQuery} placeholder="Ej. leche" />}
            <Panel>
              <div className="roster-fit">
              <table className="roster roster-stack">
                <thead>
                  <tr>
                    <th scope="col">Producto</th>
                    <th scope="col" className="num">Último precio</th>
                    <th scope="col">Lugar</th>
                    <th scope="col">Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr className="roster-empty">
                      <td colSpan={4}>—</td>
                    </tr>
                  )}
                  {rows.map((row) => (
                    <tr
                      key={row.item.uuid}
                      className="roster-row"
                      aria-selected={row.item.uuid === selected}
                      tabIndex={0}
                      onClick={() => setSelected(row.item.uuid === selected ? null : row.item.uuid)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') setSelected(row.item.uuid === selected ? null : row.item.uuid)
                      }}
                    >
                      <td className="roster-title">
                        {row.item.name}
                        {row.count > 1 && <span className="row-sub">{row.count} compras</span>}
                      </td>
                      <td className="num mono" data-label="Último precio">{lastPriceLabel(row)}</td>
                      <td className="dim" data-label="Lugar">{placeName(row.place)}</td>
                      <td className="mono dim" data-label="Fecha">{formatDate(isoToDate(row.lastLine.date))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </Panel>
            <FooterHint>Los precios se comparan por kg, por litro o por pieza. Toca un producto para ver su historial.</FooterHint>
          </>
        )}
      </div>
      {selectedRow && (
        <aside ref={dossierRef} className="dossier dossier-sheet" tabIndex={-1} aria-label={selectedRow.item.name}>
          <ItemDossier key={selectedRow.item.uuid} row={selectedRow} data={data} onClose={() => setSelected(null)} />
        </aside>
      )}
    </div>
  )
}
