export interface BaseRecord {
  uuid: string
  updated_at: string
}

export type AccountType = 'checking' | 'cash' | 'savings' | 'unassigned'

export interface Account extends BaseRecord {
  name: string
  type: AccountType
  currency: 'MXN' | 'CAD'
  current_balance: number
  balance_date: string
}

export type PaymentStrategy = 'full' | 'statement' | 'minimum'

export interface CreditCard extends BaseRecord {
  name: string
  limit: number
  current_balance: number
  statement_day: number
  due_day: number
  payment_strategy: PaymentStrategy
}

export type TransactionType = 'income' | 'expense' | 'transfer' | 'cc_payment'
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
}

export type CategoryKind = 'expense' | 'income'

export interface Category extends BaseRecord {
  key: string
  name: string
  kind: CategoryKind
}

export interface Settings extends BaseRecord {
  cad_day_rate: number | null
  fx_rate: number | null
  fx_source: 'manual' | 'api' | null
  buffer_mxn: number
  first_income_rule: { target_bucket: 'emergency' }
  second_income_rule: { retirement_pct: number; travel_mxn: number }
}
