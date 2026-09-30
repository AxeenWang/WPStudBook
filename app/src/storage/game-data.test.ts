import { describe, expect, it } from 'vitest'
import { testDatabase } from '../../tests/support/database'
import { addSampleGame } from '../../tests/support/game-data'
import { GAME } from '../../tests/support/rows'
import {
  GAME_TABLES,
  addGameData,
  countGameRows,
  countRows,
  deleteGameData,
  readGameData,
  remapIds,
  totalRows,
  type GameData,
} from './game-data'
import type { EventRow } from './records'

/** addSampleGame 一局的總筆數：horses 3 列，其他每張表 1 列 */
const SAMPLE_TOTAL = 15

/**
 * 不屬於一局資料的表（技術設計 4.3「整局資料」）：全域的 meta；
 * 檢查點的兩張表不進備份，回溯清掉整局資料時要留下，刪除一局時另外刪
 */
const EXCLUDED_TABLES = ['meta', 'checkpoints', 'checkpointContents', 'archives']

describe('GAME_TABLES', () => {
  it('每一張資料表不是在 GAME_TABLES，就是明示排除', () => {
    const names = testDatabase().tables.map((table) => table.name)
    expect([...GAME_TABLES, ...EXCLUDED_TABLES].sort()).toEqual(names.sort())
  })
})

describe('readGameData', () => {
  it('只讀這一局：每張表一個陣列，順序照 GAME_TABLES', async () => {
    const db = testDatabase()
    const expected = await addSampleGame(db)
    await addSampleGame(db, { id: 'G2' })
    const data = await readGameData(db, GAME)
    expect(Object.keys(data)).toEqual([...GAME_TABLES])
    expect(data).toStrictEqual(expected)
  })

  it('遊戲局不存在時丟出錯誤', async () => {
    await expect(readGameData(testDatabase(), 'missing')).rejects.toThrow('找不到遊戲局：missing')
  })
})

describe('remapIds', () => {
  /** 樣本資料再加一筆事件，引用已經刪除的任用 */
  async function sampleData(): Promise<{ data: GameData; dangling: EventRow }> {
    const data = await addSampleGame(testDatabase())
    const dangling: EventRow = {
      id: 'G-E2',
      gameId: GAME,
      year: 1990,
      recordedAt: '2026-09-24T00:00:00.000Z',
      source: { kind: 'manual' },
      kind: 'successor-cancelled',
      line: 1,
      horseId: 'G-S',
      stallionId: 'G-gone',
      generation: 1,
    }
    return { data: { ...data, events: [...data.events, dangling] }, dangling }
  }

  it('每個識別換成新的，引用跟著換（含事件內容）；懸空的引用保持原值', async () => {
    const { data, dangling } = await sampleData()
    const mapped = remapIds(data, (old) => `new-${old}`)
    const [foal, mare, stallion] = data.horses
    expect(mapped.games).toStrictEqual([{ ...data.games[0]!, id: 'new-G' }])
    expect(mapped.settings).toStrictEqual([{ ...data.settings[0]!, gameId: 'new-G' }])
    expect(mapped.horses).toStrictEqual([
      {
        ...foal!,
        id: 'new-G-F',
        gameId: 'new-G',
        sireId: 'new-G-S',
        damId: 'new-G-M',
        birth: { breedingId: 'new-G-B' },
      },
      { ...mare!, id: 'new-G-M', gameId: 'new-G' },
      { ...stallion!, id: 'new-G-S', gameId: 'new-G' },
    ])
    expect(mapped.mares).toStrictEqual([{ ...data.mares[0]!, horseId: 'new-G-M', gameId: 'new-G' }])
    expect(mapped.mareYears).toStrictEqual([
      { ...data.mareYears[0]!, horseId: 'new-G-M', gameId: 'new-G' },
    ])
    expect(mapped.stallions).toStrictEqual([
      { ...data.stallions[0]!, id: 'new-G-P', gameId: 'new-G', horseId: 'new-G-S' },
    ])
    expect(mapped.breedings).toStrictEqual([
      {
        ...data.breedings[0]!,
        id: 'new-G-B',
        gameId: 'new-G',
        mareId: 'new-G-M',
        sireId: 'new-G-S',
      },
    ])
    expect(mapped.events).toStrictEqual([
      {
        ...data.events[0]!,
        id: 'new-G-E',
        gameId: 'new-G',
        horseId: 'new-G-F',
        breedingId: 'new-G-B',
      },
      { ...dangling, id: 'new-G-E2', gameId: 'new-G', horseId: 'new-G-S' },
    ])
    expect(mapped.lines).toStrictEqual([{ ...data.lines[0]!, gameId: 'new-G' }])
    expect(mapped.horseNumbers[0]).toMatchObject({ id: 'new-G-N', horseId: 'new-G-M' })
  })

  it('預設產生新的 UUID；不改傳入的資料', async () => {
    const { data } = await sampleData()
    const before = structuredClone(data)
    const mapped = remapIds(data)
    expect(mapped.games[0]!.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
    expect(mapped.settings[0]!.gameId).toBe(mapped.games[0]!.id)
    expect(new Set(mapped.horses.map((horse) => horse.id)).size).toBe(3)
    expect(data).toStrictEqual(before)
  })
})

describe('addGameData', () => {
  it('重新產生識別後寫入：原局還在也不相撞，新局的內容與原局相同（除了識別）', async () => {
    const db = testDatabase()
    const original = await addSampleGame(db)
    const copy = remapIds(original)
    const progress: [number, number][] = []
    await addGameData(db, copy, (written, total) => progress.push([written, total]))
    const read = await readGameData(db, copy.games[0]!.id)
    for (const name of GAME_TABLES) {
      expect(read[name]).toHaveLength(copy[name].length)
      expect(read[name]).toEqual(expect.arrayContaining(copy[name] as unknown[]))
    }
    expect(await readGameData(db, GAME)).toStrictEqual(original)
    expect(progress).toHaveLength(GAME_TABLES.length)
    expect(progress[0]).toEqual([1, SAMPLE_TOTAL])
    expect(progress[GAME_TABLES.length - 1]).toEqual([SAMPLE_TOTAL, SAMPLE_TOTAL])
  })

  it('識別已經存在時整筆回復，什麼都不寫', async () => {
    const db = testDatabase()
    const original = await addSampleGame(db)
    const partlyNew: GameData = { ...remapIds(original), horses: original.horses }
    await expect(addGameData(db, partlyNew)).rejects.toThrow()
    expect(await db.games.count()).toBe(1)
    expect(totalRows(await countGameRows(db, GAME))).toBe(SAMPLE_TOTAL)
    expect(await db.settings.count()).toBe(1)
  })
})

describe('deleteGameData', () => {
  it('只刪這一局的資料列，回傳各表刪除的筆數；不碰 meta', async () => {
    const db = testDatabase()
    const data = await addSampleGame(db)
    const other = await addSampleGame(db, { id: 'G2' })
    await db.meta.put({ key: 'currentGame', value: GAME })
    expect(await deleteGameData(db, GAME)).toEqual(countRows(data))
    expect(await db.games.get(GAME)).toBeUndefined()
    for (const name of GAME_TABLES.filter((name) => name !== 'games')) {
      expect(await db.table(name).where('gameId').equals(GAME).count()).toBe(0)
    }
    expect(await readGameData(db, 'G2')).toStrictEqual(other)
    expect(await db.meta.get('currentGame')).toEqual({ key: 'currentGame', value: GAME })
  })

  it('遊戲局不存在時什麼都不刪，筆數都是 0', async () => {
    const db = testDatabase()
    await addSampleGame(db)
    const counts = await deleteGameData(db, 'missing')
    expect(Object.keys(counts)).toEqual([...GAME_TABLES])
    expect(totalRows(counts)).toBe(0)
    expect(totalRows(await countGameRows(db, GAME))).toBe(SAMPLE_TOTAL)
  })
})

describe('countGameRows', () => {
  it('這一局各表的筆數與合計', async () => {
    const db = testDatabase()
    const data = await addSampleGame(db)
    await addSampleGame(db, { id: 'G2' })
    const counts = await countGameRows(db, GAME)
    expect(counts).toEqual({
      games: 1,
      settings: 1,
      horses: 3,
      lines: 1,
      systems: 1,
      mares: 1,
      mareYears: 1,
      stallions: 1,
      restorations: 1,
      breedings: 1,
      matingRatings: 1,
      events: 1,
      horseNumbers: 1,
    })
    expect(countRows(data)).toEqual(counts)
    expect(totalRows(counts)).toBe(SAMPLE_TOTAL)
  })

  it('遊戲局不存在時丟出錯誤', async () => {
    await expect(countGameRows(testDatabase(), 'missing')).rejects.toThrow('找不到遊戲局：missing')
  })
})
