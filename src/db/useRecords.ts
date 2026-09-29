import { useEffect, useState } from 'react'
import { getAll, onStoreChange, type StoreName } from './db'
import type { BaseRecord } from './types'

export function useRecords<T extends BaseRecord>(store: StoreName): T[] | null {
  const [records, setRecords] = useState<T[] | null>(null)

  useEffect(() => {
    let active = true
    const load = () => {
      getAll<T>(store).then((rows) => {
        if (active) setRecords(rows)
      })
    }
    load()
    const unsubscribe = onStoreChange(store, load)
    return () => {
      active = false
      unsubscribe()
    }
  }, [store])

  return records
}
