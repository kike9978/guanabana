import { addLabel, type AddType } from '../app/navigation'
import { FooterHint, Panel } from '../components/hud'
import { StageHeader } from '../components/StageHeader'
import { useMoneyData } from '../db/useMoneyData'
import { CcPaymentForm } from './add/CcPaymentForm'
import { ExpenseForm } from './add/ExpenseForm'
import { IncomeForm } from './add/IncomeForm'
import { TransferForm } from './add/TransferForm'

export function AddScreen({ type, onDone, onOpenAccounts }: { type: AddType; onDone: () => void; onOpenAccounts: () => void }) {
  const data = useMoneyData()
  const label = addLabel(type)
  const formProps = { data, onDone, onOpenAccounts }

  return (
    <div className="stage-grid stage-grid--single">
      <div className="stage-main stage-narrow">
        <StageHeader title={label} aiBridge={type === 'expense' || type === 'income'} />
        <Panel title="Registro">
          {type === 'expense' && <ExpenseForm {...formProps} />}
          {type === 'income' && <IncomeForm {...formProps} />}
          {type === 'transfer' && <TransferForm {...formProps} />}
          {type === 'cc_payment' && <CcPaymentForm {...formProps} />}
          {type === 'savings_rule' && (
            <FooterHint>Las reglas del primer y segundo ingreso llegan en la siguiente fase.</FooterHint>
          )}
        </Panel>
      </div>
    </div>
  )
}
