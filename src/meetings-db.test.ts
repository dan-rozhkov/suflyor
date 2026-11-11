import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Meeting } from './meetings'
import { deleteMeeting, getMeeting, listMeetings, onMeetingsChange, putMeeting, resetMeetingsDb, setActionDone, updateMeeting } from './meetings-db'

const mk = (id: string, startedAt: number): Meeting => ({
  id, startedAt, durationMs: 1000, callLanguage: 'en', language: 'en', title: id, notes: '',
  lines: [], chapters: [], summaryState: { status: 'none' },
  actions: [{ id: `${id}-a0`, task: 'Do it', owner: '', done: false }], overview: [], topics: [],
})

describe('meetings-db without IndexedDB', () => {
  beforeEach(() => resetMeetingsDb())

  it('has no indexedDB in node', () => {
    expect(typeof indexedDB).toBe('undefined')
  })
  it('stores in memory, newest first', async () => {
    await putMeeting(mk('a', 1))
    await putMeeting(mk('b', 2))
    expect((await listMeetings()).map((m) => m.id)).toEqual(['b', 'a'])
    expect((await getMeeting('a'))?.id).toBe('a')
    expect(await getMeeting('zzz')).toBeNull()
  })
  it('overwrites and deletes', async () => {
    await putMeeting(mk('a', 1))
    await putMeeting({ ...mk('a', 1), title: 'New' })
    expect((await listMeetings())).toHaveLength(1)
    expect((await getMeeting('a'))?.title).toBe('New')
    await deleteMeeting('a')
    expect(await listMeetings()).toEqual([])
  })
  it('toggles an action and ignores unknown ids', async () => {
    await putMeeting(mk('a', 1))
    await setActionDone('a', 'a-a0', true)
    expect((await getMeeting('a'))?.actions[0].done).toBe(true)
    await setActionDone('a', 'nope', true)
    await setActionDone('missing', 'x', true)
    expect(await listMeetings()).toHaveLength(1)
  })
  it('fires change events and supports unsubscribe', async () => {
    const cb = vi.fn()
    const off = onMeetingsChange(cb)
    await putMeeting(mk('a', 1))
    await setActionDone('a', 'a-a0', true)
    await deleteMeeting('a')
    expect(cb).toHaveBeenCalledTimes(3)
    off()
    await putMeeting(mk('b', 2))
    expect(cb).toHaveBeenCalledTimes(3)
  })
})

describe('updateMeeting on memory', () => {
  beforeEach(() => resetMeetingsDb())

  it('changes one meeting and returns it', async () => {
    await putMeeting(mk('a', 1))
    const r = await updateMeeting('a', (m) => ({ ...m, title: 'New' }))
    expect(r?.title).toBe('New')
    expect((await getMeeting('a'))?.title).toBe('New')
  })
  it('writes nothing for a missing meeting', async () => {
    const fn = vi.fn((m: Meeting) => m)
    expect(await updateMeeting('zzz', fn)).toBeNull()
    expect(fn).not.toHaveBeenCalled()
    expect(await listMeetings()).toEqual([])
  })
  it('does not bring back a deleted meeting', async () => {
    await putMeeting(mk('a', 1))
    await deleteMeeting('a')
    expect(await updateMeeting('a', (m) => ({ ...m, title: 'X' }))).toBeNull()
    expect(await getMeeting('a')).toBeNull()
  })
  it('keeps two parallel updates', async () => {
    await putMeeting(mk('a', 1))
    await Promise.all([
      updateMeeting('a', (m) => ({ ...m, title: 'T' })),
      updateMeeting('a', (m) => ({ ...m, notes: 'N' })),
    ])
    const m = await getMeeting('a')
    expect([m?.title, m?.notes]).toEqual(['T', 'N'])
  })
  it('tells the listeners', async () => {
    await putMeeting(mk('a', 1))
    const cb = vi.fn()
    onMeetingsChange(cb)
    await updateMeeting('a', (m) => m)
    expect(cb).toHaveBeenCalledTimes(1)
  })
})

describe('sticky memory fallback', () => {
  beforeEach(() => {
    resetMeetingsDb()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('falls back to memory when indexedDB.open hangs, and stays there', async () => {
    vi.stubGlobal('indexedDB', { open: () => ({}) })
    const p = putMeeting(mk('a', 1))
    await vi.advanceTimersByTimeAsync(3100)
    await p
    expect((await getMeeting('a'))?.id).toBe('a')
    expect((await listMeetings()).map((m) => m.id)).toEqual(['a'])
  })
})
