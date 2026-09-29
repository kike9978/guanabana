import { useEffect, useState } from 'react'
import { initDb } from './seed'

export type DbStatus =
  | { state: 'opening' }
  | { state: 'ready'; categories: number }
  | { state: 'error'; message: string }

export function useLocalDb(): DbStatus {
  const [status, setStatus] = useState<DbStatus>({ state: 'opening' })

  useEffect(() => {
    let active = true
    initDb()
      .then((summary) => {
        if (active) setStatus({ state: 'ready', categories: summary.categories })
      })
      .catch((error: unknown) => {
        if (active) {
          setStatus({ state: 'error', message: error instanceof Error ? error.message : String(error) })
        }
      })
    return () => {
      active = false
    }
  }, [])

  return status
}
