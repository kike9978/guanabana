import type { AddPrefill, AddType } from '../../app/navigation'
import type { Transaction } from '../../db/types'
import type { MoneyData } from '../../db/useMoneyData'

export interface AddFormProps {
  data: MoneyData
  onDone: () => void
  onNext?: (type: AddType, prefill: AddPrefill) => void
  onOpenAccounts: () => void
  prefill?: AddPrefill
  editing?: Transaction
}
