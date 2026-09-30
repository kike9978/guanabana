import { UNCATEGORIZED_KEY } from './seed'
import type {
  Account,
  BucketMove,
  Budget,
  Category,
  CreditCard,
  Item,
  Loan,
  LoanInstallment,
  Place,
  RecurringItem,
  SavingsBucket,
  Settings,
  Transaction,
  TransactionLine,
} from './types'
import { useRecords } from './useRecords'

const BUCKET_ORDER: Record<SavingsBucket['rule_type'], number> = { emergency: 0, retirement: 1, travel: 2, custom: 3 }

function compareBuckets(a: SavingsBucket, b: SavingsBucket): number {
  return BUCKET_ORDER[a.rule_type] - BUCKET_ORDER[b.rule_type] || (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name, 'es')
}

export interface MoneyData {
  loaded: boolean
  accounts: Account[]
  cards: CreditCard[]
  categories: Category[]
  transactions: Transaction[]
  recurring: RecurringItem[]
  loans: Loan[]
  installments: LoanInstallment[]
  buckets: SavingsBucket[]
  bucketMoves: BucketMove[]
  budgets: Budget[]
  settings: Settings | undefined
  lines: TransactionLine[]
  items: Item[]
  places: Place[]
}

export function useMoneyData(): MoneyData {
  const accounts = useRecords<Account>('accounts')
  const cards = useRecords<CreditCard>('credit_cards')
  const categories = useRecords<Category>('categories')
  const transactions = useRecords<Transaction>('transactions')
  const recurring = useRecords<RecurringItem>('recurring_items')
  const loans = useRecords<Loan>('loans')
  const installments = useRecords<LoanInstallment>('loan_installments')
  const buckets = useRecords<SavingsBucket>('savings_buckets')
  const bucketMoves = useRecords<BucketMove>('bucket_moves')
  const budgets = useRecords<Budget>('budgets')
  const settings = useRecords<Settings>('settings')
  const lines = useRecords<TransactionLine>('transaction_lines')
  const items = useRecords<Item>('items')
  const places = useRecords<Place>('places')

  return {
    loaded: [accounts, cards, categories, transactions, recurring, loans, installments, buckets, bucketMoves, budgets, settings, lines, items, places].every(
      (rows) => rows !== null,
    ),
    lines: lines ?? [],
    items: [...(items ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'es')),
    places: [...(places ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'es')),
    accounts: accounts ?? [],
    cards: cards ?? [],
    categories: [...(categories ?? [])].sort(
      (a, b) => Number(a.key === UNCATEGORIZED_KEY) - Number(b.key === UNCATEGORIZED_KEY) || a.name.localeCompare(b.name, 'es'),
    ),
    transactions: transactions ?? [],
    recurring: recurring ?? [],
    loans: loans ?? [],
    installments: installments ?? [],
    buckets: [...(buckets ?? [])].sort(compareBuckets),
    bucketMoves: bucketMoves ?? [],
    budgets: budgets ?? [],
    settings: settings?.[0],
  }
}
