import { describe, expect, it } from 'vitest'
import { addTestGame, testDatabase } from '../../tests/support/database'
import { GAME, horseRow, ownMareRow, ungroupedMareRow } from '../../tests/support/rows'
import { correctBreeding, registerBreeding } from './breeding-writes'
import type { WPStudBookDatabase } from './database'
import { loadGame } from './games'
import type { BreedingRow } from './records'

const now = new Date('2026-09-27T01:02:03.000Z')

/** addTestGame 的建立與更新時間 */
const CREATED_AT = '2026-09-24T00:00:00.000Z'

/** 自由配種：種牡馬是內部馬匹 */
const freeWith = (horseId: string) => ({ kind: 'free' as const, sire: { horseId } })

/** 自由配種：種牡馬只有外部名稱 */
const freeNamed = (name: string) => ({ kind: 'free' as const, sire: { name } })

/** 目前遊戲年 1990：待指定用途的在圈母馬 M（1980 年生）、牡馬 S 與牝馬 F */
async function herd(): Promise<WPStudBookDatabase> {
  const db = testDatabase()
  await addTestGame(db)
  await db.horses.bulkAdd([
    horseRow('M', { sex: 'female', baseName: 'ハナカゴ', birthYear: 1980 }),
    horseRow('S', { sex: 'male', baseName: 'トサミドリ' }),
    horseRow('F', { sex: 'female' }),
  ])
  await db.mares.add(ungroupedMareRow('M', 'unassigned'))
  return db
}

/** 母馬 M 在 year 年的自由配種紀錄，種牡馬為 S */
function freeBreeding(id: string, year: number, fields: Partial<BreedingRow> = {}): BreedingRow {
  return { id, gameId: GAME, mareId: 'M', year, kind: 'free', sireId: 'S', ...fields }
}

describe('registerBreeding：自由配種', () => {
  it('種牡馬是內部馬匹：寫入今年的配種紀錄與事件，不做規則與血統檢查', async () => {
    const db = await herd()
    const result = await registerBreeding(db, GAME, 'M', freeWith('S'), { now })
    if (result.status !== 'done') throw new Error(result.status)
    const { breeding } = result.value
    expect(result).toEqual({
      status: 'done',
      value: { breeding, parentSystemUnknown: false },
      warnings: [],
    })
    expect(breeding).toStrictEqual({
      id: breeding.id,
      gameId: GAME,
      mareId: 'M',
      year: 1990,
      kind: 'free',
      sireId: 'S',
    })
    expect(await db.breedings.get(breeding.id)).toStrictEqual(breeding)
    expect(await db.events.toArray()).toEqual([
      {
        id: expect.any(String),
        gameId: GAME,
        year: 1990,
        recordedAt: '2026-09-27T01:02:03.000Z',
        source: { kind: 'manual' },
        kind: 'breeding-registered',
        horseId: 'M',
        breedingId: breeding.id,
        breeding: { kind: 'free', sireId: 'S' },
      },
    ])
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-27T01:02:03.000Z')
  })

  it('種牡馬只有外部名稱：去掉前後空白與前綴存基本馬名；空白或只有前綴時阻止，什麼都不寫', async () => {
    const db = await herd()
    expect(await registerBreeding(db, GAME, 'M', freeNamed('(外)'))).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'sire-name' }],
    })
    expect(await registerBreeding(db, GAME, 'M', freeNamed('  '))).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'sire-name' }],
    })
    expect(await db.breedings.count()).toBe(0)
    expect(await db.events.count()).toBe(0)
    expect((await loadGame(db, GAME)).updatedAt).toBe(CREATED_AT)

    const result = await registerBreeding(db, GAME, 'M', freeNamed(' (外)ノーザンダンサー '))
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value.breeding).toStrictEqual({
      id: result.value.breeding.id,
      gameId: GAME,
      mareId: 'M',
      year: 1990,
      kind: 'free',
      sireName: 'ノーザンダンサー',
    })
    expect((await db.events.toArray())[0]).toMatchObject({
      kind: 'breeding-registered',
      breeding: { kind: 'free', sireName: 'ノーザンダンサー' },
    })
  })

  it('母馬在圈就好：自由配種所生、已被取代的姊妹、已達定年的母馬都可以登記（需求規格 7.8）', async () => {
    const db = await herd()
    await db.horses.bulkAdd([
      horseRow('FR', { sex: 'female' }),
      horseRow('R', { sex: 'female' }),
      horseRow('OLD', { sex: 'female', birthYear: 1965 }),
    ])
    await db.mares.bulkAdd([
      ungroupedMareRow('FR', 'free'),
      ownMareRow('R', 1, 2, { sisterStatus: 'replaced' }),
      ungroupedMareRow('OLD', 'unassigned'),
    ])
    for (const mareId of ['FR', 'R', 'OLD']) {
      const result = await registerBreeding(db, GAME, mareId, freeWith('S'))
      expect(result.status).toBe('done')
    }
    expect(await db.breedings.count()).toBe(3)
  })

  it('這匹母馬今年已有配種紀錄時阻止並指出那一筆，阻止原因一次列全；往年的紀錄不算', async () => {
    const db = await herd()
    await db.breedings.add(freeBreeding('B89', 1989))
    const first = await registerBreeding(db, GAME, 'M', freeWith('S'))
    if (first.status !== 'done') throw new Error(first.status)
    expect(await registerBreeding(db, GAME, 'M', freeNamed('(外)'))).toEqual({
      status: 'blocked',
      blocks: [
        { kind: 'already-registered', breedingId: first.value.breeding.id },
        { kind: 'sire-name' },
      ],
    })
    expect(await db.breedings.count()).toBe(2)
  })

  it('母馬或種牡馬找不到、屬於其他局，母馬不在圈內，或種牡馬是牝馬時丟出錯誤', async () => {
    const db = await herd()
    await addTestGame(db, { id: 'G2' })
    await db.horses.bulkAdd([
      horseRow('M2', { gameId: 'G2', sex: 'female' }),
      horseRow('S2', { gameId: 'G2', sex: 'male' }),
      horseRow('SOLD', { sex: 'female' }),
    ])
    await db.mares.bulkAdd([
      ungroupedMareRow('M2', 'unassigned', { gameId: 'G2' }),
      ungroupedMareRow('SOLD', 'unassigned', { herd: 'sold' }),
    ])
    await expect(registerBreeding(db, GAME, 'X', freeWith('S'))).rejects.toThrow('找不到母馬：X')
    await expect(registerBreeding(db, GAME, 'M2', freeWith('S'))).rejects.toThrow('找不到母馬：M2')
    await expect(registerBreeding(db, GAME, 'SOLD', freeWith('S'))).rejects.toThrow(
      '不在繁殖圈內的母馬不能登記配種：SOLD',
    )
    await expect(registerBreeding(db, GAME, 'M', freeWith('X'))).rejects.toThrow('找不到馬匹：X')
    await expect(registerBreeding(db, GAME, 'M', freeWith('S2'))).rejects.toThrow('找不到馬匹：S2')
    await expect(registerBreeding(db, GAME, 'M', freeWith('F'))).rejects.toThrow(
      '牝馬不能當種牡馬：F',
    )
    expect(await db.breedings.count()).toBe(0)
  })
})

describe('correctBreeding：自由配種', () => {
  it('更正今年的紀錄：換種牡馬，受胎狀態不變；事件記原內容與新內容', async () => {
    const db = await herd()
    await db.breedings.add(freeBreeding('B', 1990, { conception: '受胎' }))
    const result = await correctBreeding(db, GAME, 'B', freeNamed('ノーザンダンサー'), { now })
    if (result.status !== 'done') throw new Error(result.status)
    const breeding = {
      id: 'B',
      gameId: GAME,
      mareId: 'M',
      year: 1990,
      conception: '受胎',
      kind: 'free',
      sireName: 'ノーザンダンサー',
    }
    expect(result).toEqual({
      status: 'done',
      value: { breeding, parentSystemUnknown: false },
      warnings: [],
    })
    expect(await db.breedings.get('B')).toStrictEqual(breeding)
    expect(await db.events.toArray()).toEqual([
      {
        id: expect.any(String),
        gameId: GAME,
        year: 1990,
        recordedAt: '2026-09-27T01:02:03.000Z',
        source: { kind: 'manual' },
        kind: 'breeding-corrected',
        horseId: 'M',
        breedingId: 'B',
        from: { kind: 'free', sireId: 'S' },
        to: { kind: 'free', sireName: 'ノーザンダンサー' },
      },
    ])
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-27T01:02:03.000Z')
  })

  it('和目前相同時阻止；往年的紀錄只能看，不能更正（BRD-25）', async () => {
    const db = await herd()
    await db.breedings.bulkAdd([freeBreeding('B', 1990), freeBreeding('B89', 1989)])
    expect(await correctBreeding(db, GAME, 'B', freeWith('S'))).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'unchanged' }],
    })
    expect(await correctBreeding(db, GAME, 'B89', freeNamed('ノーザンダンサー'))).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'past-year' }],
    })
    expect(await db.events.count()).toBe(0)
  })

  it('已有產駒的出生紀錄連到這一筆時阻止並指出那匹產駒，阻止原因一次列全（BRD-25）', async () => {
    const db = await herd()
    await db.breedings.add(freeBreeding('B', 1990))
    // 同一匹母馬其他配種的產駒不算
    await db.horses.add(horseRow('EARLIER', { damId: 'M', birth: { breedingId: 'B89' } }))
    const corrected = await correctBreeding(db, GAME, 'B', freeNamed('ノーザンダンサー'))
    expect(corrected.status).toBe('done')
    await db.horses.add(horseRow('FOAL', { damId: 'M', birth: { breedingId: 'B' } }))
    expect(await correctBreeding(db, GAME, 'B', freeNamed('(外)'))).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'foal-exists', horseId: 'FOAL' }, { kind: 'sire-name' }],
    })
  })

  it('配種紀錄找不到或屬於其他局時丟出錯誤', async () => {
    const db = await herd()
    await addTestGame(db, { id: 'G2' })
    await db.breedings.add(freeBreeding('B2', 1990, { gameId: 'G2' }))
    await expect(correctBreeding(db, GAME, 'X', freeWith('S'))).rejects.toThrow('找不到配種紀錄：X')
    await expect(correctBreeding(db, GAME, 'B2', freeWith('S'))).rejects.toThrow(
      '找不到配種紀錄：B2',
    )
  })
})
