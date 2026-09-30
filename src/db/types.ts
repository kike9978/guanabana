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
  /** What the statement of `statement_date` billed, when the user entered it. */
  statement_balance?: number | null
  minimum_payment?: number | null
  /** The cut `statement_balance` and `minimum_payment` belong to; older cuts are ignored. */
  statement_date?: string | null
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
  /** Card expense split into interest-free monthly charges (meses sin intereses). */
  msi_months?: number | null
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

export type BucketMoveSource = 'manual' | 'first_income' | 'second_income' | 'bucket_transfer' | 'opening'

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

export type RepeatFrequency = 'monthly' | 'weekly'

export interface RecurringItem extends BaseRecord {
  name: string
  type: 'bill' | 'income'
  amount: number | null
  /** Missing on rows saved before repeat rules: read as monthly, every 1. */
  frequency?: RepeatFrequency
  /** Months (1, 2, 3, 6, 12) or weeks (1–4) between occurrences, counted from `start_date`. */
  interval?: number
  /** Monthly only. Weekly items fall on the weekday of `start_date`. */
  due_day: number
  account_id: string | null
  cc_id?: string | null
  category_id: string | null
  start_date: string
  active: boolean
}

/** A different reserve for one occurrence. It never writes a transaction; the registered payment stays the record. */
export interface RecurringOverride extends BaseRecord {
  recurring_id: string
  occurrence: string
  amount: number
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

export type PriceUnit = 'pza' | 'kg' | 'g' | 'L' | 'ml'
export type PlaceKind = 'supermarket' | 'market' | 'convenience' | 'other'

/** A store or stall. Not an account: it never holds money. */
export interface Place extends BaseRecord {
  name: string
  normalized_name: string
  kind: PlaceKind
  area: string | null
}

export interface Item extends BaseRecord {
  name: string
  normalized_name: string
  default_unit: PriceUnit
  category_id: string | null
  barcode?: string | null
}

/** One product on an expense. Explains the expense; never moves a balance. */
export interface TransactionLine extends BaseRecord {
  transaction_id: string
  item_id: string
  place_id: string | null
  date: string
  qty: number | null
  unit: PriceUnit
  unit_price: number | null
  line_total: number
  currency: 'MXN'
}

export type AiTask = 'parse_receipt' | 'parse_bank_statement'
export type AiJobStatus = 'prompt_copied' | 'json_pasted' | 'validated' | 'committed' | 'failed'

export interface AiJob extends BaseRecord {
  task: AiTask
  status: AiJobStatus
  prompt_hash: string
  response_hash: string | null
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
  msi_months?: number | null
  income_monthly: number | null
  extra_expenses: number
  daily_spend?: number
}

export interface Settings extends BaseRecord {
  buffer_mxn: number
  cash_reviewed_at?: string | null
  rule_prompt_dismissed_at?: string | null
  first_income_rule: { target_bucket: 'emergency' }
  second_income_rule: { retirement_pct: number; travel_mxn: number }
}
