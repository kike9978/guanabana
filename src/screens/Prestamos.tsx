import { useMemo, useState } from 'react'
import { useDossierSheet, useScrollIntoView } from '../components/mobile'
import type { AddPrefill, AddType } from '../app/navigation'
import { FooterHint, Panel, StatBar } from '../components/hud'
import { StageHeader } from '../components/StageHeader'
import { deleteLoan, setLoanStatus } from '../db/commitments'
import type { Loan } from '../db/types'
import { useMoneyData, type MoneyData } from '../db/useMoneyData'
import { isoToDate, todayIso } from '../lib/dates'
import { formatAmount, formatDate, formatMoney } from '../lib/format'
import { extraPayments, isInstallmentPaid, isUnscheduled, loanRows, paidInstallmentIds, summarizeLoan } from '../lib/loans'
import { loanSeries, openRows } from '../lib/loanTimeline'
import { habitualDailySpend } from '../lib/projection'
import { ExtraPaymentForm } from './loans/ExtraPaymentForm'
import { PayoffPanel, SeriesTable } from './loans/PayoffPanel'
import { LoanEditForm } from './loans/LoanEditForm'
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
  const [confirming, setConfirming] = useState<'delete' | 'write_off' | null>(null)
  const [form, setForm] = useState<'extra' | 'edit' | null>(null)
  const formRef = useScrollIntoView(form)
  const paid = paidInstallmentIds(data.transactions)
  const summary = summarizeLoan(loan, data.installments, data.transactions)
  const extras = extraPayments(loan, data.transactions)
  const rows = loanRows(loan, data.installments)
  const borrowed = loan.direction === 'borrowed'
  const writtenOff = loan.status === 'written_off'
  const handedOver = data.transactions.find((tx) => tx.loan_id === loan.uuid)
  const open = rows.filter((row) => !isInstallmentPaid(row, paid))
  const openTotal = open.reduce((sum, row) => sum + row.amount, 0)
  const unscheduled = isUnscheduled(loan)
  const abonos = data.transactions.filter((tx) => tx.loan_extra_id === loan.uuid).sort((a, b) => b.date.localeCompare(a.date))
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
        <span className="hero-currency">{borrowed ? 'MXN por pagar' : writtenOff ? 'MXN sin cobrar' : 'MXN por cobrar'}</span>
      </p>
      {writtenOff && <FooterHint>Lo diste por perdido. Lo que cobraste se queda en tus movimientos.</FooterHint>}
      <div className="stat-list">
        <StatBar label="Avance" value={`${Math.round(summary.progress * 100)}%`} ratio={summary.progress} />
        <div className="readout">
          <span className="dim">{borrowed ? 'Pagado' : 'Cobrado'}</span>
          <span className="mono">{money(summary.paid)}</span>
        </div>
        {unscheduled ? (
          <div className="readout">
            <span className="dim">Calendario</span>
            <span className="mono">Sin fecha</span>
          </div>
        ) : (
          <>
            {extras > 0 && (
              <div className="readout">
                <span className="dim">Abonos extra</span>
                <span className="mono">{money(extras)}</span>
              </div>
            )}
            <div className="readout">
              <span className="dim">{borrowed ? 'Interés pagado' : 'Interés cobrado'}</span>
              <span className="mono">{money(summary.interestPaid)}</span>
            </div>
            <div className="readout">
              <span className="dim">{borrowed ? 'Cuotas restantes' : writtenOff ? 'Cuotas sin cobrar' : 'Cuotas por cobrar'}</span>
              <span className="mono">
                {summary.installmentsLeft} de {summary.installmentsTotal}
              </span>
            </div>
            <div className="readout">
              <span className="dim">{borrowed ? 'Liquidación' : 'Último cobro'}</span>
              <span className="mono">{summary.payoffDate ? date(summary.payoffDate) : '—'}</span>
            </div>
          </>
        )}
      </div>

      {form ? (
        <div ref={formRef}>
          {form === 'extra' ? (
            <ExtraPaymentForm loan={loan} data={data} onDone={() => setForm(null)} />
          ) : (
            <LoanEditForm loan={loan} data={data} onDone={() => setForm(null)} />
          )}
        </div>
      ) : (
        <>
          {summary.next && !writtenOff && (
            <div className="dossier-total">
              <span>
                Próxima cuota · {date(summary.next.due_date)}
                {summary.next.due_date < today && <span className="row-sub text-amber">Vencida</span>}
              </span>
              <span className="mono">{money(summary.next.amount)}</span>
            </div>
          )}
          <div className="verb-row">
            {confirming === 'delete' ? (
              <>
                {handedOver ? (
                  <>
                    <button type="button" className="verb-button verb-danger" onClick={() => deleteLoan(loan, data.installments).then(onClose)}>
                      <span className="key-glyph">X</span>
                      Conservar movimiento
                    </button>
                    <button
                      type="button"
                      className="verb-button verb-danger"
                      onClick={() => deleteLoan(loan, data.installments, handedOver).then(onClose)}
                    >
                      <span className="key-glyph">Y</span>
                      Eliminar también el movimiento
                    </button>
                  </>
                ) : (
                  <button type="button" className="verb-button verb-danger" onClick={() => deleteLoan(loan, data.installments).then(onClose)}>
                    <span className="key-glyph">X</span>
                    Confirmar eliminar
                  </button>
                )}
                <button type="button" className="verb-button" onClick={() => setConfirming(null)}>
                  <span className="key-glyph">B</span>
                  Cancelar
                </button>
              </>
            ) : confirming === 'write_off' ? (
              <>
                <button type="button" className="verb-button verb-primary" onClick={() => setLoanStatus(loan, 'written_off').then(() => setConfirming(null))}>
                  <span className="key-glyph">A</span>
                  Confirmar
                </button>
                <button type="button" className="verb-button" onClick={() => setConfirming(null)}>
                  <span className="key-glyph">B</span>
                  Cancelar
                </button>
              </>
            ) : (
              <>
                {summary.next && !writtenOff && (
                  <button type="button" className="verb-button verb-primary" onClick={payNext}>
                    <span className="key-glyph">A</span>
                    {borrowed ? 'Pagar cuota' : 'Registrar cobro'}
                  </button>
                )}
                {summary.remaining > 0 && !writtenOff && (
                  <button type="button" className={`verb-button${unscheduled ? ' verb-primary' : ''}`} onClick={() => setForm('extra')}>
                    <span className="key-glyph">{unscheduled ? 'A' : '+'}</span>
                    {unscheduled ? (borrowed ? 'Registrar pago' : 'Registrar cobro') : 'Abono extra'}
                  </button>
                )}
                <button type="button" className="verb-button" onClick={() => setForm('edit')}>
                  <span className="key-glyph">E</span>
                  Editar
                </button>
                {!borrowed && loan.status === 'active' && (unscheduled ? summary.remaining > 0 : open.length > 0) && (
                  <button type="button" className="verb-button" onClick={() => setConfirming('write_off')}>
                    <span className="key-glyph">Y</span>
                    Dar por perdido
                  </button>
                )}
                <button type="button" className="verb-button" onClick={() => setConfirming('delete')}>
                  <span className="key-glyph">X</span>
                  Eliminar
                </button>
              </>
            )}
          </div>
          {confirming === 'delete' && (
            <FooterHint>
              {handedOver
                ? `Eliminar quita el préstamo y su calendario. El movimiento de ${money(handedOver.amount)} que prestaste puede quedarse en Movimientos, o eliminarse y regresar a ${data.accounts.find((a) => a.uuid === handedOver.account_id)?.name ?? 'su cuenta'}.`
                : 'Eliminar quita el préstamo y su calendario. Los pagos ya registrados se quedan en Movimientos.'}
            </FooterHint>
          )}
          {confirming === 'write_off' && (
            <FooterHint>
              {unscheduled
                ? `Lo cobrado (${money(summary.paid)}) se queda. Lo que falta (${money(summary.remaining)}) deja de contarse como por cobrar. Ningún saldo cambia.`
                : `Lo cobrado (${money(summary.paid)}) se queda. ${open.length === 1 ? 'La cuota' : `Las ${open.length} cuotas`} sin cobrar (${money(openTotal)}) dejan de aparecer en Tiempo. Ningún saldo cambia.`}
            </FooterHint>
          )}
        </>
      )}

      {unscheduled ? (
        abonos.length === 0 ? (
          <FooterHint>{borrowed ? 'Aún no registras pagos.' : 'Aún no registras cobros.'}</FooterHint>
        ) : (
          <table className="roster">
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col" className="num">{borrowed ? 'Pago' : 'Cobro'}</th>
              </tr>
            </thead>
            <tbody>
              {abonos.map((tx) => (
                <tr key={tx.uuid}>
                  <td className="mono">{date(tx.date)}</td>
                  <td className="num mono">{money(tx.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : (
      <div className="roster-fit">
      <table className="roster roster-stack">
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
            const status = row.status === 'settled'
              ? 'Pagada antes'
              : isPaid
                ? (borrowed ? 'Pagada' : 'Cobrada')
                : writtenOff ? 'Sin cobrar' : late ? 'Vencida' : 'Pendiente'
            return (
              <tr key={row.uuid} className={isPaid || writtenOff ? 'dim' : undefined}>
                <td className="mono dim roster-title">{index + 1}</td>
                <td className="mono" data-label="Fecha">{date(row.due_date)}</td>
                <td className="num mono" data-label="Cuota">{money(row.amount)}</td>
                <td className={late && !writtenOff ? 'text-amber' : 'dim'} data-label="Estado">{status}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      </div>
      )}
    </Panel>
  )
}

export function Prestamos({ onAdd }: { onAdd: (type: AddType, prefill: AddPrefill) => void }) {
  const data = useMoneyData()
  const [adding, setAdding] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const dossierRef = useDossierSheet(selected, () => setSelected(null))
  const formRef = useScrollIntoView(adding ? 'new' : null)
  const allSeries = useMemo(() => {
    if (!data.loaded) return []
    const today = new Date()
    const active = data.loans.filter((loan) => loan.direction === 'borrowed' && loan.status === 'active' && openRows(loan, data).length > 0)
    if (active.length === 0) return []
    return loanSeries(data, active, today, { dailySpend: habitualDailySpend(data.transactions, today).perDay })
  }, [data])
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
          {adding && (
            <div ref={formRef}>
              <LoanForm data={data} onDone={() => setAdding(false)} />
            </div>
          )}
          {loans.length === 0 ? (
            !adding && <FooterHint>Registra lo que debes o lo que te deben para ver hasta cuándo pagas.</FooterHint>
          ) : (
            <div className="roster-fit">
            <table className="roster roster-stack">
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
                  const writtenOff = loan.status === 'written_off'
                  return (
                    <tr
                      key={loan.uuid}
                      className={`roster-row${writtenOff ? ' dim' : ''}`}
                      aria-selected={loan.uuid === selected}
                      tabIndex={0}
                      onClick={() => setSelected(loan.uuid === selected ? null : loan.uuid)}
                    >
                      <td className="roster-title">
                        {loan.name}
                        <span className="row-sub">
                          {loan.direction === 'borrowed' ? 'Debo' : 'Me deben'}
                          {loan.lender_label && ` · ${loan.lender_label}`}
                          {writtenOff && ' · Dado por perdido'}
                        </span>
                      </td>
                      <td className="num mono" data-label="Restante">{money(summary.remaining)}</td>
                      <td className="mono dim" data-label="Próxima cuota">
                        {writtenOff
                          ? '—'
                          : isUnscheduled(loan) && summary.remaining > 0
                            ? 'Sin fecha'
                            : summary.next
                            ? `${date(summary.next.due_date)} · ${money(summary.next.amount)}`
                            : 'Liquidado'}
                      </td>
                      <td className="mono dim" data-label="Termina">{summary.payoffDate ? date(summary.payoffDate) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          )}
        </Panel>
        {allSeries.length > 1 && (
          <Panel title="¿Hasta cuándo? · todos los préstamos">
            <SeriesTable series={allSeries} />
          </Panel>
        )}
        <FooterHint>Solo las cuotas antes de tu próximo ingreso se apartan de tu Disponible real. Lo que te deben no cuenta hasta que lo cobres.</FooterHint>
        {allSeries.length > 1 && (
          <FooterHint>Cada fila es un día de ingreso: las cuotas de ese ciclo y tu Disponible real proyectado, con tu gasto diario habitual.</FooterHint>
        )}
      </div>
      {selectedLoan && (
        <aside ref={dossierRef} className="dossier dossier-sheet" tabIndex={-1} aria-label={selectedLoan.name}>
          <LoanDossier key={selectedLoan.uuid} loan={selectedLoan} data={data} onAdd={onAdd} onClose={() => setSelected(null)} />
          {selectedLoan.direction === 'borrowed' && selectedLoan.status === 'active' && !isUnscheduled(selectedLoan) && (
            <PayoffPanel key={`payoff-${selectedLoan.uuid}`} loan={selectedLoan} data={data} />
          )}
        </aside>
      )}
    </div>
  )
}
