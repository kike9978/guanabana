import { UNCATEGORIZED_KEY } from './seed'
import type { Account, Category, CreditCard, Settings, Transaction } from './types'
import { useRecords } from './useRecords'

export interface MoneyData {
  loaded: boolean
  accounts: Account[]
  cards: CreditCard[]
  categories: Category[]
  transactions: Transaction[]
  settings: Settings | undefined
}

export function useMoneyData(): MoneyData {
  const accounts = useRecords<Account>('accounts')
  const cards = useRecords<CreditCard>('credit_cards')
  const categories = useRecords<Category>('categories')
  const transactions = useRecords<Transaction>('transactions')
  const settings = useRecords<Settings>('settings')

  return {
    loaded: accounts !== null && cards !== null && categories !== null && transactions !== null,
    accounts: accounts ?? [],
    cards: cards ?? [],
    categories: [...(categories ?? [])].sort(
      (a, b) => Number(a.key === UNCATEGORIZED_KEY) - Number(b.key === UNCATEGORIZED_KEY) || a.name.localeCompare(b.name, 'es'),
    ),
    transactions: transactions ?? [],
    settings: settings?.[0],
  }
}
