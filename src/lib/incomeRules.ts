import type { BucketMove, Category, IncomeSlot, RecurringItem, SavingsBucket, Transaction } from '../db/types'
import { topCategoryId } from './categories'
import { occurrencesBetween } from './cycle'
import { dateToIso, isoToDate } from './dates'
import { roundMoney } from './money'

export type IncomeRule = 'first' | 'second'

export const MAIN_INCOME_KEY = 'contract_income'

const MATCH_WINDOW_DAYS = 20

export function incomeSlots(recurring: RecurringItem[]): RecurringItem[] {
  return recurring.filter((item) => item.active && item.type === 'income').sort((a, b) => a.due_day - b.due_day)
}

/** Paydays for a loan that follows the 1st, the 2nd, or every income event. */
export function slotDays(recurring: RecurringItem[], slot: IncomeSlot): number[] {
  const [first, second] = incomeSlots(recurring)
  if (slot === 'first') return first ? [first.due_day] : []
  if (slot === 'second') return second ? [second.due_day] : []
  return [first, second].filter(Boolean).map((item) => item!.due_day)
}

export type IncomeFields = Pick<Transaction, 'type' | 'date' | 'category_id'> & { recurring_id?: string | null }

export function isRuleIncome(tx: IncomeFields, categories: Category[], recurring: RecurringItem[]): boolean {
  if (tx.type !== 'income') return false
  if (tx.recurring_id && incomeSlots(recurring).some((item) => item.uuid === tx.recurring_id)) return true
  if (!tx.category_id) return false
  return categories.find((c) => c.uuid === topCategoryId(tx.category_id!, categories))?.key === MAIN_INCOME_KEY
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

export interface CustomShare {
  bucket: SavingsBucket
  amount: number
}

export function customShares(buckets: SavingsBucket[], rule: IncomeRule): CustomShare[] {
  return buckets
    .filter((b) => b.rule_type === 'custom' && !b.archived && b.income_share && b.income_share.amount > 0)
    .filter((b) => b.income_share!.income === 'both' || b.income_share!.income === rule)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((bucket) => ({ bucket, amount: bucket.income_share!.amount }))
}

export function fitInOrder(amounts: number[], available: number): number[] {
  let room = Math.max(0, available)
  return amounts.map((amount) => {
    const fitted = roundMoney(Math.min(amount, room))
    room = roundMoney(room - fitted)
    return fitted
  })
}