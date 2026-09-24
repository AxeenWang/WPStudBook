import { describe, expect, it } from 'vitest'
import { testDatabase } from '../../tests/support/database'

describe('createDatabase', () => {
  it('建立技術設計 4.3 的資料表', async () => {
    const db = testDatabase()
    await db.open()
    expect(db.verno).toBe(1)
    expect(db.tables.map((table) => table.name).sort()).toEqual([
      'breedings',
      'games',
      'horses',
      'lines',
      'mares',
      'meta',
      'restorations',
      'settings',
      'stallions',
      'systems',
    ])
  })

  it('同一匹母馬同一年的配種紀錄只能有一筆（需求規格 9.1）', async () => {
    const db = testDatabase()
    await db.breedings.add({ id: 'B1', gameId: 'G', mareId: 'M', year: 1970, kind: 'free' })
    await expect(
      db.breedings.add({ id: 'B2', gameId: 'G', mareId: 'M', year: 1970, kind: 'free' }),
    ).rejects.toThrow()
    await db.breedings.add({ id: 'B3', gameId: 'G', mareId: 'M', year: 1971, kind: 'free' })
    expect(await db.breedings.count()).toBe(2)
  })
})
