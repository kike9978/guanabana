import { useCallback, useEffect, useState } from 'react'
import { TABS, type AddType, type Route, type SubScreen } from './navigation'

const HOME: Route = { kind: 'tab', tab: 'inicio' }

const SCREEN_SLUG: Record<SubScreen, string> = {
  accounts: 'cuentas',
  commitments: 'pagos-fijos',
  loans: 'prestamos',
  settings: 'ajustes',
}

const ADD_SLUG: Record<AddType, string> = {
  expense: 'gasto',
  income: 'ingreso',
  transfer: 'transferencia',
  cc_payment: 'pago-tdc',
  savings_rule: 'regla-ahorro',
  loan: 'prestamo',
}

function fromSlug<K extends string>(slugs: Record<K, string>, slug: string | undefined): K | undefined {
  return (Object.keys(slugs) as K[]).find((key) => slugs[key] === slug)
}

/** Route paths live under `#/`. Any other fragment (such as a `#s=` share payload) is not a route. */
export function routeToHash(route: Route): string {
  const parts: string[] = [route.kind === 'tab' ? route.tab : route.from]
  if (route.kind !== 'tab' && route.screen) parts.push(SCREEN_SLUG[route.screen])
  if (route.kind === 'add') parts.push(route.editing ? 'editar' : 'agregar', ADD_SLUG[route.type])
  return `#/${parts.join('/')}`
}

/** An edit link can't restore its transaction from the URL alone, so it resolves to the screen it was opened from. */
export function hashToRoute(hash: string): Route | null {
  if (!hash.startsWith('#/')) return null
  const [tabSlug, ...rest] = hash.slice(2).split('/')
  const tab = TABS.find((entry) => entry.id === tabSlug)?.id
  if (!tab) return null

  let screen: SubScreen | undefined
  if (rest.length > 0 && rest[0] !== 'agregar' && rest[0] !== 'editar') {
    screen = fromSlug(SCREEN_SLUG, rest.shift())
    if (!screen) return null
  }
  const parent: Route = screen ? { kind: 'screen', screen, from: tab } : { kind: 'tab', tab }
  if (rest.length === 0) return parent

  const [verb, typeSlug, ...extra] = rest
  const type = fromSlug(ADD_SLUG, typeSlug)
  if (!type || extra.length > 0) return null
  if (verb === 'editar') return parent
  if (verb !== 'agregar') return null
  return { kind: 'add', type, from: tab, screen }
}

interface EntryState {
  idx: number
}

/** Prefill and edited transactions stay in memory so amounts never reach the browser's session history on disk. */
const entries = new Map<number, Route>()

function entryIdx(): number {
  const state = history.state as EntryState | null
  return typeof state?.idx === 'number' ? state.idx : 0
}

function currentRoute(): Route {
  const saved = entries.get(entryIdx())
  if (saved && routeToHash(saved) === location.hash) return saved
  return hashToRoute(location.hash) ?? HOME
}

function isRouteHash(hash: string): boolean {
  return hash === '' || hash === '#' || hash.startsWith('#/')
}

export function useRouter() {
  const [route, setRoute] = useState<Route>(currentRoute)

  useEffect(() => {
    const initial = currentRoute()
    entries.set(entryIdx(), initial)
    if (isRouteHash(location.hash)) history.replaceState({ idx: entryIdx() } satisfies EntryState, '', routeToHash(initial))

    const onPop = () => {
      const next = currentRoute()
      entries.set(entryIdx(), next)
      setRoute(next)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((next: Route, options: { replace?: boolean } = {}) => {
    const url = routeToHash(next)
    const replace = options.replace || url === location.hash
    const idx = entryIdx() + (replace ? 0 : 1)
    if (!replace) {
      for (const key of entries.keys()) if (key >= idx) entries.delete(key)
    }
    entries.set(idx, next)
    if (replace) history.replaceState({ idx } satisfies EntryState, '', url)
    else history.pushState({ idx } satisfies EntryState, '', url)
    setRoute(next)
  }, [])

  /** Steps back through history when the previous entry is the parent, so leaving a form doesn't stack a duplicate. */
  const back = useCallback(
    (parent: Route) => {
      const previous = entries.get(entryIdx() - 1)
      if (previous && routeToHash(previous) === routeToHash(parent)) history.back()
      else navigate(parent, { replace: true })
    },
    [navigate],
  )

  return { route, navigate, back }
}
