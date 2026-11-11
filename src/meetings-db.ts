import type { Meeting } from './meetings'

const DB_NAME = 'suflyor'
const STORE = 'meetings'

/** Used when IndexedDB is missing or blocked. Lives for this page session only. */
const memory = new Map<string, Meeting>()
let useMemory = false
let dbPromise: Promise<IDBDatabase | null> | null = null
const listeners = new Set<() => void>()

/** Test helper: forget the session state. */
export function resetMeetingsDb(): void {
  memory.clear()
  useMemory = false
  breaking = null
  dbPromise = null
  listeners.clear()
}

export function onMeetingsChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function emit(): void {
  for (const cb of [...listeners]) {
    try {
      cb()
    } catch {
      /* a broken listener must not break the others */
    }
  }
}

const OPEN_TIMEOUT_MS = 3000
/** Set once IndexedDB has failed: every later operation of this session uses memory. */
let breaking: Promise<void> | null = null

/** Switch to memory for good. Meetings still readable in the old database are copied over first. */
function breakDb(db: IDBDatabase | null): Promise<void> {
  if (useMemory) return breaking ?? Promise.resolve()
  useMemory = true
  breaking = (async () => {
    if (!db) return
    try {
      const all = await new Promise<Meeting[]>((resolve, reject) => {
        const timer = setTimeout(reject, 1000)
        const tx = db.transaction(STORE, 'readonly')
        const rq = tx.objectStore(STORE).getAll() as IDBRequest<Meeting[]>
        rq.onsuccess = () => {
          clearTimeout(timer)
          resolve(rq.result)
        }
        tx.onerror = tx.onabort = () => {
          clearTimeout(timer)
          reject(new Error('read failed'))
        }
      })
      for (const m of all) if (!memory.has(m.id)) memory.set(m.id, m)
    } catch {
      /* nothing readable: memory starts empty */
    } finally {
      try {
        db.close()
      } catch {
        /* already closed */
      }
    }
  })()
  return breaking
}

function openDb(): Promise<IDBDatabase | null> {
  if (useMemory) return Promise.resolve(null)
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    let settled = false
    const done = (db: IDBDatabase | null): void => {
      if (settled) {
        // A late success after the timeout: the page already works from memory.
        try {
          db?.close()
        } catch {
          /* ignore */
        }
        return
      }
      settled = true
      clearTimeout(timer)
      resolve(db)
    }
    const timer = setTimeout(() => done(null), OPEN_TIMEOUT_MS)
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) return done(null)
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'id' })
        }
      }
      req.onsuccess = () => done(req.result)
      req.onerror = () => done(null)
      req.onblocked = () => done(null)
    } catch {
      done(null)
    }
  }).then(async (db) => {
    if (!db) await breakDb(null)
    return db
  })
  return dbPromise
}

/** Run one request against the store. A failure switches the session to memory. */
async function run<T>(
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<{ ok: true; value: T } | { ok: false }> {
  const db = await openDb()
  if (!db || useMemory) {
    await breaking
    return { ok: false }
  }
  const r = await new Promise<{ ok: true; value: T } | { ok: false }>((resolve) => {
    try {
      const tx = db.transaction(STORE, mode)
      const req = op(tx.objectStore(STORE))
      let value: T
      req.onsuccess = () => {
        value = req.result
      }
      tx.oncomplete = () => resolve({ ok: true, value })
      tx.onerror = tx.onabort = () => resolve({ ok: false })
    } catch {
      resolve({ ok: false })
    }
  })
  if (!r.ok) await breakDb(db)
  return r
}

const newestFirst = (a: Meeting, b: Meeting): number => b.startedAt - a.startedAt

export async function listMeetings(): Promise<Meeting[]> {
  const r = await run('readonly', (s) => s.getAll() as IDBRequest<Meeting[]>)
  if (r.ok) return [...r.value].sort(newestFirst)
  return [...memory.values()].sort(newestFirst)
}

export async function getMeeting(id: string): Promise<Meeting | null> {
  const r = await run('readonly', (s) => s.get(id) as IDBRequest<Meeting | undefined>)
  if (r.ok) return r.value ?? null
  return memory.get(id) ?? null
}

export async function putMeeting(m: Meeting): Promise<void> {
  const r = await run('readwrite', (s) => s.put(m))
  if (!r.ok) memory.set(m.id, m)
  emit()
}

export async function deleteMeeting(id: string): Promise<void> {
  const r = await run('readwrite', (s) => s.delete(id))
  if (!r.ok) memory.delete(id)
  emit()
}

/**
 * Read, change and write one meeting in a single step, so two updates never overwrite each other.
 * Returns the stored meeting, or null (and writes nothing) when it does not exist.
 */
export async function updateMeeting(id: string, fn: (m: Meeting) => Meeting): Promise<Meeting | null> {
  const db = await openDb()
  if (db && !useMemory) {
    type R = { ok: true; value: Meeting | null } | { ok: false; error?: unknown }
    const r = await new Promise<R>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite')
        const store = tx.objectStore(STORE)
        let result: Meeting | null = null
        let thrown: { error: unknown } | null = null
        const g = store.get(id) as IDBRequest<Meeting | undefined>
        g.onsuccess = () => {
          const cur = g.result
          if (!cur) return
          try {
            result = fn(cur)
          } catch (error) {
            thrown = { error }
            tx.abort()
            return
          }
          store.put(result)
        }
        tx.oncomplete = () => resolve({ ok: true, value: result })
        tx.onerror = tx.onabort = () => resolve(thrown ? { ok: false, error: thrown.error } : { ok: false })
      } catch {
        resolve({ ok: false })
      }
    })
    if (r.ok) {
      if (r.value) emit()
      return r.value
    }
    if ('error' in r) throw r.error
    await breakDb(db)
  }
  await breaking
  const cur = memory.get(id)
  if (!cur) return null
  const next = fn(cur)
  memory.set(id, next)
  emit()
  return next
}

export async function setActionDone(meetingId: string, actionId: string, done: boolean): Promise<void> {
  await updateMeeting(meetingId, (m) =>
    m.actions.some((a) => a.id === actionId) ? { ...m, actions: m.actions.map((a) => (a.id === actionId ? { ...a, done } : a)) } : m,
  )
}
