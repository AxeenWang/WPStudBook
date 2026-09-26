import { describe, expect, it } from 'vitest'
import { testDatabase } from '../../tests/support/database'

describe('createDatabase', () => {
  it('建立技術設計 4.3 的資料表', async () => {
    const db = testDatabase()
    await db.open()
    expect(db.verno).toBe(1)
    expect(db.tables.map((table) => table.name).sort()).toEqual([
      'breedings',
      'events',
      'games',
      'horses',
      'lines',
      'mareYears',
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

  it('母馬年度資料一匹母馬一年一列（技術設計 4.3），可以依年份查詢', async () => {
    const db = testDatabase()
    await db.mareYears.add({ gameId: 'G', horseId: 'M', year: 1970, plan: 'resting' })
    await expect(db.mareYears.add({ gameId: 'G', horseId: 'M', year: 1970 })).rejects.toThrow()
    await db.mareYears.add({ gameId: 'G', horseId: 'M', year: 1971 })
    expect(await db.mareYears.get(['G', 'M', 1970])).toEqual({
      gameId: 'G',
      horseId: 'M',
      year: 1970,
      plan: 'resting',
    })
    expect(await db.mareYears.where('[gameId+year]').equals(['G', 1971]).count()).toBe(1)
  })
})
