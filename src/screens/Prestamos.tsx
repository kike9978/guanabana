import { useState } from 'react'
import type { AddPrefill, AddType } from '../app/navigation'
import { FooterHint, Panel, StatBar } from '../components/hud'
import { StageHeader } from '../components/StageHeader'
import { deleteLoan } from '../db/commitments'
import type { Loan } from '../db/types'
import { useMoneyData, type MoneyData } from '../db/useMoneyData'
import { isoToDate, todayIso } from '../lib/dates'
import { formatAmount, formatDate, formatMoney } from '../lib/format'
import { extraPayments, isInstallmentPaid, loanRows, paidInstallmentIds, summarizeLoan } from '../lib/loans'
import { ExtraPaymentForm } from './loans/ExtraPaymentForm'
import { LoanForm } from './loans/LoanForm'

const money = (value: number) => formatMoney(value, 'MXN')
const date = (iso: string) => formatDate(isoToDate(iso))

function LoanDossier({
  loan,
  data,
  onAdd,
  onClose,
}: {
  loan: Loan
  data: MoneyData
  onAdd: (type: AddType, prefill: AddPrefill) => void
  onClose: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [extra, setExtra] = useState(false)
  const paid = paidInstallmentIds(data.transactions)
  const summary = summarizeLoan(loan, data.installments, data.transactions)
  const extras = extraPayments(loan, data.transactions)
  const rows = loanRows(loan, data.installments)
  const borrowed = loan.direction === 'borrowed'
  const today = todayIso()

  function payNext() {
    if (!summary.next) return
    onAdd(borrowed ? 'expense' : 'income', {
      amount: summary.next.amount,
      date: today,
      account_id: loan.pay_from_account_id,
      category_key: borrowed ? 'loan_payment' : 'loan_repayment',
      notes: `Cuota ${loan.name}`,
      loan_installment_id: summary.next.uuid,
    })
  }

  return (
    <Panel
      title={loan.name}
      aside={
        <button type="button" className="panel-verb" onClick={onClose}>
          Cerrar
        </button>
      }
    >
      <p className="hero-figure">
        {formatAmount(summary.remaining)}
        <span className="hero-currency">{borrowed ? 'MXN por pagar' : 'MXN por cobrar'}</span>
      </p>
      <div className="stat-list">
        <StatBar label="Avance" value={`${Math.round(summary.progress * 100)}%`} ratio={summary.progress} />
        <div className="readout">
          <span className="dim">{borrowed ? 'Pagado' : 'Cobrado'}</span>
          <span className="mono">{money(summary.paid)}</span>
        </div>
        {extras > 0 && (
          <div className="readout">
            <span className="dim">Abonos extra</span>
            <span className="mono">{money(extras)}</span>
          </div>
        )}
        <div className="readout">
          <span className="dim">Interés pagado</span>
          <span className="mono">{money(summary.interestPaid)}</span>
        </div>
        <div className="readout">
          <span className="dim">Cuotas restantes</span>
          <span className="mono">
            {summary.installmentsLeft} de {summary.installmentsTotal}
          </span>
        </div>
        <div className="readout">
          <span className="dim">Liquidación</span>
          <span className="mono">{summary.payoffDate ? date(summary.payoffDate) : '—'}</span>
        </div>
      </div>

      {extra ? (
        <ExtraPaymentForm loan={loan} data={data} onDone={() => setExtra(false)} />
      ) : (
        <>
          {summary.next && (
            <div className="dossier-total">
              <span>
                Próxima cuota · {date(summary.next.due_date)}
                {summary.next.due_date < today && <span className="row-sub text-amber">Vencida</span>}
              </span>
              <span className="mono">{money(summary.next.amount)}</span>
            </div>
          )}
          <div className="verb-row">
            {summary.next && (
              <button type="button" className="verb-button verb-primary" onClick={payNext}>
                <span className="key-glyph">A</span>
                {borrowed ? 'Pagar cuota' : 'Registrar cobro'}
              </button>
            )}
            {summary.remaining > 0 && (
              <button type="button" className="verb-button" onClick={() => setExtra(true)}>
                <span className="key-glyph">+</span>
                Abono extra
              </button>
            )}
            {confirming ? (
              <>
                <button type="button" className="verb-button verb-danger" onClick={() => deleteLoan(loan, data.installments).then(onClose)}>
                  <span className="key-glyph">X</span>
                  Confirmar eliminar
                </button>
                <button type="button" className="verb-button" onClick={() => setConfirming(false)}>
                  <span className="key-glyph">B</span>
                  Cancelar
                </button>
              </>
            ) : (
              <button type="button" className="verb-button" onClick={() => setConfirming(true)}>
                <span className="key-glyph">X</span>
                Eliminar
              </button>
            )}
          </div>
          {confirming && <FooterHint>Eliminar quita el préstamo y su calendario. Los pagos ya registrados se quedan en Movimientos.</FooterHint>}
        </>
      )}

      <table className="roster">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Fecha</th>
            <th scope="col" className="num">Cuota</th>
            <th scope="col">Estado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const isPaid = isInstallmentPaid(row, paid)
            const late = !isPaid && row.due_date < today
            const status = row.status === 'settled' ? 'Pagada antes' : isPaid ? (borrowed ? 'Pagada' : 'Cobrada') : late ? 'Vencida' : 'Pendiente'
            return (
              <tr key={row.uuid} className={isPaid ? 'dim' : undefined}>
                <td className="mono dim">{index + 1}</td>
                <td className="mono">{date(row.due_date)}</td>
                <td className="num mono">{money(row.amount)}</td>
                <td className={late ? 'text-amber' : 'dim'}>{status}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Panel>
  )
}

export function Prestamos({ onAdd }: { onAdd: (type: AddType, prefill: AddPrefill) => void }) {
  const data = useMoneyData()
  const [adding, setAdding] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  if (!data.loaded) return null

  const selectedLoan = data.loans.find((loan) => loan.uuid === selected)
  const loans = [...data.loans].sort((a, b) => a.direction.localeCompare(b.direction) || a.name.localeCompare(b.name))

  return (
    <div className={`stage-grid${selectedLoan ? '' : ' stage-grid--single'}`}>
      <div className="stage-main">
        <StageHeader title="Préstamos" />
        <Panel
          title="Préstamos"
          aside={
            !adding && (
              <button type="button" className="panel-verb" onClick={() => setAdding(true)}>
                + Nuevo préstamo
              </button>
            )
          }
        >
          {adding && <LoanForm data={data} onDone={() => setAdding(false)} />}
          {loans.length === 0 ? (
            !adding && <FooterHint>Registra lo que debes o lo que te deben para ver hasta cuándo pagas.</FooterHint>
          ) : (
            <table className="roster">
              <thead>
                <tr>
                  <th scope="col">Préstamo</th>
                  <th scope="col" className="num">Restante</th>
                  <th scope="col">Próxima cuota</th>
                  <th scope="col">Termina</th>
                </tr>
              </thead>
              <tbody>
                {loans.map((loan) => {
                  const summary = summarizeLoan(loan, data.installments, data.transactions)
                  return (
                    <tr
                      key={loan.uuid}
                      className="roster-row"
                      aria-selected={loan.uuid === selected}
                      tabIndex={0}
                      onClick={() => setSelected(loan.uuid === selected ? null : loan.uuid)}
                    >
                      <td>
                        {loan.name}
                        <span className="row-sub">
                          {loan.direction === 'borrowed' ? 'Debo' : 'Me deben'}
                          {loan.lender_label && ` · ${loan.lender_label}`}
                        </span>
                      </td>
                      <td className="num mono">{money(summary.remaining)}</td>
                      <td className="mono dim">
                        {summary.next ? `${date(summary.next.due_date)} · ${money(summary.next.amount)}` : 'Liquidado'}
                      </td>
                      <td className="mono dim">{summary.payoffDate ? date(summary.payoffDate) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Panel>
        <FooterHint>Solo las cuotas antes de tu próximo ingreso se apartan de tu Disponible real. Lo que te deben no cuenta hasta que lo cobres.</FooterHint>
      </div>
      {selectedLoan && (
        <aside className="dossier" aria-label={selectedLoan.name}>
          <LoanDossier key={selectedLoan.uuid} loan={selectedLoan} data={data} onAdd={onAdd} onClose={() => setSelected(null)} />
        </aside>
      )}
    </div>
  )
}
