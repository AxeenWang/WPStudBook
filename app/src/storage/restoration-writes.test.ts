import { describe, expect, it } from 'vitest'
import { addTestGame, testDatabase } from '../../tests/support/database'
import {
  GAME,
  horseRow,
  lineRow,
  ownMareRow,
  restorationRow,
  stallionRow,
  substituteMareRow,
} from '../../tests/support/rows'
import type { WPStudBookDatabase } from './database'
import { loadGame } from './games'
import { loadRuleSnapshot } from './loaders'
import { declareRestoration, revokeRestoration } from './restoration-writes'

const now = new Date('2026-09-26T01:02:03.000Z')

/** addTestGame 的建立與更新時間 */
const CREATED_AT = '2026-09-24T00:00:00.000Z'

/** 第 5 系已開啟，12 代的種牡馬已引退（已離場）：可以對 12 代補公系 */
async function lineFiveSireEnded(): Promise<WPStudBookDatabase> {
  const db = testDatabase()
  await addTestGame(db)
  await db.lines.add(lineRow(5, 'ハイペリオン'))
  await db.stallions.add(stallionRow('S512', 5, 12, { status: 'retired' }))
  return db
}

/** 第 5 系的補系清單 */
async function restorationSlots(db: WPStudBookDatabase) {
  return (await loadRuleSnapshot(db, GAME)).eightLines.lines[4]!.restorations
}

const sireInput = {
  line: 5 as const,
  generation: 12,
  side: 'sire' as const,
  reason: ' 後繼無法延續 ',
}

describe('declareRestoration', () => {
  it('宣告補公系：原因去掉前後空白、年度為目前遊戲年，寫入事件；快照列出這筆補系', async () => {
    const db = await lineFiveSireEnded()
    const result = await declareRestoration(db, GAME, sireInput, { now })
    if (result.status !== 'done') throw new Error(result.status)
    const row = {
      id: result.value.id,
      gameId: GAME,
      line: 5,
      generation: 12,
      side: 'sire',
      reason: '後繼無法延續',
      year: 1990,
      revoked: false,
    }
    expect(result).toEqual({ status: 'done', value: row, warnings: [] })
    expect(await db.restorations.toArray()).toEqual([row])
    expect(await db.events.toArray()).toEqual([
      {
        id: expect.any(String),
        gameId: GAME,
        year: 1990,
        recordedAt: '2026-09-26T01:02:03.000Z',
        source: { kind: 'manual' },
        kind: 'restoration-declared',
        line: 5,
        restorationId: row.id,
        generation: 12,
        side: 'sire',
        reason: '後繼無法延續',
      },
    ])
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-26T01:02:03.000Z')
    expect(await restorationSlots(db)).toEqual([{ side: 'sire', generation: 12 }])
  })

  it('與八系現況矛盾時照 core 的 checkRestoration 阻止；原因空白也阻止；什麼都不寫', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.lines.add(lineRow(5, 'ハイペリオン'))
    await db.stallions.add(stallionRow('S512', 5, 12))
    expect(await declareRestoration(db, GAME, { ...sireInput, reason: ' ' })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'rule', rule: { reason: 'sire-available' } }, { kind: 'blank-reason' }],
    })
    expect(await declareRestoration(db, GAME, { ...sireInput, line: 6 })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'rule', rule: { reason: 'not-opened' } }],
    })
    expect(await db.restorations.count()).toBe(0)
    expect(await db.events.count()).toBe(0)
    expect((await loadGame(db, GAME)).updatedAt).toBe(CREATED_AT)
  })

  it('補母系：母馬群從未成立時可以宣告；已成立時阻止，請改用市場補血', async () => {
    /** 第 5 系 12 代母馬群只有一匹母馬：替代母馬（未成立）或自家母駒（已成立） */
    async function withMare(own: boolean): Promise<WPStudBookDatabase> {
      const db = testDatabase()
      await addTestGame(db)
      await db.lines.add(lineRow(5, 'ハイペリオン'))
      await db.horses.add(horseRow('M', { birthYear: 1985 }))
      await db.mares.add(own ? ownMareRow('M', 5, 12) : substituteMareRow('M', 5, 12))
      return db
    }
    const damInput = {
      line: 5 as const,
      generation: 12,
      side: 'dam' as const,
      reason: '生不出母駒',
    }
    expect((await declareRestoration(await withMare(false), GAME, damInput)).status).toBe('done')
    expect(await declareRestoration(await withMare(true), GAME, damInput)).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'rule', rule: { reason: 'mares-established' } }],
    })
  })

  it('斷血代數不是 0 以上的整數時，core 丟出的 RangeError 照原樣往上丟', async () => {
    const db = await lineFiveSireEnded()
    await expect(declareRestoration(db, GAME, { ...sireInput, generation: -1 })).rejects.toThrow(
      RangeError,
    )
  })
})

describe('revokeRestoration', () => {
  it('撤銷：設為已撤銷並寫事件，宣告的紀錄保留；快照不再列出，之後可以重新宣告', async () => {
    const db = await lineFiveSireEnded()
    const declared = await declareRestoration(db, GAME, sireInput)
    if (declared.status !== 'done') throw new Error(declared.status)
    const result = await revokeRestoration(db, GAME, declared.value.id, { now })
    expect(result).toEqual({
      status: 'done',
      value: { ...declared.value, revoked: true },
      warnings: [],
    })
    expect(await db.restorations.get(declared.value.id)).toEqual({
      ...declared.value,
      revoked: true,
    })
    expect(await db.events.where('[gameId+line]').equals([GAME, 5]).count()).toBe(2)
    expect(await restorationSlots(db)).toEqual([])

    expect((await declareRestoration(db, GAME, sireInput)).status).toBe('done')
    expect(await restorationSlots(db)).toEqual([{ side: 'sire', generation: 12 }])
  })

  it('已有補入的零代種牡馬任用時也可以撤銷，任用留著，八系快照略過它', async () => {
    const db = await lineFiveSireEnded()
    await db.restorations.add(restorationRow('R', 5, 12, 'sire'))
    await db.stallions.add(stallionRow('Z', 5, 0, { restorationId: 'R' }))
    expect((await revokeRestoration(db, GAME, 'R')).status).toBe('done')
    expect(await db.stallions.get('Z')).toEqual(stallionRow('Z', 5, 0, { restorationId: 'R' }))
    const lineFive = (await loadRuleSnapshot(db, GAME)).eightLines.lines[4]!
    expect(lineFive.restorations).toEqual([])
    expect(lineFive.stallions).toEqual([{ generation: 12, state: 'ended' }])
  })

  it('宣告找不到、屬於其他局或已經撤銷時丟出錯誤', async () => {
    const db = await lineFiveSireEnded()
    await addTestGame(db, { id: 'G2' })
    await db.restorations.bulkAdd([
      restorationRow('R2', 5, 12, 'sire', { gameId: 'G2' }),
      restorationRow('R3', 5, 12, 'sire', { revoked: true }),
    ])
    await expect(revokeRestoration(db, GAME, 'X')).rejects.toThrow('找不到補系宣告：X')
    await expect(revokeRestoration(db, GAME, 'R2')).rejects.toThrow('找不到補系宣告：R2')
    await expect(revokeRestoration(db, GAME, 'R3')).rejects.toThrow('補系宣告已經撤銷：R3')
  })
})
