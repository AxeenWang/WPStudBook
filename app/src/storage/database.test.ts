import { describe, expect, it } from 'vitest'
import { testDatabase } from '../../tests/support/database'

describe('createDatabase', () => {
  it('建立技術設計 4.3 的資料表', async () => {
    const db = testDatabase()
    await db.open()
    expect(db.verno).toBe(1)
    expect(db.tables.map((table) => table.name).sort()).toEqual([
      'breedings',
      'checkpointContents',
      'checkpoints',
      'events',
      'games',
      'horseNumbers',
      'horses',
      'lines',
      'mareYears',
      'mares',
      'matingRatings',
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

  it('總合評價與爆發力可以依母馬查詢（技術設計 4.3）', async () => {
    const db = testDatabase()
    await db.matingRatings.bulkAdd([
      { id: 'R1', gameId: 'G', mareId: 'M', sireId: 'S', year: 1970, grade: 'A' },
      { id: 'R2', gameId: 'G', mareId: 'M', sireName: 'ノーザンダンサー', year: 1971, burst: 12 },
      { id: 'R3', gameId: 'G', mareId: 'N', sireId: 'S', year: 1970, grade: 'B' },
    ])
    const rows = await db.matingRatings.where('[gameId+mareId]').equals(['G', 'M']).toArray()
    expect(rows.map((row) => row.id).sort()).toEqual(['R1', 'R2'])
  })

  it('階段馬番号可以依馬匹查詢（技術設計 4.3）', async () => {
    const db = testDatabase()
    const row = { gameId: 'G', year: 1970, source: { kind: 'manual' as const } }
    await db.horseNumbers.bulkAdd([
      { ...row, id: 'N1', horseId: 'M', stage: 'foal', number: '0x0001' },
      { ...row, id: 'N2', horseId: 'M', stage: 'broodmare', number: '0x0002' },
      { ...row, id: 'N3', horseId: 'S', stage: 'stallion', number: '0x0003' },
    ])
    const rows = await db.horseNumbers.where('[gameId+horseId]').equals(['G', 'M']).toArray()
    expect(rows.map((entry) => entry.id).sort()).toEqual(['N1', 'N2'])
  })
})
