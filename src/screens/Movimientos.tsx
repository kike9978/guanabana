import { useState } from 'react'
import { isEditable, MOVEMENT_VIEWS, type EditableTransaction, type MovementView } from '../app/navigation'
import { AiBridge } from '../components/AiBridge'
import { FooterHint, Panel, Rail } from '../components/hud'
import { StageHeader } from '../components/StageHeader'
import { deleteTransaction, LedgerBlockedError } from '../db/ledger'
import type { Transaction } from '../db/types'
import { UNCATEGORIZED_KEY } from '../db/seed'
import { useMoneyData, type MoneyData } from '../db/useMoneyData'
import { isoToDate } from '../lib/dates'
import { formatDate, formatMoney } from '../lib/format'
import { categoryLabel, matchesCategory } from '../lib/categories'
import { isMsi } from '../lib/msi'
import { inRange, rangeLabel, spendMethod, type ExpenseFocus, type StatsWindow } from '../lib/stats'
import { Estadisticas } from './Estadisticas'
import { Precios } from './Precios'

type MethodFilter = 'all' | 'bank' | 'cash' | 'credit_card'

const FILTERS: { id: MethodFilter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'bank', label: 'Banco' },
  { id: 'cash', label: 'Efectivo' },
  { id: 'credit_card', label: 'TDC' },
]

const TYPE_LABEL: Record<Transaction['type'], string> = {
  income: 'Ingreso',
  expense: 'Gasto',
  transfer: 'Transferencia',
  cc_payment: 'Pago TDC',
  adjustment: 'Ajuste',
}

const EMPTY_LIST = 'Aún no hay movimientos. Usa Agregar para registrar el primero.'

function describe(tx: Transaction, data: MoneyData) {
  const account = (id: string | null) => data.accounts.find((a) => a.uuid === id)?.name ?? '—'
  const card = data.cards.find((c) => c.uuid === tx.cc_id)?.name ?? '—'
  const category = categoryLabel(tx.category_id, data.categories)

  switch (tx.type) {
    case 'expense':
      return {
        concept: tx.amount < 0 ? `Reembolso · ${category ?? 'Gasto'}` : (category ?? 'Gasto'),
        source: tx.cc_id ? card : account(tx.account_id),
        signed: -tx.amount,
      }
    case 'income':
      return { concept: category ?? 'Ingreso', source: account(tx.account_id), signed: tx.amount }
    case 'transfer':
      return { concept: 'Transferencia', source: `${account(tx.account_id)} → ${account(tx.to_account_id)}`, signed: 0 }
    case 'cc_payment':
      return { concept: `Pago ${card}`, source: account(tx.account_id), signed: -tx.amount }
    case 'adjustment':
      return tx.cc_id
        ? { concept: 'Ajuste de saldo', source: card, signed: -tx.amount }
        : { concept: 'Ajuste de saldo', source: account(tx.account_id), signed: tx.amount }
  }
}

function matchesFilter(tx: Transaction, filter: MethodFilter, data: MoneyData): boolean {
  if (filter === 'all') return true
  if (filter === 'credit_card') return tx.cc_id !== null
  const type = filter === 'bank' ? 'checking' : 'cash'
  return [tx.account_id, tx.to_account_id].some((id) => data.accounts.find((a) => a.uuid === id)?.type === type)
}

function matchesFocus(tx: Transaction, focus: ExpenseFocus, data: MoneyData, fallbackId: string | null): boolean {
  if (tx.type !== 'expense' || !inRange(tx, focus.range)) return false
  if (focus.categoryId) {
    const id = tx.category_id ?? fallbackId
    if (focus.exact ? id !== focus.categoryId : !matchesCategory(id, focus.categoryId, data.categories)) return false
  }
  return !focus.method || spendMethod(tx, data.accounts) === focus.method
}

function TransactionList({
  data,
  onEdit,
  focus,
  onClearFocus,
}: {
  data: MoneyData
  onEdit: (tx: EditableTransaction) => void
  focus: ExpenseFocus | null
  onClearFocus: () => void
}) {
  const [filter, setFilter] = useState<MethodFilter>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fallbackId = data.categories.find((c) => c.key === UNCATEGORIZED_KEY)?.uuid ?? null

  const rows = data.transactions
    .filter((tx) => (focus ? matchesFocus(tx, focus, data, fallbackId) : matchesFilter(tx, filter, data)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.updated_at.localeCompare(a.updated_at))
  const selectedTx = rows.find((tx) => tx.uuid === selected)

  async function remove(tx: Transaction) {
    try {
      await deleteTransaction(tx)
      setSelected(null)
      setConfirming(false)
    } catch (cause) {
      setError(
        cause instanceof LedgerBlockedError
          ? 'Ya registraste cuotas del calendario nuevo de este préstamo. Elimina esos pagos primero.'
          : 'No se pudo eliminar. La cuenta o tarjeta ya no existe.',
      )
    }
  }

  return (
    <>
      {focus ? (
        <div className="verb-row">
          <span className="month-label">{`Gastos · ${focus.label} · ${rangeLabel(focus.range)}`}</span>
          <button type="button" className="verb-button" onClick={onClearFocus}>
            <span className="key-glyph">B</span>
            Volver a estadísticas
          </button>
        </div>
      ) : (
        <Rail label="Método" items={FILTERS} active={filter} onSelect={setFilter} />
      )}
      <Panel>
        <table className="roster">
          <thead>
            <tr>
              <th scope="col">Fecha</th>
              <th scope="col">Concepto</th>
              <th scope="col">Método</th>
              <th scope="col" className="num">Monto</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr className="roster-empty">
                <td colSpan={4}>—</td>
              </tr>
            )}
            {rows.map((tx) => {
              const row = describe(tx, data)
              const sub = [isMsi(tx) ? `${tx.msi_months} MSI` : null, data.places.find((p) => p.uuid === tx.place_id)?.name, tx.notes]
                .filter(Boolean)
                .join(' · ')
              return (
                <tr
                  key={tx.uuid}
                  className="roster-row"
                  aria-selected={tx.uuid === selected}
                  tabIndex={0}
                  onClick={() => {
                    setSelected(tx.uuid === selected ? null : tx.uuid)
                    setConfirming(false)
                    setError(null)
                  }}
                >
                  <td className="mono dim">{formatDate(isoToDate(tx.date))}</td>
                  <td>
                    {row.concept}
                    {sub && <span className="row-sub">{sub}</span>}
                  </td>
                  <td className="dim">{row.source}</td>
                  <td className={`num mono${row.signed > 0 ? ' text-cyan' : ''}`}>
                    {row.signed === 0 ? formatMoney(tx.amount, tx.currency) : formatMoney(row.signed, tx.currency)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Panel>

      {selectedTx && (
        <div className="verb-row">
          {confirming ? (
            <>
              <button type="button" className="verb-button verb-danger" onClick={() => remove(selectedTx)}>
                <span className="key-glyph">A</span>
                Confirmar eliminar
              </button>
              <button type="button" className="verb-button" onClick={() => setConfirming(false)}>
                <span className="key-glyph">B</span>
                Cancelar
              </button>
            </>
          ) : (
            <>
              {isEditable(selectedTx) && (
                <button type="button" className="verb-button" onClick={() => onEdit(selectedTx)}>
                  <span className="key-glyph">E</span>
                  Editar
                </button>
              )}
              <button type="button" className="verb-button" onClick={() => setConfirming(true)}>
                <span className="key-glyph">X</span>
                Eliminar {TYPE_LABEL[selectedTx.type].toLowerCase()}
              </button>
            </>
          )}
        </div>
      )}
      {error && <p className="field-error">{error}</p>}
      <FooterHint>
        {confirming
          ? selectedTx?.loan_extra_id
            ? 'Eliminar revierte el saldo y regresa el calendario anterior del préstamo.'
            : selectedTx?.bucket_id || data.bucketMoves.some((move) => move.tx_id === selectedTx?.uuid)
              ? selectedTx?.type === 'adjustment'
                ? 'Eliminar revierte el ajuste y lo que se repartió en tus apartados.'
                : 'Eliminar revierte la transferencia y los movimientos de su apartado.'
              : 'Eliminar revierte el saldo de la cuenta o tarjeta.'
          : rows.length === 0
            ? EMPTY_LIST
            : 'Toca un movimiento para ver acciones.'}
      </FooterHint>
    </>
  )
}

export function Movimientos({ onEdit }: { onEdit: (tx: EditableTransaction) => void }) {
  const [view, setView] = useState<MovementView>('list')
  const [bridge, setBridge] = useState(false)
  const [focus, setFocus] = useState<ExpenseFocus | null>(null)
  const [span, setSpan] = useState<StatsWindow>('month')
  const data = useMoneyData()
  const header = (
    <>
      <StageHeader title="Movimientos" aiBridge share onAi={() => setBridge(true)} />
      <Rail label="Vista" items={MOVEMENT_VIEWS} active={view} onSelect={(next) => { setView(next); setFocus(null) }} />
    </>
  )

  if (data.loaded && bridge) {
    return (
      <div className="stage-grid stage-grid--single">
        <div className="stage-main stage-narrow">
          {header}
          <Panel title="Guanabana IA">
            <AiBridge task={null} data={data} onClose={() => setBridge(false)} onDone={() => setBridge(false)} />
          </Panel>
        </div>
      </div>
    )
  }

  if (data.loaded && view === 'prices') return <Precios header={header} data={data} />

  if (data.loaded && view === 'stats') {
    return <Estadisticas header={header} data={data} span={span} onSpan={setSpan} onFocus={(next) => { setFocus(next); setView('list') }} />
  }

  return (
    <div className="stage-grid stage-grid--single">
      <div className="stage-main">
        {header}
        {data.loaded && <TransactionList data={data} onEdit={onEdit} focus={focus} onClearFocus={() => { setFocus(null); setView('stats') }} />}
      </div>
    </div>
  )
}
