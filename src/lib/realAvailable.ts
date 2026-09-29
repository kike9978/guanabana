import type { Tone } from '../components/hud'
import type { Account, CreditCard } from '../db/types'
import { roundMoney } from './money'

export interface RealAvailableBreakdown {
  bank: number
  cash: number
  unassigned: number
  ccReserve: number
  billsBeforeNextIncome: number
  loanInstallmentsBeforeNextIncome: number
  bucketsInLiquid: number
  buffer: number
  total: number
}

export interface RealAvailableInput {
  accounts: Account[]
  cards: CreditCard[]
  buffer: number
}

function sumBalances(accounts: Account[], type: Account['type']): number {
  return accounts
    .filter((account) => account.type === type && account.currency === 'MXN')
    .reduce((sum, account) => sum + account.current_balance, 0)
}

export function ccReserve(cards: CreditCard[]): number {
  return cards
    .filter((card) => card.payment_strategy === 'full')
    .reduce((sum, card) => sum + Math.max(0, card.current_balance), 0)
}

export function computeRealAvailable({ accounts, cards, buffer }: RealAvailableInput): RealAvailableBreakdown {
  const bank = sumBalances(accounts, 'checking')
  const cash = sumBalances(accounts, 'cash')
  const unassigned = sumBalances(accounts, 'unassigned')
  const reserve = ccReserve(cards)
  const billsBeforeNextIncome = 0
  const loanInstallmentsBeforeNextIncome = 0
  const bucketsInLiquid = 0

  const total = roundMoney(
    bank + cash + unassigned - reserve - billsBeforeNextIncome - loanInstallmentsBeforeNextIncome - bucketsInLiquid - buffer,
  )

  return {
    bank: roundMoney(bank),
    cash: roundMoney(cash),
    unassigned: roundMoney(unassigned),
    ccReserve: roundMoney(reserve),
    billsBeforeNextIncome,
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
