import { useEffect, useRef } from 'react'

const NARROW = '(max-width: 899px)'

/** Focus a selection dossier on a phone and close it with Escape. */
export function useDossierSheet(openKey: string | null, onClose: () => void) {
  const ref = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!openKey) return
    if (!window.matchMedia(NARROW).matches) return
    ref.current?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openKey])

  return ref
}

/** Bring a form that opened from a row into the stage on a phone. */
export function useScrollIntoView(key: string | null) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!key) return
    if (!window.matchMedia(NARROW).matches) return
    ref.current?.scrollIntoView({ block: 'start' })
  }, [key])

  return ref
}
