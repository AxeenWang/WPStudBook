import { describe, expect, it } from 'vitest'
import { addTestGame, testDatabase } from '../../tests/support/database'
import { GAME, horseRow } from '../../tests/support/rows'
import type { WPStudBookDatabase } from './database'
import { loadGame } from './games'
import { importHorseNumber, recordHorseNumber } from './horse-numbers'
import type { HorseStage } from './records'
import { runWrite, type WriteOptions } from './writes'

/** 測試用：在寫入交易內記一筆階段馬番号 */
async function record(
  db: WPStudBookDatabase,
  horseId: string,
  stage: HorseStage,
  number: string,
  options: WriteOptions = {},
) {
  const result = await runWrite(db, GAME, [db.horseNumbers], options, async (context) =>
    context.done(await recordHorseNumber(context, horseId, stage, number)),
  )
  if (result.status !== 'done') throw new Error(result.status)
  return result.value
}

describe('recordHorseNumber', () => {
  it('記馬匹、階段、馬番号、目前遊戲年與來源；手動沒有時點時不記時點', async () => {
    const db = testDatabase()
    await addTestGame(db)
    const row = await record(db, 'S', 'stallion', '0x01A2')
    expect(row).toStrictEqual({
      id: expect.any(String),
      gameId: GAME,
      horseId: 'S',
      stage: 'stallion',
      number: '0x01A2',
      year: 1990,
      source: { kind: 'manual' },
    })
    expect(await db.horseNumbers.toArray()).toStrictEqual([row])
  })

  it('匯入時記匯入的來源與時點', async () => {
    const db = testDatabase()
    await addTestGame(db)
    const source = { kind: 'import' as const, importType: 'may-herd' as const, importId: 'I1' }
    const row = await record(db, 'M', 'broodmare', '0x0000', {
      source,
      timing: { month: 5, week: 1 },
    })
    expect(row).toMatchObject({ source, timing: { month: 5, week: 1 }, number: '0x0000' })
  })

  it('同一匹馬同一階段已有相同馬番号時不再記（MAY-06）；別的階段或別的馬番号照記', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await addTestGame(db, { id: 'G2' })
    await db.horseNumbers.add({
      id: 'N0',
      gameId: 'G2',
      horseId: 'M',
      stage: 'broodmare',
      number: '0x0100',
      year: 1989,
      source: { kind: 'manual' },
    })
    expect(await record(db, 'M', 'broodmare', '0x0100')).toBeDefined()
    expect(await record(db, 'M', 'broodmare', '0x0100')).toBeUndefined()
    expect(await record(db, 'M', 'foal', '0x0100')).toBeDefined()
    expect(await record(db, 'M', 'broodmare', '0x0200')).toBeDefined()
    expect(await record(db, 'N', 'broodmare', '0x0100')).toBeDefined()
    const rows = await db.horseNumbers.where('[gameId+horseId]').equals([GAME, 'M']).toArray()
    expect(rows.map((row) => `${row.stage}:${row.number}`).sort()).toEqual([
      'broodmare:0x0100',
      'broodmare:0x0200',
      'foal:0x0100',
    ])
  })

  it('馬番号沒有統一寫法時丟出 RangeError，什麼都不寫', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await expect(record(db, 'S', 'stallion', '0x1a2')).rejects.toThrow('馬番号沒有統一寫法：0x1a2')
    await expect(record(db, 'S', 'stallion', 'ABC')).rejects.toThrow(RangeError)
    expect(await db.horseNumbers.count()).toBe(0)
  })
})

describe('importHorseNumber', () => {
  const source = { kind: 'import', importType: 'may-herd', importId: 'I1' } as const
  const timing = { month: 5, week: 1 }
  const now = new Date('2026-10-08T01:02:03.000Z')

  it('記一筆階段馬番号，來源與時點照 WriteOptions，遊戲局的更新時間跟著更新；已記過相同的時阻止，什麼都不寫', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.horses.add(horseRow('M'))
    const result = await importHorseNumber(db, GAME, 'M', 'broodmare', '0x1C01', {
      now,
      source,
      timing,
    })
    const row = {
      id: expect.any(String),
      gameId: GAME,
      horseId: 'M',
      stage: 'broodmare',
      number: '0x1C01',
      year: 1990,
      source,
      timing,
    }
    expect(result).toStrictEqual({ status: 'done', value: row, warnings: [] })
    expect(await db.horseNumbers.toArray()).toStrictEqual([row])
    expect(await db.events.count()).toBe(0)
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-10-08T01:02:03.000Z')

    const later = new Date('2026-10-09T00:00:00.000Z')
    expect(
      await importHorseNumber(db, GAME, 'M', 'broodmare', '0x1C01', { now: later, source }),
    ).toStrictEqual({ status: 'blocked', blocks: [{ kind: 'unchanged' }] })
    expect(await db.horseNumbers.count()).toBe(1)
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-10-08T01:02:03.000Z')
  })

  it('馬匹找不到或屬於其他局時丟出錯誤', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await addTestGame(db, { id: 'G2' })
    await db.horses.add(horseRow('X', { gameId: 'G2' }))
    await expect(importHorseNumber(db, GAME, 'Q', 'broodmare', '0x0001')).rejects.toThrow(
      '找不到馬匹：Q',
    )
    await expect(importHorseNumber(db, GAME, 'X', 'broodmare', '0x0001')).rejects.toThrow(
      '找不到馬匹：X',
    )
    expect(await db.horseNumbers.count()).toBe(0)
  })
})
