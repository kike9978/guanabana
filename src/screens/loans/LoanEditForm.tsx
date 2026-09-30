import { useState, type FormEvent } from 'react'
import { FieldError, FieldNote, FormActions, SelectField, TextField } from '../../components/fields'
import { isLiquid, selectable } from '../../db/accounts'
import { updateLoan } from '../../db/commitments'
import type { Loan } from '../../db/types'
import type { MoneyData } from '../../db/useMoneyData'
import { formatMoney } from '../../lib/format'
import { editOpenRows, isInstallmentPaid, loanRows, paidInstallmentIds, summarizeLoan, type RowEdit, type ScheduleProblem } from '../../lib/loans'
import { parseAmount } from '../../lib/parseAmount'
import { moneySnapshot } from '../../lib/snapshot'

const money = (value: number) => formatMoney(value, 'MXN')

type RowDraft = { due_date?: string; amount?: string }

function problemCopy(problem: ScheduleProblem): string {
  if (problem.kind === 'missing') return 'Cada cuota necesita fecha y un monto mayor a cero.'
  if (problem.kind === 'below_principal') return `Cada cuota debe cubrir su capital, ${money(problem.principal)}.`
  return `Las cuotas pendientes suman ${money(problem.principal)} de capital y el restante es ${money(problem.remaining)}.`
}

export function LoanEditForm({ loan, data, onDone }: { loan: Loan; data: MoneyData; onDone: () => void }) {
  const borrowed = loan.direction === 'borrowed'
  const [name, setName] = useState(loan.name)
  const [who, setWho] = useState(loan.lender_label)
  const [accountId, setAccountId] = useState(loan.pay_from_account_id ?? '')
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const paid = paidInstallmentIds(data.transactions)
  const rows = loanRows(loan, data.installments)
  const paidCount = rows.filter((row) => isInstallmentPaid(row, paid)).length
  const open = loan.status === 'written_off' ? [] : rows.filter((row) => !isInstallmentPaid(row, paid))
  const summary = summarizeLoan(loan, data.installments, data.transactions)
  const edits: Record<string, RowEdit> = Object.fromEntries(
    Object.entries(drafts).map(([uuid, draft]) => [
      uuid,
      { due_date: draft.due_date, amount: draft.amount === undefined ? undefined : parseAmount(draft.amount) },
    ]),
  )
  const edit = editOpenRows(loan, open, summary.remaining, edits)

  const now = new Date()
  const impact = borrowed && edit.changed.length > 0 && !edit.problem
    ? (() => {
        const byId = new Map(edit.rows.map((row) => [row.uuid, row]))
        const installments = data.installments.map((row) => byId.get(row.uuid) ?? row)
        return { before: moneySnapshot(data, now).breakdown.total, after: moneySnapshot({ ...data, installments }, now).breakdown.total }
      })()
    : null

  const accountOptions = [
    { value: '', label: 'Elegir al pagar' },
    ...selectable(data.accounts, [loan.pay_from_account_id]).filter(isLiquid).map((a) => ({ value: a.uuid, label: a.name })),
  ]

  function draft(uuid: string, field: keyof RowDraft, value: string) {
    setDrafts({ ...drafts, [uuid]: { ...drafts[uuid], [field]: value } })
    setError(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return setError('Ponle un nombre, por ejemplo “Auto” o “Préstamo familiar”.')
    if (edit.problem) return setError(problemCopy(edit.problem))

    setSaving(true)
    try {
      await updateLoan(loan, { name: name.trim(), lender_label: who.trim(), pay_from_account_id: accountId || null }, edit.changed)
      onDone()
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <div className="field-row">
        <TextField label="Nombre" value={name} onChange={setName} autoFocus />
        <TextField label={borrowed ? 'Quién presta' : 'A quién'} value={who} onChange={setWho} placeholder="Ej. Banco, Mamá" />
      </div>
      <SelectField label={borrowed ? 'Se paga desde' : 'Se recibe en'} value={accountId} onChange={setAccountId} options={accountOptions} />

      {open.length > 0 && (
        <div className="preview">
          <p className="field-label">{borrowed ? 'Cuotas pendientes' : 'Cuotas por cobrar'}</p>
          <div className="roster-fit">
            <table className="roster roster-stack">
              <tbody>
                {open.map((row) => {
                  const position = rows.indexOf(row) + 1
                  return (
                    <tr key={row.uuid}>
                      <td className="mono dim roster-title">{position}</td>
                      <td className="mono" data-label="Fecha">
                        <input
                          className="input mono"
                          type="date"
                          aria-label={`Fecha de la cuota ${position}`}
                          value={drafts[row.uuid]?.due_date ?? row.due_date}
                          onChange={(event) => draft(row.uuid, 'due_date', event.target.value)}
                        />
                      </td>
                      <td className="num mono" data-label="Cuota">
                        {loan.interest === 'fixed_rate' ? (
                          money(row.amount)
                        ) : (
                          <input
                            className="input mono num"
                            inputMode="decimal"
                            aria-label={`Monto de la cuota ${position}`}
                            value={drafts[row.uuid]?.amount ?? String(row.amount)}
                            onChange={(event) => draft(row.uuid, 'amount', event.target.value)}
                          />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {loan.interest === 'fixed_rate' && <FieldNote>Con tasa anual solo se editan las fechas; los montos salen de la tasa.</FieldNote>}
          {loan.interest === 'none' && (
            <div className={`readout${edit.problem?.kind === 'total' ? ' text-amber' : ''}`}>
              <span>Capital en cuotas · restante {money(summary.remaining)}</span>
              <span className="mono">{money(edit.rows.reduce((sum, row) => sum + row.principal_part, 0))}</span>
            </div>
          )}
          {impact && (
            <div className="readout">
              <span>Disponible real</span>
              <span className="mono">
                {money(impact.before)} → {money(impact.after)}
              </span>
            </div>
          )}
        </div>
      )}
      <FieldNote>
        {paidCount > 0
          ? `${paidCount === 1 ? 'La cuota' : `Las ${paidCount} cuotas`} ${borrowed ? (paidCount === 1 ? 'pagada' : 'pagadas') : paidCount === 1 ? 'cobrada' : 'cobradas'} no ${paidCount === 1 ? 'cambia' : 'cambian'}. `
          : ''}
        El monto, el interés y la frecuencia no se editan; para cambiarlos, elimina el préstamo y regístralo de nuevo.
      </FieldNote>
      {error && <FieldError>{error}</FieldError>}
      <FormActions submitLabel="Guardar cambios" saving={saving} onCancel={onDone} />
    </form>
  )
}
