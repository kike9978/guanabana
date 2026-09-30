import { describe, expect, test } from 'bun:test'
import type { Transaction } from '../db/types'
import type { Route } from './navigation'
import { hashToRoute, routeToHash } from './router'

describe('route hashes', () => {
  const cases: [Route, string][] = [
    [{ kind: 'tab', tab: 'inicio' }, '#/inicio'],
    [{ kind: 'tab', tab: 'proyeccion' }, '#/proyeccion'],
    [{ kind: 'screen', screen: 'commitments', from: 'tiempo' }, '#/tiempo/pagos-fijos'],
    [{ kind: 'add', type: 'expense', from: 'inicio' }, '#/inicio/agregar/gasto'],
    [{ kind: 'add', type: 'cc_payment', from: 'ahorro', screen: 'loans' }, '#/ahorro/prestamos/agregar/pago-tdc'],
  ]

  test.each(cases)('%o round-trips as %s', (route, hash) => {
    expect(routeToHash(route)).toBe(hash)
    expect(hashToRoute(hash)).toEqual(route)
  })

  test('prefill is not written to the URL', () => {
    expect(routeToHash({ kind: 'add', type: 'expense', from: 'inicio', prefill: { amount: 1234, notes: 'renta' } })).toBe(
      '#/inicio/agregar/gasto',
    )
  })

  test('an edit link falls back to the screen it came from', () => {
    const editing = { uuid: 'tx-1', type: 'expense' } as Transaction
    const hash = routeToHash({ kind: 'add', type: 'expense', from: 'movimientos', editing })
    expect(hash).toBe('#/movimientos/editar/gasto')
    expect(hashToRoute(hash)).toEqual({ kind: 'tab', tab: 'movimientos' })
  })

  test('share fragments and unknown paths are not routes', () => {
    expect(hashToRoute('#s=abc')).toBeNull()
    expect(hashToRoute('')).toBeNull()
    expect(hashToRoute('#/nada')).toBeNull()
    expect(hashToRoute('#/inicio/nada')).toBeNull()
    expect(hashToRoute('#/inicio/agregar/nada')).toBeNull()
    expect(hashToRoute('#/inicio/agregar/gasto/extra')).toBeNull()
  })
})
