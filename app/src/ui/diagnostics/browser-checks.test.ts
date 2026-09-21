import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { probeIndexedDb } from './browser-checks'

describe('probeIndexedDb', () => {
  it('第一次沒有先前資料，第二次讀到第一次寫入的值', async () => {
    const first = await probeIndexedDb(new Date('2026-01-01T00:00:00Z'))
    expect(first.previous).toBeNull()
    expect(first.written.savedAt).toBe('2026-01-01T00:00:00.000Z')

    const second = await probeIndexedDb(new Date('2026-01-02T00:00:00Z'))
    expect(second.previous).toEqual(first.written)
    expect(second.written.value).not.toBe(first.written.value)
  })
})
