import type { Transaction } from '../db/types'

export const TABS = [
  { id: 'inicio', label: 'Inicio' },
  { id: 'tiempo', label: 'Tiempo' },
  { id: 'movimientos', label: 'Movimientos' },
  { id: 'ahorro', label: 'Ahorro' },
  { id: 'proyeccion', label: 'Proyección' },
] as const

export type TabId = (typeof TABS)[number]['id']

export const ADD_TYPES = [
  { id: 'expense', label: 'Gasto', key: 'G' },
  { id: 'income', label: 'Ingreso', key: 'I' },
  { id: 'transfer', label: 'Transferencia', key: 'T' },
  { id: 'cc_payment', label: 'Pago TDC', key: 'P' },
  { id: 'savings_rule', label: 'Regla de ahorro', key: 'R' },
  { id: 'loan', label: 'Préstamo', key: 'L' },
] as const

export type AddType = (typeof ADD_TYPES)[number]['id']

export const MOVEMENT_VIEWS = [
  { id: 'list', label: 'Lista' },
  { id: 'stats', label: 'Estadísticas' },
  { id: 'prices', label: 'Precios' },
] as const

export type MovementView = (typeof MOVEMENT_VIEWS)[number]['id']

export const PROJECTION_VIEWS = [
  { id: 'buy', label: '¿Puedo comprarlo?' },
  { id: 'plan', label: 'Plan' },
  { id: 'budget', label: 'Presupuesto' },
] as const

export type ProjectionView = (typeof PROJECTION_VIEWS)[number]['id']

export interface AddPrefill {
  amount?: number
  category_id?: string | null
  category_key?: string
  account_id?: string | null
  to_account_id?: string | null
  cc_id?: string | null
  notes?: string
  date?: string
  recurring_id?: string
  occurrence?: string
  loan_installment_id?: string
  income_tx_id?: string
  rule?: 'first' | 'second'
}

export type SubScreen = 'accounts' | 'commitments' | 'loans' | 'settings'

export const SUB_SCREEN_LABEL: Record<SubScreen, string> = {
  accounts: 'Cuentas',
  commitments: 'Pagos fijos',
  loans: 'Préstamos',
  settings: 'Ajustes',
}

export type Route =
  | { kind: 'tab'; tab: TabId }
  | { kind: 'add'; type: AddType; from: TabId; prefill?: AddPrefill; screen?: SubScreen; editing?: Transaction }
  | { kind: 'screen'; screen: SubScreen; from: TabId }

export type EditableTransaction = Transaction & { type: Exclude<Transaction['type'], 'adjustment'> }

export function isEditable(tx: Transaction): tx is EditableTransaction {
  return tx.type !== 'adjustment' && !tx.loan_extra_id && !tx.bucket_id
}

export function prefillFrom(tx: Transaction): AddPrefill {
  return {
    amount: tx.amount,
    date: tx.date,
    account_id: tx.account_id,
    to_account_id: tx.to_account_id,
    cc_id: tx.cc_id,
    category_id: tx.category_id,
    notes: tx.notes,
    recurring_id: tx.recurring_id ?? undefined,
    occurrence: tx.occurrence ?? undefined,
    loan_installment_id: tx.loan_installment_id ?? undefined,
  }
}

export function tabLabel(id: TabId): string {
  return TABS.find((tab) => tab.id === id)?.label ?? id
}

export function addLabel(id: AddType): string {
  return ADD_TYPES.find((type) => type.id === id)?.label ?? id
}
