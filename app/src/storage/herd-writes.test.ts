import { describe, expect, it } from 'vitest'
import { addTestGame, testDatabase } from '../../tests/support/database'
import { GAME, horseRow, ownMareRow, substituteMareRow } from '../../tests/support/rows'
import type { WPStudBookDatabase } from './database'
import { loadGame } from './games'
import { correctDeparture, sellMare } from './herd-writes'

const now = new Date('2026-09-26T01:02:03.000Z')

/** addTestGame 的建立與更新時間 */
const CREATED_AT = '2026-09-24T00:00:00.000Z'

/** 父 S、母 D 的自家母駒 A（正式保留）與市場母馬 M（替代第 2 系 3 代），都在圈；目前遊戲年 1990 */
async function herd(): Promise<WPStudBookDatabase> {
  const db = testDatabase()
  await addTestGame(db)
  await db.horses.bulkAdd([
    horseRow('A', { birthYear: 1984, sireId: 'S', damId: 'D' }),
    horseRow('M', { birthYear: 1980 }),
  ])
  await db.mares.bulkAdd([
    ownMareRow('A', 1, 3, { sisterStatus: 'kept' }),
    substituteMareRow('M', 2, 3),
  ])
  return db
}

describe('sellMare', () => {
  it('在圈的母馬賣出：在圈狀態改為售出，事件記原因；自家母駒的接替狀態不變（技術設計 4.2）', async () => {
    const db = await herd()
    const result = await sellMare(db, GAME, 'A', { now })
    const sold = ownMareRow('A', 1, 3, { sisterStatus: 'kept', herd: 'sold' })
    expect(result).toEqual({ status: 'done', value: sold, warnings: [] })
    expect(await db.mares.get('A')).toEqual(sold)
    expect(await db.events.toArray()).toEqual([
      {
        id: expect.any(String),
        gameId: GAME,
        year: 1990,
        recordedAt: '2026-09-26T01:02:03.000Z',
        source: { kind: 'manual' },
        kind: 'mare-departed',
        horseId: 'A',
        reason: 'sold',
      },
    ])
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-26T01:02:03.000Z')

    expect((await sellMare(db, GAME, 'M')).status).toBe('done')
    expect(await db.mares.get('M')).toEqual(substituteMareRow('M', 2, 3, { herd: 'sold' }))
  })

  it('已達定年時阻止並附今年的馬齡，什麼都不寫；未達定年或出生年不明時可以賣出', async () => {
    const db = await herd()
    await db.horses.bulkAdd([
      horseRow('O', { birthYear: 1965 }),
      horseRow('Y', { birthYear: 1966 }),
      horseRow('N'),
    ])
    await db.mares.bulkAdd([
      substituteMareRow('O', 2, 3),
      substituteMareRow('Y', 2, 3),
      substituteMareRow('N', 2, 3),
    ])
    expect(await sellMare(db, GAME, 'O')).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'retirement-age', age: 25 }],
    })
    expect(await db.mares.get('O')).toMatchObject({ herd: 'in-herd' })
    expect(await db.events.count()).toBe(0)
    expect((await loadGame(db, GAME)).updatedAt).toBe(CREATED_AT)
    expect((await sellMare(db, GAME, 'Y')).status).toBe('done')
    expect((await sellMare(db, GAME, 'N')).status).toBe('done')

    await db.settings.update(GAME, { retirementAge: 30 })
    expect((await sellMare(db, GAME, 'O')).status).toBe('done')
  })

  it('母馬找不到、屬於其他局或不在圈內時丟出錯誤', async () => {
    const db = await herd()
    await addTestGame(db, { id: 'G2' })
    await db.mares.add(substituteMareRow('X', 2, 3, { gameId: 'G2' }))
    await db.mares.update('M', { herd: 'retired' })
    await expect(sellMare(db, GAME, 'Q')).rejects.toThrow('找不到母馬：Q')
    await expect(sellMare(db, GAME, 'X')).rejects.toThrow('找不到母馬：X')
    await expect(sellMare(db, GAME, 'M')).rejects.toThrow('不在繁殖圈內的母馬不能賣出：M')
  })
})

describe('correctDeparture', () => {
  it('售出與定年引退互改：只改在圈狀態，事件記原狀態與新狀態', async () => {
    const db = await herd()
    await db.mares.update('M', { herd: 'sold' })
    const result = await correctDeparture(db, GAME, 'M', 'retired', { now })
    const retired = substituteMareRow('M', 2, 3, { herd: 'retired' })
    expect(result).toEqual({ status: 'done', value: retired, warnings: [] })
    expect(await db.events.toArray()).toEqual([
      {
        id: expect.any(String),
        gameId: GAME,
        year: 1990,
        recordedAt: '2026-09-26T01:02:03.000Z',
        source: { kind: 'manual' },
        kind: 'mare-departure-corrected',
        horseId: 'M',
        from: 'sold',
        to: 'retired',
      },
    ])
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-26T01:02:03.000Z')
    expect((await correctDeparture(db, GAME, 'M', 'sold')).status).toBe('done')
    expect(await db.mares.get('M')).toEqual(substituteMareRow('M', 2, 3, { herd: 'sold' }))
  })

  it('撤銷離圈：回到生產中與原本的接替狀態，不寫回歸事件（MARE-32）', async () => {
    const db = await herd()
    await sellMare(db, GAME, 'A')
    const result = await correctDeparture(db, GAME, 'A', 'in-herd')
    expect(result.status === 'done' && result.value).toEqual(
      ownMareRow('A', 1, 3, { sisterStatus: 'kept' }),
    )
    expect((await db.events.toArray()).map((event) => event.kind).sort()).toEqual([
      'mare-departed',
      'mare-departure-corrected',
    ])
  })

  it('撤銷時原本是正式保留、而圈內已有另一匹正式保留的姊妹 → 改為候選，事件記接替狀態的變化', async () => {
    const db = await herd()
    await db.mares.update('A', { herd: 'sold' })
    await db.horses.bulkAdd([
      horseRow('B', { sireId: 'S', damId: 'D' }),
      horseRow('C', { sireId: 'S', damId: 'D' }),
      horseRow('H', { sireId: 'S', damId: 'E' }),
    ])
    await db.mares.bulkAdd([
      ownMareRow('B', 1, 3, { sisterStatus: 'kept', herd: 'sold' }),
      ownMareRow('C', 1, 3, { sisterStatus: 'candidate' }),
      ownMareRow('H', 1, 3, { sisterStatus: 'kept' }),
    ])
    expect((await correctDeparture(db, GAME, 'A', 'in-herd')).status).toBe('done')
    expect(await db.mares.get('A')).toMatchObject({ herd: 'in-herd', sisterStatus: 'kept' })

    await db.mares.update('A', { herd: 'sold' })
    await db.mares.update('C', { sisterStatus: 'kept' })
    const result = await correctDeparture(db, GAME, 'A', 'in-herd')
    expect(result.status === 'done' && result.value).toMatchObject({
      herd: 'in-herd',
      sisterStatus: 'candidate',
    })
    const corrections = (await db.events.toArray()).filter(
      (event) => event.kind === 'mare-departure-corrected',
    )
    expect(corrections).toContainEqual(
      expect.objectContaining({ sisterStatus: { from: 'kept', to: 'candidate' } }),
    )

    await db.horses.add(horseRow('R', { sireId: 'S', damId: 'D' }))
    await db.mares.add(ownMareRow('R', 1, 3, { sisterStatus: 'replaced', herd: 'sold' }))
    expect((await correctDeparture(db, GAME, 'R', 'in-herd')).status).toBe('done')
    expect(await db.mares.get('R')).toMatchObject({ herd: 'in-herd', sisterStatus: 'replaced' })
  })

  it('改為售出或定年引退時接替狀態不變；和目前相同時阻止；還在圈內時丟出錯誤', async () => {
    const db = await herd()
    await db.horses.add(horseRow('C', { sireId: 'S', damId: 'D' }))
    await db.mares.add(ownMareRow('C', 1, 3, { sisterStatus: 'kept' }))
    await db.mares.update('A', { herd: 'sold' })
    expect((await correctDeparture(db, GAME, 'A', 'retired')).status).toBe('done')
    expect(await db.mares.get('A')).toMatchObject({ herd: 'retired', sisterStatus: 'kept' })
    expect(await correctDeparture(db, GAME, 'A', 'retired')).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'unchanged' }],
    })
    await expect(correctDeparture(db, GAME, 'M', 'sold')).rejects.toThrow(
      '母馬在繁殖圈內，沒有離圈可以更正：M',
    )
    await expect(correctDeparture(db, GAME, 'Q', 'sold')).rejects.toThrow('找不到母馬：Q')
  })
})
