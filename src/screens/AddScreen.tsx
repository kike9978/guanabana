import { addLabel, type AddPrefill, type AddType } from '../app/navigation'
import { Panel } from '../components/hud'
import { StageHeader } from '../components/StageHeader'
import type { Transaction } from '../db/types'
import { useMoneyData } from '../db/useMoneyData'
import { CcPaymentForm } from './add/CcPaymentForm'
import { ExpenseForm } from './add/ExpenseForm'
import { IncomeForm } from './add/IncomeForm'
import { IncomeRuleForm } from './add/IncomeRuleForm'
import { TransferForm } from './add/TransferForm'

export function AddScreen({
  type,
  prefill,
  editing,
  onDone,
  onNext,
  onOpenAccounts,
}: {
  type: AddType
  prefill?: AddPrefill
  editing?: Transaction
  onDone: () => void
  onNext: (type: AddType, prefill: AddPrefill) => void
  onOpenAccounts: () => void
}) {
  const data = useMoneyData()
  const label = addLabel(type)
  const formProps = { data, onDone, onNext, onOpenAccounts, prefill, editing }
  const title = editing ? `Editar ${label.toLowerCase()}` : prefill?.notes ? `${label} · ${prefill.notes}` : label

  return (
    <div className="stage-grid stage-grid--single">
      <div className="stage-main stage-narrow">
        <StageHeader title={title} aiBridge={!editing && (type === 'expense' || type === 'income')} />
        <Panel title="Registro">
          {!data.loaded ? null : (
            <>
              {type === 'expense' && <ExpenseForm {...formProps} />}
              {type === 'income' && <IncomeForm {...formProps} />}
              {type === 'transfer' && <TransferForm {...formProps} />}
              {type === 'cc_payment' && <CcPaymentForm {...formProps} />}
              {type === 'savings_rule' && <IncomeRuleForm {...formProps} />}
            </>
          )}
        </Panel>
      </div>
    </div>
  )
}
