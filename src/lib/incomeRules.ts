import type { BucketMove, Category, RecurringItem, Transaction } from '../db/types'
import { occurrencesBetween } from './cycle'
import { dateToIso, isoToDate } from './dates'
import { roundMoney } from './money'

export type IncomeRule = 'first' | 'second'

export const MAIN_INCOME_KEY = 'contract_income'

const MATCH_WINDOW_DAYS = 20

export function incomeSlots(recurring: RecurringItem[]): RecurringItem[] {
  return recurring.filter((item) => item.active && item.type === 'income').sort((a, b) => a.due_day - b.due_day)
}

export type IncomeFields = Pick<Transaction, 'type' | 'date' | 'category_id'> & { recurring_id?: string | null }

export function isRuleIncome(tx: IncomeFields, categories: Category[], recurring: RecurringItem[]): boolean {
  if (tx.type !== 'income') return false
  if (tx.recurring_id && incomeSlots(recurring).some((item) => item.uuid === tx.recurring_id)) return true
  return categories.find((c) => c.uuid === tx.category_id)?.key === MAIN_INCOME_KEY
}

function rankOf(index: number): IncomeRule | null {
  if (index === 0) return 'first'
  if (index === 1) return 'second'
  return null
}

export function incomeRank(tx: IncomeFields, recurring: RecurringItem[]): IncomeRule | null {
  if (tx.type !== 'income') return null
  const slots = incomeSlots(recurring)
  if (slots.length === 0) return null
  if (slots.length === 1) return 'first'

  const linked = slots.findIndex((item) => item.uuid === tx.recurring_id)
  if (linked >= 0) return rankOf(linked)

  const date = isoToDate(tx.date)
  const from = new Date(date.getFullYear(), date.getMonth(), date.getDate() - MATCH_WINDOW_DAYS, 12)
  const to = new Date(date.getFullYear(), date.getMonth(), date.getDate() + MATCH_WINDOW_DAYS + 1, 12)
  let bestIndex = -1
  let bestDistance = Infinity
  for (const [index, item] of slots.entries()) {
    for (const occurrence of occurrencesBetween(item.due_day, from, to)) {
      const distance = Math.abs(occurrence.getTime() - date.getTime())
      if (distance < bestDistance) {
        bestIndex = index
        bestDistance = distance
      }
    }
  }
  return rankOf(bestIndex)
}

export interface ScheduledIncomeMatch {
  item: RecurringItem
  occurrence: string
  distance: number
}

const LINK_WINDOW_DAYS = 10

export function scheduledIncomeMatches(
  recurring: RecurringItem[],
  transactions: Transaction[],
  date: string,
  ignoreTxId?: string,
): ScheduledIncomeMatch[] {
  const recorded = new Set(
    transactions
      .filter((tx) => tx.recurring_id && tx.occurrence && tx.uuid !== ignoreTxId)
      .map((tx) => `${tx.recurring_id}|${tx.occurrence}`),
  )
  const day = isoToDate(date)
  const from = new Date(day.getFullYear(), day.getMonth(), day.getDate() - LINK_WINDOW_DAYS, 12)
  const to = new Date(day.getFullYear(), day.getMonth(), day.getDate() + LINK_WINDOW_DAYS + 1, 12)
  return incomeSlots(recurring)
    .flatMap((item) =>
      occurrencesBetween(item.due_day, from, to)
        .map((when) => ({ item, occurrence: dateToIso(when), distance: Math.round(Math.abs(when.getTime() - day.getTime()) / 86_400_000) }))
        .filter((match) => match.occurrence >= item.start_date && !recorded.has(`${item.uuid}|${match.occurrence}`)),
    )
    .sort((a, b) => a.distance - b.distance || a.occurrence.localeCompare(b.occurrence))
}

export function ruleMoves(txId: string, moves: BucketMove[]): BucketMove[] {
  return moves.filter((move) => move.income_tx_id === txId && move.source !== 'manual')
}

export interface FirstRuleInput {
  liquid: number
  income: number
  reserved: number
  cardReserve: number
}

export interface FirstRulePlan extends FirstRuleInput {
  remainder: number
  suggested: number
}

export function planFirstIncome(input: FirstRuleInput): FirstRulePlan {
  const remainder = roundMoney(input.liquid - input.income - input.reserved - input.cardReserve)
  return { ...input, remainder, suggested: Math.max(0, remainder) }
}

export interface SecondRuleInput {
  income: number
  retirementPct: number
  travelMax: number
  available: number
}

export interface SecondRulePlan extends SecondRuleInput {
  retirement: number
  travel: number
  need: number
  short: number
}

export function planSecondIncome(input: SecondRuleInput): SecondRulePlan {
  const retirement = roundMoney(Math.max(0, input.income * input.retirementPct))
  const travel = roundMoney(Math.max(0, Math.min(input.travelMax, input.income - retirement)))
  return { ...input, retirement, travel, ...shortfall(retirement, travel, input.available) }
}

export function shortfall(retirement: number, travel: number, available: number): { need: number; short: number } {
  const need = roundMoney(retirement + travel)
  return { need, short: roundMoney(Math.max(0, need - Math.max(0, available))) }
}

export function fitToAvailable(retirement: number, travel: number, available: number): { retirement: number; travel: number } {
  const room = Math.max(0, available)
  if (retirement + travel <= room) return { retirement, travel }
  if (retirement <= room) return { retirement, travel: roundMoney(room - retirement) }
  return { retirement: roundMoney(room), travel: 0 }
}
