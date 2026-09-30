export interface BaseRecord {
  uuid: string
  updated_at: string
}

export type AccountType = 'checking' | 'cash' | 'savings' | 'unassigned'

export interface Account extends BaseRecord {
  name: string
  type: AccountType
  currency: 'MXN'
  current_balance: number
  balance_date: string
  archived?: boolean
}

export type PaymentStrategy = 'full' | 'statement' | 'minimum'

export interface CreditCard extends BaseRecord {
  name: string
  limit: number
  current_balance: number
  statement_day: number
  due_day: number
  payment_strategy: PaymentStrategy
  archived?: boolean
}

export type TransactionType = 'income' | 'expense' | 'transfer' | 'cc_payment' | 'adjustment'
export type PaymentMethod = 'bank' | 'cash' | 'credit_card' | 'unassigned'
export type RecordSource = 'manual' | 'ai_manual' | 'import'

export interface Transaction extends BaseRecord {
  date: string
  type: TransactionType
  amount: number
  currency: 'MXN'
  account_id: string | null
  to_account_id: string | null
  cc_id: string | null
  category_id: string | null
  place_id: string | null
  payment_method: PaymentMethod | null
  notes: string
  source: RecordSource
  recurring_id?: string | null
  occurrence?: string | null
  loan_installment_id?: string | null
  loan_extra_id?: string | null
  bucket_id?: string | null
}

export type BucketRule = 'emergency' | 'retirement' | 'travel'

export type BucketKind = BucketRule | 'custom'

export interface SavingsBucket extends BaseRecord {
  name: string
  rule_type: BucketKind
  target: number | null
  target_date?: string | null
  account_id: string | null
  sort_order?: number
  archived?: boolean
  income_share?: IncomeShare | null
}

export interface IncomeShare {
  income: 'first' | 'second' | 'both'
  amount: number
}

export type BucketMoveSource = 'manual' | 'first_income' | 'second_income' | 'bucket_transfer'

export interface BucketMove extends BaseRecord {
  bucket_id: string
  amount: number
  date: string
  reason: string
  source: BucketMoveSource
  income_tx_id?: string | null
  transfer_id?: string | null
  tx_id?: string | null
  reverses_id?: string | null
}

export interface RecurringItem extends BaseRecord {
  name: string
  type: 'bill' | 'income'
  amount: number | null
  due_day: number
  account_id: string | null
  category_id: string | null
  start_date: string
  active: boolean
}

export type LoanDirection = 'borrowed' | 'lent'
export type LoanInterest = 'none' | 'fixed_installment' | 'fixed_rate'
export type LoanFrequency = 'monthly' | 'biweekly' | 'per_income'
export type IncomeSlot = 'first' | 'second' | 'both'

export interface Loan extends BaseRecord {
  name: string
  direction: LoanDirection
  lender_label: string
  principal: number
  currency: 'MXN'
  interest: LoanInterest
  rate_annual: number | null
  installment_amount: number | null
  frequency: LoanFrequency
  income_slot?: IncomeSlot | null
  first_due_date: string
  installment_count: number
  pay_from_account_id: string | null
  status: 'active' | 'paid' | 'paused'
}

export interface LoanInstallment extends BaseRecord {
  loan_id: string
  due_date: string
  amount: number
  principal_part: number
  interest_part: number
  status: 'scheduled' | 'skipped' | 'settled' | 'superseded'
  created_by?: string | null
  replaced_by?: string | null
}

export type CategoryKind = 'expense' | 'income'

export interface Category extends BaseRecord {
  key: string
  name: string
  kind: CategoryKind
  parent_id?: string | null
  archived?: boolean
}

export interface Budget extends BaseRecord {
  category_id: string
  month: string | null
  limit_mxn: number
}

export interface ProjectionScenario extends BaseRecord {
  name: string
  amount: number
  date: string
  card_id: string | null
  income_monthly: number | null
  extra_expenses: number
  daily_spend?: number
}

export interface Settings extends BaseRecord {
  buffer_mxn: number
  cash_reviewed_at?: string | null
  first_income_rule: { target_bucket: 'emergency' }
  second_income_rule: { retirement_pct: number; travel_mxn: number }
}
