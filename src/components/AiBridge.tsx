import { useState } from 'react'
import { createAiJob, hasCommittedResponse, updateAiJob } from '../db/aiJobs'
import { selectable } from '../db/accounts'
import { draftTransaction, recordTransactions, saveTransaction } from '../db/ledger'
import { planLines, resolvePlace } from '../db/priceBook'
import type { AiJob, AiJobStatus, AiTask, PaymentMethod } from '../db/types'
import type { MoneyData } from '../db/useMoneyData'
import { confidenceTone, jsonPayload, promptIsSensitive, sha256, TASK_LABEL, WEAK_CONFIDENCE, type FieldConfidence } from '../lib/aiEnvelope'
import { repairPrompt, taskPrompt } from '../lib/aiPrompt'
import { parseReceipt, type ParsedReceipt, type ParsedReceiptItem } from '../lib/aiReceipt'
import { parseStatement, type ParsedStatement, type StatementRow } from '../lib/aiStatement'
import { UNCATEGORIZED_KEY } from '../lib/categories'
import { formatMoney } from '../lib/format'
import { matchName, NEW_ITEM } from '../lib/priceBook'
import { parseAmount } from '../lib/parseAmount'
import { roundMoney } from '../lib/money'
import { ChoiceField, FieldError, FieldNote, SelectField } from './fields'
import { FooterHint } from './hud'

const TONE_CLASS = { safe: 'text-cyan', tight: 'text-amber', shortfall: 'text-heat' } as const

const METHOD_LABEL: Record<PaymentMethod, string> = { bank: 'Banco', cash: 'Efectivo', credit_card: 'TDC', unassigned: 'Sin origen' }

type Step = 'pick' | 'context' | 'prompt' | 'paste' | 'preview'

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function Confidence({ value }: { value: number }) {
  return <span className={`mono ${TONE_CLASS[confidenceTone(value)]}`}>{Math.round(value * 100)}%</span>
}

function FieldRow({ label, value, confidence, weak }: { label: string; value: string; confidence: number; weak: boolean }) {
  return (
    <div className={`readout${weak ? ' is-weak' : ''}`}>
      <span className="dim">{label}</span>
      <span>
        {value} · <Confidence value={confidence} />
      </span>
    </div>
  )
}

function level(fields: FieldConfidence, overall: number, name: string): number {
  return fields[name] ?? overall
}

export function AiBridge({
  task: initialTask,
  data,
  onClose,
  onDone,
}: {
  task: AiTask | null
  data: MoneyData
  onClose: () => void
  onDone: () => void
}) {
  const [task, setTask] = useState<AiTask | null>(initialTask)
  const [step, setStep] = useState<Step>(initialTask ? 'context' : 'pick')
  const [context, setContext] = useState('')
  const [prompt, setPrompt] = useState('')
  const [paste, setPaste] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [job, setJob] = useState<AiJob | null>(null)
  const [receipt, setReceipt] = useState<ParsedReceipt | null>(null)
  const [statement, setStatement] = useState<ParsedStatement | null>(null)
  const [duplicate, setDuplicate] = useState(false)
  const [allowDuplicate, setAllowDuplicate] = useState(false)
  const [saving, setSaving] = useState(false)
  const closeLabel = task === 'parse_receipt' ? 'Llenar a mano' : 'Volver'

  async function track(status: AiJobStatus, promptText: string, response: string | null) {
    if (!task) return
    const prompt_hash = await sha256(promptText)
    const response_hash = response === null ? null : await sha256(response)
    const next = job
      ? await updateAiJob(job, { status, prompt_hash, response_hash: response_hash ?? job.response_hash })
      : await createAiJob(task, prompt_hash)
    const saved = !job && status !== 'prompt_copied' ? await updateAiJob(next, { status, prompt_hash, response_hash }) : next
    setJob(saved)
  }

  function toPrompt(forTask: AiTask) {
    setPrompt(taskPrompt(forTask, context, data.categories))
    setCopied(false)
    setStep('prompt')
  }

  async function copyPrompt(text: string) {
    setError(null)
    const ok = await copyText(text)
    setCopied(ok)
    if (!ok) setError('No se pudo copiar solo. Selecciona el texto y cópialo.')
    try {
      await track('prompt_copied', text, null)
    } catch {
      setError('El prompt está listo, pero no se pudo anotar el intento.')
    }
  }

  async function sharePrompt() {
    try {
      await navigator.share({ text: prompt })
      await track('prompt_copied', prompt, null)
    } catch {
      setError('No se pudo compartir. Copia el prompt.')
    }
  }

  async function validate() {
    if (!task) return
    setError(null)
    setFailure(null)
    try {
      const payload = jsonPayload(paste)
      if (task === 'parse_receipt') setReceipt(parseReceipt(paste, data.categories, new Date()))
      else setStatement(parseStatement(paste, data, new Date()))
      setDuplicate(await hasCommittedResponse(await sha256(payload)))
      setAllowDuplicate(false)
      await track('validated', prompt, payload)
      setStep('preview')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'No se pudo leer la respuesta.'
      setFailure(message)
      await track('failed', prompt, paste).catch(() => undefined)
    }
  }

  return (
    <div className="ai-bridge">
      <div className="verb-row">
        <span className="month-label">{task ? TASK_LABEL[task] : 'Elegir'}</span>
        <button type="button" className="verb-button" onClick={onClose}>
          <span className="key-glyph">B</span>
          {closeLabel}
        </button>
      </div>

      {step === 'pick' && (
        <div className="verb-row">
          <button type="button" className="verb-button" onClick={() => { setTask('parse_receipt'); setStep('context') }}>
            Ticket
          </button>
          <button type="button" className="verb-button" onClick={() => { setTask('parse_bank_statement'); setStep('context') }}>
            Estado de cuenta
          </button>
        </div>
      )}

      {step === 'context' && (
        <>
          <label className="field">
            <span className="field-label">Texto</span>
            <textarea className="input prompt-box" value={context} onChange={(event) => setContext(event.target.value)} placeholder="Pega el ticket o el estado. Borra lo que no quieras enviar." />
          </label>
          {promptIsSensitive(context) && <FieldNote>Este texto tiene montos o nombres. Revisa que no lleve números de cuenta ni de tarjeta antes de copiarlo.</FieldNote>}
          <button type="button" className="verb-button verb-primary" onClick={() => task && toPrompt(task)}>
            <span className="key-glyph">A</span>
            Armar prompt
          </button>
        </>
      )}

      {step === 'prompt' && (
        <>
          {promptIsSensitive(context) && <FieldNote>El prompt incluye el texto que pegaste. Cualquiera que lo lea verá esos montos y nombres.</FieldNote>}
          <textarea className="input prompt-box" readOnly value={prompt} />
          <div className="verb-row">
            <button type="button" className="verb-button verb-primary" onClick={() => void copyPrompt(prompt)}>
              <span className="key-glyph">C</span>
              Copiar prompt
            </button>
            {typeof navigator.share === 'function' && (
              <button type="button" className="verb-button" onClick={() => void sharePrompt()}>
                Compartir
              </button>
            )}
            <button type="button" className="verb-button" onClick={() => setStep('paste')}>
              Ya tengo la respuesta
            </button>
          </div>
          {copied && <FieldNote>Copiado. Pégalo en el modelo y trae el JSON de vuelta. La app no lo consulta.</FieldNote>}
        </>
      )}

      {step === 'paste' && (
        <>
          <label className="field">
            <span className="field-label">Respuesta JSON</span>
            <textarea className="input prompt-box" value={paste} onChange={(event) => { setPaste(event.target.value); setFailure(null) }} placeholder="Pega el JSON. No se lee el portapapeles solo." />
          </label>
          {failure && <FieldError>{failure}</FieldError>}
          <div className="verb-row">
            <button type="button" className="verb-button verb-primary" onClick={() => void validate()}>
              <span className="key-glyph">A</span>
              Validar
            </button>
            {failure && task && (
              <button type="button" className="verb-button" onClick={() => void copyPrompt(repairPrompt(task, failure, paste))}>
                Copiar prompt de reparación
              </button>
            )}
          </div>
        </>
      )}

      {step === 'preview' && receipt && (
        <ReceiptPreview
          data={data}
          receipt={receipt}
          duplicate={duplicate}
          allowDuplicate={allowDuplicate}
          onAllowDuplicate={() => setAllowDuplicate(true)}
          saving={saving}
          onConfirm={async (fields, build) => {
            setSaving(true)
            setError(null)
            try {
              await saveTransaction(undefined, { ...fields, source: 'ai_manual' }, build)
              if (job) await updateAiJob(job, { status: 'committed', prompt_hash: job.prompt_hash, response_hash: job.response_hash })
              onDone()
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'No se pudo guardar.')
              setSaving(false)
            }
          }}
        />
      )}

      {step === 'preview' && statement && task === 'parse_bank_statement' && (
        <StatementPreview
          data={data}
          statement={statement}
          duplicate={duplicate}
          allowDuplicate={allowDuplicate}
          onAllowDuplicate={() => setAllowDuplicate(true)}
          saving={saving}
          onConfirm={async (records) => {
            setSaving(true)
            setError(null)
            try {
              await recordTransactions(records)
              if (job) await updateAiJob(job, { status: 'committed', prompt_hash: job.prompt_hash, response_hash: job.response_hash })
              onDone()
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'No se pudo guardar.')
              setSaving(false)
            }
          }}
        />
      )}

      {error && <FieldError>{error}</FieldError>}
      <FooterHint>Nada se guarda hasta que confirmes. El modelo no entra a tus datos.</FooterHint>
    </div>
  )
}

function ReceiptPreview({
  data,
  receipt,
  duplicate,
  allowDuplicate,
  onAllowDuplicate,
  saving,
  onConfirm,
}: {
  data: MoneyData
  receipt: ParsedReceipt
  duplicate: boolean
  allowDuplicate: boolean
  onAllowDuplicate: () => void
  saving: boolean
  onConfirm: (fields: Parameters<typeof saveTransaction>[1], build: Parameters<typeof saveTransaction>[2]) => Promise<void>
}) {
  const accounts = selectable(data.accounts)
  const cards = selectable(data.cards)
  const sourcesByMethod: Record<PaymentMethod, { value: string; label: string }[]> = {
    bank: accounts.filter((a) => a.type === 'checking').map((a) => ({ value: a.uuid, label: a.name })),
    cash: accounts.filter((a) => a.type === 'cash').map((a) => ({ value: a.uuid, label: a.name })),
    credit_card: cards.map((c) => ({ value: c.uuid, label: c.name })),
    unassigned: [],
  }
  const methodOptions = (['bank', 'cash', 'credit_card'] as const).filter((m) => sourcesByMethod[m].length > 0).map((m) => ({ value: m, label: METHOD_LABEL[m] }))
  const [method, setMethod] = useState<PaymentMethod | null>(receipt.paymentMethod)
  const [source, setSource] = useState<string | null>(null)
  const [choices, setChoices] = useState<Record<number, string>>({})
  const [localError, setLocalError] = useState<string | null>(null)
  const activeMethod = methodOptions.find((m) => m.value === method)?.value ?? methodOptions[0]?.value
  const sources = activeMethod ? sourcesByMethod[activeMethod] : []
  const activeSource = sources.find((s) => s.value === source)?.value ?? sources[0]?.value
  const category = data.categories.find((c) => c.uuid === receipt.categoryId)
  const score = (name: string) => level(receipt.fieldConfidence, receipt.confidence, name)

  const pending = receipt.items.some((item, index) => {
    const match = matchName(item.name, data.items)
    return !match.exact && match.near.length > 0 && !choices[index]
  })

  async function confirm() {
    if (!activeMethod || !activeSource) return setLocalError('Elige con qué se pagó.')
    if (pending) return setLocalError('Confirma si los productos marcados son el mismo.')
    if (duplicate && !allowDuplicate) return setLocalError('Esta respuesta ya se usó.')
    let place = null
    let created = null
    if (receipt.merchant) {
      const resolved = resolvePlace({ name: receipt.merchant, kind: 'other', area: '' }, data.places)
      if ('error' in resolved) return setLocalError(resolved.error)
      place = resolved.place
      created = resolved.created ? resolved.place : null
    }
    const drafts = receipt.items.map((item, index) => ({
      key: String(index),
      name: item.name,
      qty: item.qty === null ? '' : String(item.qty),
      unit: item.unit,
      unitPrice: '',
      total: String(item.lineTotal),
      itemChoice: matchName(item.name, data.items).exact?.uuid ?? choices[index] ?? null,
    }))
    const plan = planLines(drafts, { items: data.items, place, newPlace: created, date: receipt.date, categoryId: receipt.categoryId, parse: parseAmount })
    if ('error' in plan) return setLocalError(plan.error)
    await onConfirm(
      {
        type: 'expense',
        amount: receipt.total,
        date: receipt.date,
        payment_method: activeMethod,
        account_id: activeMethod === 'credit_card' ? null : activeSource,
        cc_id: activeMethod === 'credit_card' ? activeSource : null,
        category_id: receipt.categoryId,
        place_id: place?.uuid ?? null,
        notes: '',
      },
      plan.build,
    )
  }

  return (
    <>
      <FieldRow label="Fecha" value={receipt.date} confidence={score('date')} weak={score('date') < WEAK_CONFIDENCE} />
      <FieldRow label="Comercio" value={receipt.merchant ?? 'Sin lugar'} confidence={score('merchant')} weak={score('merchant') < WEAK_CONFIDENCE} />
      <FieldRow label="Total" value={formatMoney(receipt.total, 'MXN')} confidence={score('total')} weak={score('total') < WEAK_CONFIDENCE} />
      <FieldRow label="Categoría" value={category?.name ?? 'Sin categoría'} confidence={score('category')} weak={score('category') < WEAK_CONFIDENCE} />
      {receipt.last4 && <FieldNote>Tarjeta con terminación {receipt.last4}. Esos dígitos no se guardan.</FieldNote>}
      {receipt.items.length > 0 && <ItemMatches items={receipt.items} data={data} choices={choices} onChoice={(index, choice) => setChoices({ ...choices, [index]: choice })} />}
      {receipt.warnings.map((warning) => <FieldNote key={warning}>{warning}</FieldNote>)}
      {methodOptions.length === 0 ? (
        <FieldNote>Agrega una cuenta para poder guardar el gasto.</FieldNote>
      ) : (
        activeMethod && <ChoiceField label="Método" value={activeMethod} onChange={setMethod} options={methodOptions} />
      )}
      {sources.length > 1 && activeSource && <SelectField label={activeMethod === 'credit_card' ? 'Tarjeta' : 'Cuenta'} value={activeSource} onChange={setSource} options={sources} />}
      {activeMethod === 'credit_card' && <FieldNote>Con tarjeta tu banco no cambia. Sube la deuda y baja tu Disponible real.</FieldNote>}
      {duplicate && !allowDuplicate && (
        <>
          <FieldNote>Ya usaste esta misma respuesta. Crear otro registro duplicaría el gasto.</FieldNote>
          <button type="button" className="verb-button" onClick={onAllowDuplicate}>
            Crear otro de todas formas
          </button>
        </>
      )}
      {localError && <FieldError>{localError}</FieldError>}
      <button type="button" className="verb-button verb-primary" disabled={saving || (duplicate && !allowDuplicate)} onClick={() => void confirm()}>
        <span className="key-glyph">A</span>
        Confirmar gasto
      </button>
    </>
  )
}

function ItemMatches({
  items,
  data,
  choices,
  onChoice,
}: {
  items: ParsedReceiptItem[]
  data: MoneyData
  choices: Record<number, string>
  onChoice: (index: number, choice: string) => void
}) {
  return (
    <ul className="product-list">
      {items.map((item, index) => {
        const match = matchName(item.name, data.items)
        const near = match.exact ? [] : match.near
        const qty = item.qty === null ? 'sin cantidad' : `${item.qty} ${item.unit}`
        return (
          <li key={`${item.name}-${index}`} className="product-line">
            <span>
              {item.name} · {qty} · {formatMoney(item.lineTotal, 'MXN')}
            </span>
            {match.exact && <FieldNote>Se guarda como {match.exact.name}.</FieldNote>}
            {near.length > 0 && !choices[index] && (
              <div className="verb-row">
                {near.slice(0, 3).map((known) => (
                  <button key={known.uuid} type="button" className="verb-button" onClick={() => onChoice(index, known.uuid)}>
                    Sí, {known.name}
                  </button>
                ))}
                <button type="button" className="verb-button" onClick={() => onChoice(index, NEW_ITEM)}>
                  Es otro
                </button>
              </div>
            )}
            {item.note && <FieldNote>{item.note}</FieldNote>}
          </li>
        )
      })}
    </ul>
  )
}

function StatementPreview({
  data,
  statement,
  duplicate,
  allowDuplicate,
  onAllowDuplicate,
  saving,
  onConfirm,
}: {
  data: MoneyData
  statement: ParsedStatement
  duplicate: boolean
  allowDuplicate: boolean
  onAllowDuplicate: () => void
  saving: boolean
  onConfirm: (records: ReturnType<typeof draftTransaction>[]) => Promise<void>
}) {
  const accounts = selectable(data.accounts).filter((a) => a.type === 'checking')
  const [accountId, setAccountId] = useState(statement.matchedAccountId ?? accounts[0]?.uuid ?? '')
  const [excluded, setExcluded] = useState<string[]>(() => statement.rows.filter((row) => row.duplicate === 'exact').map((row) => row.key))
  const [localError, setLocalError] = useState<string | null>(null)
  const account = accounts.find((a) => a.uuid === accountId)
  const included = statement.rows.filter((row) => !excluded.includes(row.key))
  const delta = roundMoney(included.reduce((sum, row) => sum + (row.direction === 'in' ? row.amount : -row.amount), 0))
  const projected = account ? roundMoney(account.current_balance + delta) : null
  const score = (name: string) => level(statement.fieldConfidence, statement.confidence, name)

  function confirm() {
    if (!account) return setLocalError('Elige la cuenta del estado.')
    if (included.length === 0) return setLocalError('No hay movimientos por guardar.')
    if (duplicate && !allowDuplicate) return setLocalError('Esta respuesta ya se usó.')
    const records = included.map((row) =>
      draftTransaction({
        type: row.direction === 'in' ? 'income' : 'expense',
        amount: row.amount,
        date: row.date,
        account_id: account.uuid,
        payment_method: 'bank',
        category_id: row.direction === 'out' ? (data.categories.find((c) => c.key === UNCATEGORIZED_KEY)?.uuid ?? null) : null,
        notes: row.description,
        source: 'ai_manual',
      }),
    )
    void onConfirm(records)
  }

  return (
    <>
      <FieldRow label="Banco" value={statement.accountName ?? 'Sin nombre'} confidence={score('account_name')} weak={score('account_name') < WEAK_CONFIDENCE} />
      {statement.closingBalance !== null && (
        <FieldRow label="Saldo del estado" value={formatMoney(statement.closingBalance, 'MXN')} confidence={score('closing_balance')} weak={score('closing_balance') < WEAK_CONFIDENCE} />
      )}
      {accounts.length === 0 ? (
        <FieldNote>Agrega una cuenta de banco para importar el estado.</FieldNote>
      ) : (
        <SelectField label="Cuenta" value={accountId} onChange={setAccountId} options={accounts.map((a) => ({ value: a.uuid, label: a.name }))} />
      )}
      <table className="roster">
        <thead>
          <tr>
            <th scope="col">Fecha</th>
            <th scope="col">Descripción</th>
            <th scope="col" className="num">Monto</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {statement.rows.map((row) => (
            <StatementLine key={row.key} row={row} excluded={excluded.includes(row.key)} onToggle={() => setExcluded(excluded.includes(row.key) ? excluded.filter((key) => key !== row.key) : [...excluded, row.key])} />
          ))}
        </tbody>
      </table>
      {account && projected !== null && (
        <FieldNote>
          {account.name} pasa de {formatMoney(account.current_balance, 'MXN')} a {formatMoney(projected, 'MXN')}.
          {statement.closingBalance !== null && roundMoney(statement.closingBalance) !== projected
            ? ` El estado dice ${formatMoney(statement.closingBalance, 'MXN')}; no se cambia el saldo para igualarlo.`
            : ''}
        </FieldNote>
      )}
      {statement.warnings.map((warning) => <FieldNote key={warning}>{warning}</FieldNote>)}
      {duplicate && !allowDuplicate && (
        <>
          <FieldNote>Ya usaste esta misma respuesta. Crear otros registros duplicaría los movimientos.</FieldNote>
          <button type="button" className="verb-button" onClick={onAllowDuplicate}>Crear otro de todas formas</button>
        </>
      )}
      {localError && <FieldError>{localError}</FieldError>}
      <button type="button" className="verb-button verb-primary" disabled={saving || (duplicate && !allowDuplicate)} onClick={confirm}>
        <span className="key-glyph">A</span>
        Confirmar {included.length === 1 ? '1 movimiento' : `${included.length} movimientos`}
      </button>
    </>
  )
}

function StatementLine({ row, excluded, onToggle }: { row: StatementRow; excluded: boolean; onToggle: () => void }) {
  const flag = row.duplicate === 'exact' ? 'Ya registrado' : row.duplicate === 'possible' ? 'Posible duplicado' : row.recurringName ? `Parece ${row.recurringName}` : ''
  return (
    <tr className={excluded ? 'dim' : undefined}>
      <td className="mono">{row.date.slice(8)}</td>
      <td>
        {row.description || '—'}
        {flag && <span className="row-sub">{flag}</span>}
      </td>
      <td className={`num mono${row.direction === 'in' ? ' text-cyan' : ''}`}>{formatMoney(row.direction === 'in' ? row.amount : -row.amount, 'MXN')}</td>
      <td>
        <button type="button" className="panel-verb" onClick={onToggle}>
          {excluded ? 'Incluir' : 'Omitir'}
        </button>
      </td>
    </tr>
  )
}
