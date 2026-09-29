import type { Account, Settings, Transaction } from '../db/types'
import { daysBetween, isoToDate } from './dates'

export const CASH_REVIEW_DAYS = 7

export interface CashReview {
  account: Account
  lastReview: string
}

export function cashReviewDue(
  accounts: Account[],
  transactions: Transaction[],
  settings: Pick<Settings, 'cash_reviewed_at'> | null,
  today: Date,
): CashReview[] {
  return accounts
    .filter((account) => account.type === 'cash' && !account.archived)
    .map((account) => {
      const adjusted = transactions
        .filter((tx) => tx.type === 'adjustment' && tx.account_id === account.uuid)
        .map((tx) => tx.date)
      const lastReview = [account.balance_date, settings?.cash_reviewed_at ?? '', ...adjusted].reduce((max, date) => (date > max ? date : max))
      return { account, lastReview }
    })
    .filter((review) => daysBetween(isoToDate(review.lastReview), today) >= CASH_REVIEW_DAYS)
}
