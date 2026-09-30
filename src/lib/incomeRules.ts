import type { BucketMove, Category, IncomeSlot, RecurringItem, SavingsBucket, Transaction } from '../db/types'
import { topCategoryId } from './categories'
import { FALLBACK_CYCLE_DAYS, isPlainMonthly, itemOccurrences, repeatOf, type IncomeCycle } from './cycle'
import { dateToIso, daysBetween, isoToDate } from './dates'
import { roundMoney } from './money'

export type IncomeRule = 'first' | 'second'

export const MAIN_INCOME_KEY = 'contract_income'

const MATCH_WINDOW_DAYS = 20

export function incomeSlots(recurring: RecurringItem[]): RecurringItem[] {
  return recurring.filter((item) => item.active && item.type === 'income').sort((a, b) => a.due_day - b.due_day)
}

/** Loans paid per income follow day-of-month paydays only. */
export function monthlyIncomeSlots(recurring: RecurringItem[]): RecurringItem[] {
  return incomeSlots(recurring).filter(isPlainMonthly)
}

/** Paydays for a loan that follows the 1st, the 2nd, or every income event. */
export function slotDays(recurring: RecurringItem[], slot: IncomeSlot): number[] {
  const [first, second] = monthlyIncomeSlots(recurring)
  if (slot === 'first') return first ? [first.due_day] : []
  if (slot === 'second') return second ? [second.due_day] : []
  return [first, second].filter(Boolean).map((item) => item!.due_day)
}

export type IncomeFields = Pick<Transaction, 'type' | 'date' | 'category_id'> & { recurring_id?: string | null; occurrence?: string | null }

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

function nearestPayday(slots: RecurringItem[], day: Date): { index: number; date: Date } | null {
  const from = new Date(day.getFullYear(), day.getMonth(), day.getDate() - MATCH_WINDOW_DAYS, 12)
  const to = new Date(day.getFullYear(), day.getMonth(), day.getDate() + MATCH_WINDOW_DAYS + 1, 12)
  let best: { index: number; date: Date } | null = null
  let bestDistance = Infinity
  for (const [index, item] of slots.entries()) {
    for (const occurrence of itemOccurrences(item, from, to)) {
      const distance = Math.abs(occurrence.getTime() - day.getTime())
      if (distance < bestDistance) {
        best = { index, date: occurrence }
        bestDistance = distance
      }
    }
  }
  return best
}

/** Weekly paydays alternate 1st, 2nd, 1st… over every scheduled payday since the earliest start. */
function alternatingRank(tx: IncomeFields, slots: RecurringItem[]): IncomeRule | null {
  const linked = slots.some((item) => item.uuid === tx.recurring_id) && tx.occurrence ? isoToDate(tx.occurrence) : null
  const payday = linked ?? nearestPayday(slots, isoToDate(tx.date))?.date
  if (!payday) return null
  const before = new Set(
    slots.flatMap((item) => itemOccurrences(item, isoToDate(item.start_date), payday).map(dateToIso)),
  )
  return before.size % 2 === 0 ? 'first' : 'second'
}

export function incomeRank(tx: IncomeFields, recurring: RecurringItem[]): IncomeRule | null {
  if (tx.type !== 'income') return null
  const slots = incomeSlots(recurring)
  if (slots.length === 0) return null
  if (slots.some((item) => !isPlainMonthly(item))) return alternatingRank(tx, slots)
  if (slots.length === 1) return 'first'

  const linked = slots.findIndex((item) => item.uuid === tx.recurring_id)
  if (linked >= 0) return rankOf(linked)

  const nearest = nearestPayday(slots, isoToDate(tx.date))
  return nearest ? rankOf(nearest.index) : null
}

export interface ScheduledIncomeMatch {
  item: RecurringItem
  occurrence: string
  distance: number
}

const LINK_WINDOW_DAYS = 10

function linkWindow(item: RecurringItem): number {
  const { frequency, interval } = repeatOf(item)
  return frequency === 'weekly' ? Math.min(LINK_WINDOW_DAYS, Math.floor((7 * interval) / 2)) : LINK_WINDOW_DAYS
}

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
      itemOccurrences(item, from, to)
        .map((when) => ({ item, occurrence: dateToIso(when), distance: Math.abs(daysBetween(day, when)) }))
        .filter(
          (match) =>
            match.distance <= linkWindow(item) && match.occurrence >= item.start_date && !recorded.has(`${item.uuid}|${match.occurrence}`),
        ),
    )
    .sort((a, b) => a.distance - b.distance || a.occurrence.localeCompare(b.occurrence))
}

export function ruleMoves(txId: string, moves: BucketMove[]): BucketMove[] {
  return moves.filter((move) => move.income_tx_id === txId && move.source !== 'manual')
}

export const RULE_SOURCE = { first: 'first_income', second: 'second_income' } as const

export const RULE_LABEL: Record<IncomeRule, string> = { first: '1er ingreso', second: '2º ingreso' }

export function ruleApplied(txId: string, rule: IncomeRule | null, moves: BucketMove[]): boolean {
  const own = ruleMoves(txId, moves)
  return rule ? own.some((move) => move.source === RULE_SOURCE[rule]) : own.length > 0
}

export interface PendingRule {
  income: Transaction
  rule: IncomeRule | null
}

/** Paid a few days before the payday still belongs to that payday's cycle. */
const EARLY_PAY_DAYS = 3

export function pendingRuleIncomes(
  transactions: Transaction[],
  categories: Category[],
  recurring: RecurringItem[],
  moves: BucketMove[],
  cycle: IncomeCycle,
  dismissedAt: string | null | undefined,
  today: Date,
): PendingRule[] {
  const back = cycle.hasSchedule ? EARLY_PAY_DAYS : FALLBACK_CYCLE_DAYS
  const anchor = cycle.hasSchedule ? cycle.start : today
  const from = dateToIso(new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - back, 12))
  const to = dateToIso(today)
  const hiddenThrough = dismissedAt ?? ''
  return transactions
    .filter((tx) => tx.date >= from && tx.date <= to && tx.date > hiddenThrough)
    .filter((tx) => isRuleIncome(tx, categories, recurring))
    .map((tx) => ({ income: tx, rule: incomeRank(tx, recurring) }))
    .filter(({ income, rule }) => !ruleApplied(income.uuid, rule, moves))
    .sort((a, b) => a.income.date.localeCompare(b.income.date))
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