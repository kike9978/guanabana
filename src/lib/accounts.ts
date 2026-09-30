import type { Account } from '../db/types'

/** Savings and investment accounts sit outside Disponible real. Everything else is liquid. */
export function isLiquid(account: Pick<Account, 'type'>): boolean {
  return account.type !== 'savings'
}
