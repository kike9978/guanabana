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
] as const

export type AddType = (typeof ADD_TYPES)[number]['id']

export const MOVEMENT_VIEWS = [
  { id: 'list', label: 'Lista' },
  { id: 'stats', label: 'Estadísticas' },
  { id: 'prices', label: 'Precios' },
] as const

export type MovementView = (typeof MOVEMENT_VIEWS)[number]['id']

export type Route =
  | { kind: 'tab'; tab: TabId }
  | { kind: 'add'; type: AddType; from: TabId }
  | { kind: 'accounts'; from: TabId }

export function tabLabel(id: TabId): string {
  return TABS.find((tab) => tab.id === id)?.label ?? id
}

export function addLabel(id: AddType): string {
  return ADD_TYPES.find((type) => type.id === id)?.label ?? id
}
