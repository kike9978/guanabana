import type { Tone } from '../components/hud'
import type { Account, CreditCard } from '../db/types'
import { roundMoney } from './money'
import { payableBalance } from './msi'

export interface RealAvailableBreakdown {
  bank: number
  cash: number
  unassigned: number
  ccReserve: number
  ccMsiPending: number
  billsBeforeNextIncome: number
  invoicesOutstanding: number
  loanInstallmentsBeforeNextIncome: number
  bucketsInLiquid: number
  buffer: number
  total: number
}

export interface RealAvailableInput {
  accounts: Account[]
  cards: CreditCard[]
  buffer: number
  billsBeforeNextIncome?: number
  invoicesOutstanding?: number
  loanInstallmentsBeforeNextIncome?: number
  bucketsInLiquid?: number
  msiPending?: Record<string, number>
}

function sumBalances(accounts: Account[], type: Account['type']): number {
  return accounts
    .filter((account) => account.type === type && account.currency === 'MXN')
    .reduce((sum, account) => sum + account.current_balance, 0)
}

/** Every card reserves its whole payable balance; the strategy only changes the next payment. */
export function ccReserve(cards: CreditCard[], msiPending: Record<string, number> = {}): number {
  return cards.reduce((sum, card) => sum + payableBalance(card, msiPending), 0)
}

export function computeRealAvailable({
  accounts,
  cards,
  buffer,
  billsBeforeNextIncome = 0,
  invoicesOutstanding = 0,
  loanInstallmentsBeforeNextIncome = 0,
  bucketsInLiquid = 0,
  msiPending = {},
}: RealAvailableInput): RealAvailableBreakdown {
  const bank = sumBalances(accounts, 'checking')
  const cash = sumBalances(accounts, 'cash')
  const unassigned = sumBalances(accounts, 'unassigned')
  const reserve = ccReserve(cards, msiPending)
  const fullDebt = ccReserve(cards)

  const total = roundMoney(
    bank +
      cash +
      unassigned -
      reserve -
      billsBeforeNextIncome -
      invoicesOutstanding -
      loanInstallmentsBeforeNextIncome -
      bucketsInLiquid -
      buffer,
  )

  return {
    bank: roundMoney(bank),
    cash: roundMoney(cash),
    unassigned: roundMoney(unassigned),
    ccReserve: roundMoney(reserve),
    ccMsiPending: roundMoney(fullDebt - reserve),
    billsBeforeNextIncome,
    invoicesOutstanding,
    loanInstallmentsBeforeNextIncome,
    bucketsInLiquid,
    buffer,
    total,
  }
}

const TIGHT_SHARE_OF_LIQUID = 0.1

export function realAvailableTone(breakdown: RealAvailableBreakdown, hasMoneyData: boolean): Tone {
  if (!hasMoneyData) return 'empty'
  if (breakdown.total < 0) return 'shortfall'
  const liquid = breakdown.bank + breakdown.cash + breakdown.unassigned
  if (breakdown.total <= liquid * TIGHT_SHARE_OF_LIQUID) return 'tight'
  return 'safe'
}
