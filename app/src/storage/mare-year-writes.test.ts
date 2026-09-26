import { describe, expect, it } from 'vitest'
import { addTestGame, testDatabase } from '../../tests/support/database'
import { GAME, substituteMareRow } from '../../tests/support/rows'
import type { WPStudBookDatabase } from './database'
import { loadGame } from './games'
import { correctVigor, setMarePlan } from './mare-year-writes'
import type { VigorMonth } from './records'

const now = new Date('2026-09-26T01:02:03.000Z')

/** addTestGame 的建立與更新時間 */
const CREATED_AT = '2026-09-24T00:00:00.000Z'

/** 在圈的市場母馬 M；目前遊戲年 1990 */
async function oneMare(): Promise<WPStudBookDatabase> {
  const db = testDatabase()
  await addTestGame(db)
  await db.mares.add(substituteMareRow('M', 2, 3))
  return db
}

describe('setMarePlan', () => {
  it('設定今年計畫：新增今年的資料列，事件記新計畫；再改時記原計畫（MARE-22）', async () => {
    const db = await oneMare()
    const result = await setMarePlan(db, GAME, 'M', 'resting', { now })
    const row = { gameId: GAME, horseId: 'M', year: 1990, plan: 'resting' }
    expect(result).toEqual({ status: 'done', value: row, warnings: [] })
    expect(await db.mareYears.get([GAME, 'M', 1990])).toEqual(row)
    expect(await db.events.toArray()).toEqual([
      {
        id: expect.any(String),
        gameId: GAME,
        year: 1990,
        recordedAt: '2026-09-26T01:02:03.000Z',
        source: { kind: 'manual' },
        kind: 'mare-plan-changed',
        horseId: 'M',
        to: 'resting',
      },
    ])
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-26T01:02:03.000Z')

    expect((await setMarePlan(db, GAME, 'M', 'designated')).status).toBe('done')
    const events = await db.events.where('[gameId+horseId]').equals([GAME, 'M']).toArray()
    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'mare-plan-changed', from: 'resting', to: 'designated' }),
    )
  })

  it('保留同一年的其他資料；和目前相同時阻止，沒有值視為待定', async () => {
    const db = await oneMare()
    const vigor = { value: 13, boosted: true }
    await db.mareYears.add({ gameId: GAME, horseId: 'M', year: 1990, mayVigor: vigor })
    expect(await setMarePlan(db, GAME, 'M', 'pending')).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'unchanged' }],
    })
    expect(await db.events.count()).toBe(0)
    expect((await loadGame(db, GAME)).updatedAt).toBe(CREATED_AT)
    expect((await setMarePlan(db, GAME, 'M', 'free')).status).toBe('done')
    expect(await db.mareYears.get([GAME, 'M', 1990])).toEqual({
      gameId: GAME,
      horseId: 'M',
      year: 1990,
      mayVigor: vigor,
      plan: 'free',
    })
    expect(await setMarePlan(db, GAME, 'M', 'free')).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'unchanged' }],
    })
  })

  it('用的是目前遊戲年；母馬找不到、屬於其他局或不在圈內時丟出錯誤', async () => {
    const db = await oneMare()
    await db.games.update(GAME, { currentYear: 1991 })
    await setMarePlan(db, GAME, 'M', 'waiting-vigor')
    expect(await db.mareYears.get([GAME, 'M', 1991])).toMatchObject({ plan: 'waiting-vigor' })
    await addTestGame(db, { id: 'G2' })
    await db.mares.add(substituteMareRow('X', 2, 3, { gameId: 'G2' }))
    await db.mares.update('M', { herd: 'sold' })
    await expect(setMarePlan(db, GAME, 'Q', 'resting')).rejects.toThrow('找不到母馬：Q')
    await expect(setMarePlan(db, GAME, 'X', 'resting')).rejects.toThrow('找不到母馬：X')
    await expect(setMarePlan(db, GAME, 'M', 'resting')).rejects.toThrow(
      '不在繁殖圈內的母馬沒有今年計畫：M',
    )
  })
})

describe('correctVigor', () => {
  it('更正五月的快照：原本沒有值時填入；事件記快照的年份、月份與新值', async () => {
    const db = await oneMare()
    const result = await correctVigor(
      db,
      GAME,
      'M',
      { year: 1989, month: 5, vigor: { value: 0, boosted: false } },
      { now },
    )
    const row = { gameId: GAME, horseId: 'M', year: 1989, mayVigor: { value: 0, boosted: false } }
    expect(result).toEqual({ status: 'done', value: row, warnings: [] })
    expect(await db.mareYears.get([GAME, 'M', 1989])).toEqual(row)
    expect(await db.events.toArray()).toEqual([
      {
        id: expect.any(String),
        gameId: GAME,
        year: 1990,
        recordedAt: '2026-09-26T01:02:03.000Z',
        source: { kind: 'manual' },
        kind: 'vigor-corrected',
        horseId: 'M',
        snapshotYear: 1989,
        month: 5,
        to: { value: 0, boosted: false },
      },
    ])
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-26T01:02:03.000Z')
  })

  it('更正七月的快照：只改那一份，事件記原值；100 也可以不増強（MARE-14）', async () => {
    const db = await oneMare()
    await db.mareYears.add({
      gameId: GAME,
      horseId: 'M',
      year: 1990,
      mayVigor: { value: 40, boosted: false },
      julyVigor: { value: 55, boosted: false },
      plan: 'designated',
    })
    const result = await correctVigor(db, GAME, 'M', {
      year: 1990,
      month: 7,
      vigor: { value: 100, boosted: false },
    })
    expect(result.status === 'done' && result.value).toEqual({
      gameId: GAME,
      horseId: 'M',
      year: 1990,
      mayVigor: { value: 40, boosted: false },
      julyVigor: { value: 100, boosted: false },
      plan: 'designated',
    })
    expect((await db.events.toArray())[0]).toMatchObject({
      kind: 'vigor-corrected',
      month: 7,
      from: { value: 55, boosted: false },
      to: { value: 100, boosted: false },
    })
    expect(
      (
        await correctVigor(db, GAME, 'M', {
          year: 1990,
          month: 7,
          vigor: { value: 100, boosted: true },
        })
      ).status,
    ).toBe('done')
  })

  it('數值不是 0～100 的整數、年份不是整數或晚於目前遊戲年時阻止，原因一起列出；和目前相同時阻止', async () => {
    const db = await oneMare()
    const correct = (year: number, value: number, boosted = false) =>
      correctVigor(db, GAME, 'M', { year, month: 5, vigor: { value, boosted } })
    expect(await correct(1991, 101)).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'vigor-range' }, { kind: 'year' }],
    })
    expect(await correct(1990, -1)).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'vigor-range' }],
    })
    expect(await correct(1990, 12.5)).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'vigor-range' }],
    })
    expect(await correct(1989.5, 12)).toEqual({ status: 'blocked', blocks: [{ kind: 'year' }] })
    expect(await db.events.count()).toBe(0)
    expect((await correct(1990, 100)).status).toBe('done')
    expect(await correct(1990, 100)).toEqual({ status: 'blocked', blocks: [{ kind: 'unchanged' }] })
    expect((await correct(1990, 100, true)).status).toBe('done')
  })

  it('已離圈的母馬也可以更正；月份不是五月或七月、母馬找不到或屬於其他局時丟出錯誤', async () => {
    const db = await oneMare()
    await db.mares.update('M', { herd: 'retired' })
    const vigor = { value: 10, boosted: false }
    expect((await correctVigor(db, GAME, 'M', { year: 1990, month: 7, vigor })).status).toBe('done')
    await addTestGame(db, { id: 'G2' })
    await db.mares.add(substituteMareRow('X', 2, 3, { gameId: 'G2' }))
    await expect(correctVigor(db, GAME, 'Q', { year: 1990, month: 7, vigor })).rejects.toThrow(
      '找不到母馬：Q',
    )
    await expect(correctVigor(db, GAME, 'X', { year: 1990, month: 7, vigor })).rejects.toThrow(
      '找不到母馬：X',
    )
    await expect(
      correctVigor(db, GAME, 'M', { year: 1990, month: 6 as VigorMonth, vigor }),
    ).rejects.toThrow('活力快照的月份不符：6')
  })
})
