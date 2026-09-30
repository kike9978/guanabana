import type { BucketMove, CreditCard, PlanItem, PlannedContribution, SavingsBucket, Transaction } from '../db/types'
import type { MoneyData } from '../db/useMoneyData'
import { bucketBalance } from './buckets'
import { dateToIso, isoToDate } from './dates'
import { customShares, fitInOrder, incomeRank, planSecondIncome, type IncomeRule } from './incomeRules'
import { roundMoney } from './money'
import { msiUnbilled } from './msi'
import { projectedAvailable, type ProjectionAssumptions } from './projection'
import { timeline } from './timeline'

export const PLAN_MIN_DAYS = 90
export const PLAN_ASAP_MONTHS = 12
export const PLAN_MAX_MONTHS = 24
const TAIL_DAYS = 35
const TIGHT_SHARE = 0.1

function noon(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12)
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12)
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate(), 12)
}

function later(a: Date, b: Date): Date {
  return a > b ? a : b
}

export function isBought(item: PlanItem, transactions: Transaction[]): boolean {
  return item.tx_id !== null && transactions.some((tx) => tx.uuid === item.tx_id)
}

/** Wishes that count in the plan, in list order. */
export function activeItems(items: PlanItem[], transactions: Transaction[]): PlanItem[] {
  return sortItems(items).filter((item) => item.enabled && item.status === 'planned' && !isBought(item, transactions))
}

export function sortItems(items: PlanItem[]): PlanItem[] {
  return [...items].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'es'))
}

export interface PlanInput extends ProjectionAssumptions {
  items: PlanItem[]
  contributions: PlannedContribution[]
  includeRules: boolean
}

export interface PlanContribution {
  date: Date
  bucketId: string
  amount: number
  source: 'rule' | 'planned'
}

export interface PlanPoint {
  date: Date
  income: boolean
  /** Projected Disponible real with the contributions and without wishes. */
  base: number
  available: number
}

export interface DrawResult {
  bucket: SavingsBucket
  requested: number
  granted: number
}

export type ItemStatus = 'fits' | 'tight' | 'short'

export interface ItemResult {
  item: PlanItem
  /** Null when a “lo antes posible” wish does not fit within the search window. */
  date: Date | null
  asap: boolean
  draws: DrawResult[]
  drawCapped: boolean
  fromBuckets: number
  fromAvailable: number
  /** Projected Disponible real that day with the wishes above, before this one. */
  before: number
  after: number
  lowest: { date: Date; available: number } | null
  status: ItemStatus
  short: number
  card: { card: CreditCard; debtAfter: number } | null
}

export interface BucketPlan {
  bucket: SavingsBucket
  today: number
  end: number
  contributed: number
  drawn: number
  reachedOn: Date | null
}

export interface PlanResult {
  horizon: Date
  points: PlanPoint[]
  items: ItemResult[]
  buckets: BucketPlan[]
  contributions: PlanContribution[]
  lowest: { date: Date; available: number }
  unknownIncome: number
}

interface ProjectedIncome {
  date: Date
  amount: number
  rank: IncomeRule | null
}

function projectedIncomes(data: MoneyData, today: Date, horizon: Date, factor: number): ProjectedIncome[] {
  return timeline(data, addDays(today, 1), addDays(horizon, 1))
    .filter((event) => event.kind === 'income' && !event.paid && (event.amount ?? 0) > 0)
    .map((event) => ({
      date: noon(event.date),
      amount: roundMoney((event.amount ?? 0) * factor),
      rank: incomeRank(
        {
          type: 'income',
          date: dateToIso(event.date),
          category_id: null,
          recurring_id: event.action?.prefill.recurring_id ?? null,
          occurrence: event.action?.prefill.occurrence ?? null,
        },
        data.recurring,
      ),
    }))
}

function slotMatches(slot: PlannedContribution['income_slot'], rank: IncomeRule | null): boolean {
  return slot === 'both' || slot === rank
}

function itemDate(item: PlanItem, today: Date): Date | null {
  if (!item.target_date) return null
  return later(isoToDate(item.target_date), today)
}

/** What the wish takes from Disponible real on `on` before any draw: the whole amount, or with MSI the charges posted by then. */
function costOn(item: PlanItem, card: CreditCard | undefined, date: Date, on: Date): number {
  if (on < date) return 0
  if (card && (item.msi_months ?? 0) > 1) {
    return roundMoney(item.amount - msiUnbilled({ date: dateToIso(date), amount: item.amount, months: item.msi_months! }, card.statement_day, on))
  }
  return item.amount
}

/** How much the plan changes projected Disponible real on `on`: rules and contributions come off, and a wish costs only what its apartados do not cover. */
export function planDelta(result: PlanResult, on: Date): number {
  const day = noon(on)
  const contributed = result.contributions.filter((row) => noon(row.date) <= day).reduce((sum, row) => sum + row.amount, 0)
  let wishes = 0
  for (const row of result.items) {
    if (!row.date || noon(row.date) > day) continue
    const cost = costOn(row.item, row.card?.card, row.date, day)
    wishes += roundMoney(-cost + Math.min(row.fromBuckets, cost))
  }
  return roundMoney(-contributed + wishes)
}

export interface CardDrawLeft {
  item: PlanItem
  bucketId: string
  cardId: string
  left: number
}

/** What a bought card wish still expects from each apartado, after the purchase and later payments. */
export function cardDrawsLeft(items: PlanItem[], transactions: Transaction[], moves: BucketMove[]): CardDrawLeft[] {
  const rows: CardDrawLeft[] = []
  for (const item of items) {
    if (!isBought(item, transactions) || item.payment_method !== 'credit_card' || !item.card_id || item.status !== 'planned') continue
    const txIds = new Set(transactions.filter((tx) => tx.plan_item_id === item.uuid).map((tx) => tx.uuid))
    const seeds = moves.filter((move) => move.plan_item_id === item.uuid || (move.tx_id !== null && move.tx_id !== undefined && txIds.has(move.tx_id)))
    const seedIds = new Set(seeds.map((move) => move.uuid))
    const related = [...seeds, ...moves.filter((move) => move.reverses_id && seedIds.has(move.reverses_id))]
    for (const draw of item.bucket_draws) {
      const net = related.filter((move) => move.bucket_id === draw.bucket_id).reduce((sum, move) => sum + move.amount, 0)
      const left = roundMoney(draw.amount + Math.min(0, net))
      if (left > 0) rows.push({ item, bucketId: draw.bucket_id, cardId: item.card_id, left })
    }
  }
  return rows
}

export function projectPlan(data: MoneyData, rawToday: Date, input: PlanInput): PlanResult {
  const today = noon(rawToday)
  const factor = input.incomeFactor ?? 1
  const assumptions: ProjectionAssumptions = { incomeFactor: factor, extraExpenses: input.extraExpenses, dailySpend: input.dailySpend }
  const items = activeItems(input.items, data.transactions)
  const buckets = data.buckets.filter((bucket) => !bucket.archived)
  const bucketById = new Map(buckets.map((bucket) => [bucket.uuid, bucket]))

  const dated = items.map((item) => itemDate(item, today)).filter((date): date is Date => date !== null)
  const hasAsap = items.some((item) => !item.target_date)
  let horizon = addDays(today, PLAN_MIN_DAYS)
  for (const date of dated) horizon = later(horizon, addDays(date, TAIL_DAYS))
  if (hasAsap) horizon = later(horizon, addMonths(today, PLAN_ASAP_MONTHS))
  if (horizon > addMonths(today, PLAN_MAX_MONTHS)) horizon = addMonths(today, PLAN_MAX_MONTHS)

  const incomes = projectedIncomes(data, today, horizon, factor)
  const incomeDays = new Set(incomes.map((income) => dateToIso(income.date)))
  const byDay = new Map<string, Date>()
  for (const date of [today, ...incomes.map((income) => income.date), ...dated.filter((date) => date <= horizon), horizon]) {
    byDay.set(dateToIso(date), date)
  }
  const dates = [...byDay.values()].sort((a, b) => a.getTime() - b.getTime())
  const base = dates.map((date) => roundMoney(projectedAvailable(data, today, date, assumptions)))
  const indexOf = (date: Date) => dates.findIndex((d) => dateToIso(d) === dateToIso(date))

  const balances = new Map(buckets.map((bucket) => [bucket.uuid, bucketBalance(bucket, data.bucketMoves)]))
  const contributions: PlanContribution[] = []
  const retirementPct = data.settings?.second_income_rule?.retirement_pct ?? 0.2
  const travelMax = data.settings?.second_income_rule?.travel_mxn ?? 5000
  const system = (type: SavingsBucket['rule_type']) => buckets.find((bucket) => bucket.rule_type === type)

  let contributed = 0
  for (const income of incomes) {
    const lines: Omit<PlanContribution, 'amount'>[] = []
    const amounts: number[] = []
    const add = (bucket: SavingsBucket | undefined, amount: number, source: PlanContribution['source']) => {
      if (!bucket || amount <= 0) return
      lines.push({ date: income.date, bucketId: bucket.uuid, source })
      amounts.push(roundMoney(amount))
    }
    if (input.includeRules && income.rank) {
      if (income.rank === 'second') {
        const rule = planSecondIncome({ income: income.amount, retirementPct, travelMax, available: 0 })
        add(system('retirement'), rule.retirement, 'rule')
        add(system('travel'), rule.travel, 'rule')
      }
      for (const share of customShares(buckets, income.rank)) add(share.bucket, share.amount, 'rule')
    }
    for (const planned of input.contributions) {
      const bucket = bucketById.get(planned.bucket_id)
      if (!planned.enabled || !bucket || !slotMatches(planned.income_slot, income.rank)) continue
      const room = bucket.target ? Math.max(0, bucket.target - (balances.get(bucket.uuid) ?? 0)) : Infinity
      add(bucket, Math.min(planned.amount, room), 'planned')
    }
    if (lines.length === 0) continue
    const fitted = fitInOrder(amounts, base[indexOf(income.date)] - contributed)
    lines.forEach((line, index) => {
      if (fitted[index] <= 0) return
      contributions.push({ ...line, amount: fitted[index] })
      balances.set(line.bucketId, roundMoney((balances.get(line.bucketId) ?? 0) + fitted[index]))
      contributed = roundMoney(contributed + fitted[index])
    })
  }

  const contributedBy = (date: Date, bucketId?: string) =>
    roundMoney(
      contributions
        .filter((c) => c.date <= date && (bucketId === undefined || c.bucketId === bucketId))
        .reduce((sum, c) => sum + c.amount, 0),
    )
  const plan = dates.map((date, index) => roundMoney(base[index] - contributedBy(date)))
  const baseline = [...plan]
  const draws: { date: Date; bucketId: string; amount: number }[] = []
  const drawnBy = (date: Date, bucketId: string) =>
    draws.filter((d) => d.bucketId === bucketId && d.date <= date).reduce((sum, d) => sum + d.amount, 0)
  const startBalance = new Map(buckets.map((bucket) => [bucket.uuid, bucketBalance(bucket, data.bucketMoves)]))
  const bucketOn = (bucketId: string, date: Date) =>
    roundMoney((startBalance.get(bucketId) ?? 0) + contributedBy(date, bucketId) - drawnBy(date, bucketId))

  const grant = (item: PlanItem, from: number): DrawResult[] => {
    const taken = new Map<string, number>()
    let room = item.amount
    return item.bucket_draws.flatMap((draw) => {
      const bucket = bucketById.get(draw.bucket_id)
      if (!bucket || draw.amount <= 0) return []
      let available = Infinity
      for (let index = from; index < dates.length; index++) {
        available = Math.min(available, bucketOn(bucket.uuid, dates[index]) - (taken.get(bucket.uuid) ?? 0))
      }
      const granted = roundMoney(Math.max(0, Math.min(draw.amount, available, room)))
      taken.set(bucket.uuid, (taken.get(bucket.uuid) ?? 0) + granted)
      room = roundMoney(room - granted)
      return [{ bucket, requested: draw.amount, granted }]
    })
  }

  const effect = (item: PlanItem, card: CreditCard | undefined, date: Date, covered: number, on: Date) => {
    const cost = costOn(item, card, date, on)
    return roundMoney(-cost + Math.min(covered, cost))
  }

  const results: ItemResult[] = []
  for (const item of items) {
    const card = item.payment_method === 'credit_card' ? data.cards.find((c) => c.uuid === item.card_id) : undefined
    const fixed = itemDate(item, today)
    const tryAt = (index: number) => {
      const granted = grant(item, index)
      const covered = roundMoney(granted.reduce((sum, d) => sum + d.granted, 0))
      const after = dates.map((on, j) => (j < index ? plan[j] : roundMoney(plan[j] + effect(item, card, dates[index], covered, on))))
      const low = after.slice(index).reduce((min, value) => Math.min(min, value), Infinity)
      return { index, granted, covered, after, low }
    }

    let attempt: ReturnType<typeof tryAt> | null = null
    if (fixed) {
      const index = indexOf(fixed)
      if (index >= 0) attempt = tryAt(index)
    } else {
      const limit = addMonths(today, PLAN_ASAP_MONTHS)
      for (let index = 0; index < dates.length && dates[index] <= limit; index++) {
        if (index > 0 && !incomeDays.has(dateToIso(dates[index]))) continue
        const candidate = tryAt(index)
        if (candidate.low >= 0) {
          attempt = candidate
          break
        }
      }
    }

    if (!attempt) {
      results.push({
        item,
        date: null,
        asap: !fixed,
        draws: grant(item, dates.length - 1).map((d) => ({ ...d, granted: 0 })),
        drawCapped: false,
        fromBuckets: 0,
        fromAvailable: item.amount,
        before: 0,
        after: 0,
        lowest: null,
        status: 'short',
        short: 0,
        card: card ? { card, debtAfter: roundMoney(card.current_balance + item.amount) } : null,
      })
      continue
    }

    const { index, granted, covered, after } = attempt
    const before = plan[index]
    for (let j = 0; j < dates.length; j++) plan[j] = after[j]
    for (const draw of granted) if (draw.granted > 0) draws.push({ date: dates[index], bucketId: draw.bucket.uuid, amount: draw.granted })
    let lowest = { date: dates[index], available: plan[index] }
    for (let j = index; j < dates.length; j++) if (plan[j] < lowest.available) lowest = { date: dates[j], available: plan[j] }
    const drawCapped = granted.some((d) => d.granted < d.requested)
    const status: ItemStatus =
      lowest.available < 0 ? 'short' : drawCapped || (before > 0 && lowest.available < before * TIGHT_SHARE) ? 'tight' : 'fits'
    results.push({
      item,
      date: dates[index],
      asap: !fixed,
      draws: granted,
      drawCapped,
      fromBuckets: covered,
      fromAvailable: roundMoney(item.amount - covered),
      before,
      after: plan[index],
      lowest,
      status,
      short: roundMoney(Math.max(0, -lowest.available)),
      card: card ? { card, debtAfter: roundMoney(card.current_balance + item.amount) } : null,
    })
  }

  const points = dates.map((date, index) => ({ date, income: incomeDays.has(dateToIso(date)), base: baseline[index], available: plan[index] }))
  const lowest = points.reduce((min, point) => (point.available < min.available ? point : min), points[0])
  const last = dates[dates.length - 1]

  return {
    horizon,
    points,
    items: results,
    contributions,
    lowest: { date: lowest.date, available: lowest.available },
    unknownIncome: data.recurring.filter((item) => item.active && item.type === 'income' && item.amount === null).length,
    buckets: buckets.map((bucket) => {
      const start = startBalance.get(bucket.uuid) ?? 0
      const reached =
        bucket.target && bucket.target > 0 && start < bucket.target
          ? (dates.find((date) => bucketOn(bucket.uuid, date) >= bucket.target!) ?? null)
          : null
      return {
        bucket,
        today: start,
        end: bucketOn(bucket.uuid, last),
        contributed: contributedBy(last, bucket.uuid),
        drawn: roundMoney(drawnBy(last, bucket.uuid)),
        reachedOn: reached,
      }
    }),
  }
}
