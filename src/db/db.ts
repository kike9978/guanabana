import type { BaseRecord } from './types'

export const STORES = [
  'accounts',
  'transactions',
  'transaction_lines',
  'items',
  'places',
  'categories',
  'credit_cards',
  'loans',
  'loan_installments',
  'savings_buckets',
  'bucket_moves',
  'recurring_items',
  'recurring_overrides',
  'budgets',
  'settings',
  'projection_scenarios',
  'plan_items',
  'planned_contributions',
  'ai_jobs',
  'share_events',
] as const

export type StoreName = (typeof STORES)[number]

const DB_NAME = 'guanabana'
const DB_VERSION = 5

let dbPromise: Promise<IDBDatabase> | null = null

export function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: 'uuid' })
          store.createIndex('updated_at', 'updated_at')
        }
      }
    }

    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => db.close()
      resolve(db)
    }

    request.onerror = () => reject(request.error)
  }).catch((error: unknown) => {
    dbPromise = null
    throw error
  })

  return dbPromise
}

export function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export function newRecord<T extends BaseRecord>(fields: Omit<T, keyof BaseRecord>): T {
  return {
    ...fields,
    uuid: crypto.randomUUID(),
    updated_at: new Date().toISOString(),
  } as T
}

export async function getAll<T extends BaseRecord>(store: StoreName): Promise<T[]> {
  const db = await openDb()
  return settle(db.transaction(store).objectStore(store).getAll()) as Promise<T[]>
}

export async function count(store: StoreName): Promise<number> {
  const db = await openDb()
  return settle(db.transaction(store).objectStore(store).count())
}

export async function putMany<T extends BaseRecord>(store: StoreName, records: T[]): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(store, 'readwrite')
  const objectStore = tx.objectStore(store)
  for (const record of records) {
    objectStore.put(record)
  }
  await complete(tx)
  notifyChange(store)
}

export interface StoreWrite {
  store: StoreName
  put?: BaseRecord[]
  delete?: string[]
}

export async function writeAcross(writes: StoreWrite[]): Promise<void> {
  const stores = [...new Set(writes.map((write) => write.store))]
  const db = await openDb()
  const tx = db.transaction(stores, 'readwrite')
  for (const write of writes) {
    const objectStore = tx.objectStore(write.store)
    for (const record of write.put ?? []) objectStore.put(record)
    for (const uuid of write.delete ?? []) objectStore.delete(uuid)
  }
  await complete(tx)
  for (const store of stores) notifyChange(store)
}

const CHANGE_EVENT = 'guanabana:db-change'

export function notifyChange(store: StoreName): void {
  window.dispatchEvent(new CustomEvent<StoreName>(CHANGE_EVENT, { detail: store }))
}

export function onStoreChange(store: StoreName, listener: () => void): () => void {
  const handler = (event: Event) => {
    if ((event as CustomEvent<StoreName>).detail === store) listener()
  }
  window.addEventListener(CHANGE_EVENT, handler)
  return () => window.removeEventListener(CHANGE_EVENT, handler)
}
