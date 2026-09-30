import type { Account, CreditCard, Transaction } from '../db/types'
import type { MoneyData } from '../db/useMoneyData'
import { incomeCycle, loanCommitments } from './cycle'
import { dateToIso, daysBetween, isoToDate } from './dates'
import { isSpending } from './ledger'
import { roundMoney } from './money'
import { msiUnbilled } from './msi'
import { moneySnapshot } from './snapshot'
import { timeline } from './timeline'

export const PROJECTION_HORIZON_DAYS = 90
export const PROJECTION_ACCOUNT_ID = 'projection'

export const INCOME_SCENARIOS = [
  { id: 'conservative', grade: 'Escenario 1', title: 'Conservador', factor: 0.9 },
  { id: 'base', grade: 'Escenario 2', title: 'Base', factor: 1 },
  { id: 'optimistic', grade: 'Escenario 3', title: 'Optimista', factor: 1.1 },
] as const

export type IncomeScenarioId = (typeof INCOME_SCENARIOS)[number]['id']

function noon(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12)
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12)
}

function scaleIncome(data: MoneyData, factor: number): MoneyData {
  if (factor === 1) return data
  const income = new Set(data.recurring.filter((item) => item.type === 'income').map((item) => item.uuid))
  return {
    ...data,
    recurring: data.recurring.map((item) =>
      item.type === 'income' && item.amount !== null ? { ...item, amount: roundMoney(item.amount * factor) } : item,
    ),
    overrides: data.overrides.map((row) => (income.has(row.recurring_id) ? { ...row, amount: roundMoney(row.amount * factor) } : row)),
  }
}

/**
 * The data as it would look at the end of `until` if every scheduled event up to then happened:
 * expected income arrives, and unpaid bills and loan installments are paid from liquid money.
 * Lent money, card spending, and unscheduled income are not assumed.
 */
export interface ProjectionAssumptions {
  incomeFactor?: number
  extraExpenses?: number
  dailySpend?: number
}

export const HABIT_WINDOW_DAYS = 60
const HABIT_MIN_DAYS = 7

export function habitualDailySpend(transactions: Transaction[], today: Date): { perDay: number; days: number } {
  const end = dateToIso(today)
  const start = dateToIso(addDays(today, -HABIT_WINDOW_DAYS + 1))
  const first = transactions.reduce((min, tx) => (tx.date < min ? tx.date : min), end)
  const days = Math.min(HABIT_WINDOW_DAYS, Math.max(HABIT_MIN_DAYS, daysBetween(isoToDate(first), today) + 1))
  const total = transactions
    .filter((tx) => isSpending(tx) && !tx.recurring_id && !tx.loan_installment_id && tx.date >= start && tx.date <= end)
    .reduce((sum, tx) => sum + tx.amount, 0)
  return { perDay: roundMoney(Math.max(0, total) / days), days }
}

export function projectedData(data: MoneyData, today: Date, until: Date, assumptions: ProjectionAssumptions = {}): MoneyData {
  const { incomeFactor = 1, extraExpenses = 0, dailySpend = 0 } = assumptions
  const scaled = scaleIncome(data, incomeFactor)
  const cycle = incomeCycle(data.recurring, today)
  const end = addDays(until, 1)
  const bills = timeline(scaled, cycle.start, end).filter((e) => e.kind === 'bill' && !e.paid && (e.amount ?? 0) > 0)
  const incomes = timeline(scaled, addDays(today, 1), end).filter((e) => e.kind === 'income' && !e.paid && (e.amount ?? 0) > 0)
  const installments = loanCommitments(data.loans, data.installments, data.transactions, end, today)

  let delta = -extraExpenses - dailySpend * Math.max(0, daysBetween(today, until))
  const settled: Transaction[] = []
  for (const event of [...bills, ...incomes]) {
    const amount = event.amount ?? 0
    delta += event.kind === 'income' ? amount : -amount
    settled.push({
      uuid: `projected-${event.key}`,
      type: event.kind === 'income' ? 'income' : 'expense',
      date: dateToIso(event.date),
      amount,
      recurring_id: event.action?.prefill.recurring_id ?? null,
      occurrence: event.action?.prefill.occurrence ?? null,
    } as Transaction)
  }
  for (const row of installments) {
    delta -= row.amount
    settled.push({ uuid: `projected-${row.key}`, type: 'expense', date: dateToIso(row.date), amount: row.amount, loan_installment_id: row.installmentId } as Transaction)
  }

  const projection: Account = {
    uuid: PROJECTION_ACCOUNT_ID,
    updated_at: '',
    name: 'Proyección',
    type: 'checking',
    currency: 'MXN',
    current_balance: roundMoney(delta),
    balance_date: dateToIso(until),
  }
  return { ...scaled, accounts: [...data.accounts, projection], transactions: [...data.transactions, ...settled] }
}

export function projectedAvailable(data: MoneyData, today: Date, on: Date, assumptions: ProjectionAssumptions = {}): number {
  return moneySnapshot(projectedData(data, today, on, assumptions), noon(on) < noon(today) ? today : noon(on)).breakdown.total
}

export function dailyProjection(data: MoneyData, today: Date, from: Date, to: Date, assumptions: ProjectionAssumptions = {}): Map<string, number> {
  const series = new Map<string, number>()
  const start = noon(from) < noon(today) ? noon(today) : noon(from)
  for (let day = start; day < noon(to); day = addDays(day, 1)) {
    series.set(dateToIso(day), roundMoney(projectedAvailable(data, today, day, assumptions)))
  }
  return series
}

export interface PurchaseInput extends ProjectionAssumptions {
  amount: number
  date: string
  cardId: string | null
  msiMonths?: number | null
}

export interface Checkpoint {
  date: Date
  available: number
}

export interface PurchaseResult {
  date: Date
  before: number
  after: number
  lowest: Checkpoint
  checkpoints: Checkpoint[]
  unknownIncome: number
  card: { card: CreditCard; debtAfter: number; nextPaymentRise: number } | null
}

export function projectPurchase(data: MoneyData, today: Date, input: PurchaseInput): PurchaseResult {
  const on = noon(isoToDate(input.date) < noon(today) ? today : isoToDate(input.date))
  const horizon = addDays(on, PROJECTION_HORIZON_DAYS)
  const incomeDates = timeline(data, addDays(on, 1), horizon)
    .filter((e) => e.kind === 'income')
    .map((e) => e.date)
  const dates = [on, ...incomeDates, horizon].filter((date, index, all) => all.findIndex((d) => d.getTime() === date.getTime()) === index)
  const card = data.cards.find((c) => c.uuid === input.cardId)
  const msi = card && (input.msiMonths ?? 0) > 1 ? { date: dateToIso(on), amount: input.amount, months: input.msiMonths! } : null
  const cost = (date: Date) => (msi && card ? roundMoney(input.amount - msiUnbilled(msi, card.statement_day, date)) : input.amount)
  const checkpoints = dates.map((date) => ({
    date,
    available: roundMoney(projectedAvailable(data, today, date, input) - cost(date)),
  }))
  const before = roundMoney(checkpoints[0].available + cost(on))
  const lowest = checkpoints.reduce((min, point) => (point.available < min.available ? point : min))
  return {
    date: on,
    before,
    after: checkpoints[0].available,
    lowest,
    checkpoints,
    unknownIncome: data.recurring.filter((item) => item.active && item.type === 'income' && item.amount === null).length,
    card: card ? { card, debtAfter: roundMoney(card.current_balance + input.amount), nextPaymentRise: cost(on) } : null,
  }
}
