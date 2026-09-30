import type { MoneyData } from '../db/useMoneyData'
import { bucketsInLiquid } from './buckets'
import { billCommitments, incomeCycle, loanCommitments, sumCommitments, type Commitment, type IncomeCycle } from './cycle'
import { msiPendingByCard } from './msi'
import { computeRealAvailable, type RealAvailableBreakdown } from './realAvailable'

export interface MoneySnapshot {
  cycle: IncomeCycle
  commitments: Commitment[]
  breakdown: RealAvailableBreakdown
}

export function moneySnapshot(data: MoneyData, today: Date): MoneySnapshot {
  const cycle = incomeCycle(data.recurring, today)
  const bills = billCommitments(data.recurring, data.transactions, cycle, today)
  const loans = loanCommitments(data.loans, data.installments, data.transactions, cycle.end, today)

  return {
    cycle,
    commitments: [...bills, ...loans].sort((a, b) => a.date.getTime() - b.date.getTime()),
    breakdown: computeRealAvailable({
      accounts: data.accounts,
      cards: data.cards,
      buffer: data.settings?.buffer_mxn ?? 0,
      billsBeforeNextIncome: sumCommitments(bills),
      loanInstallmentsBeforeNextIncome: sumCommitments(loans),
      bucketsInLiquid: bucketsInLiquid(data.buckets, data.bucketMoves, data.accounts),
      msiPending: msiPendingByCard(data.transactions, data.cards, today),
    }),
  }
}
