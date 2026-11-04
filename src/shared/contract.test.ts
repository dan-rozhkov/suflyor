import { describe, expect, it } from 'vitest'
import { IPC } from './ipc'

describe('ipc channels', () => {
  it('has unique channel names', () => {
    const v = Object.values(IPC)
    expect(new Set(v).size).toBe(v.length)
  })
})
