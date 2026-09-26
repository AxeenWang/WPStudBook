import { describe, expect, it } from 'vitest'
import { addTestGame, testDatabase } from '../../tests/support/database'
import {
  GAME,
  horseRow,
  lineRow,
  ownMareRow,
  stallionRow,
  substituteMareRow,
  ungroupedMareRow,
} from '../../tests/support/rows'
import type { WPStudBookDatabase } from './database'
import { loadGame } from './games'
import type { Base } from './records'
import { correctDeparture, locationChange, moveMare, returnMare, sellMare } from './herd-writes'

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

  it('母馬或她的馬匹找不到、屬於其他局，或母馬不在圈內時丟出錯誤', async () => {
    const db = await herd()
    await addTestGame(db, { id: 'G2' })
    await db.mares.bulkAdd([
      substituteMareRow('X', 2, 3, { gameId: 'G2' }),
      substituteMareRow('H', 2, 3),
    ])
    await db.mares.update('M', { herd: 'retired' })
    await expect(sellMare(db, GAME, 'Q')).rejects.toThrow('找不到母馬：Q')
    await expect(sellMare(db, GAME, 'X')).rejects.toThrow('找不到母馬：X')
    await expect(sellMare(db, GAME, 'M')).rejects.toThrow('不在繁殖圈內的母馬不能賣出：M')
    await expect(sellMare(db, GAME, 'H')).rejects.toThrow('找不到馬匹：H')
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

describe('returnMare', () => {
  /** 第 1 系已開啟（マンノウォー，親系統 マッチェム），零代與 1 代種牡馬在崗；已售出的市場母馬 M（替代第 2 系 3 代，父系 マンノウォー） */
  async function soldMarket(): Promise<WPStudBookDatabase> {
    const db = testDatabase()
    await addTestGame(db)
    await db.lines.add(lineRow(1, 'マンノウォー'))
    await db.systems.add({ gameId: GAME, subsystem: 'マンノウォー', parentSystem: 'マッチェム' })
    await db.stallions.bulkAdd([stallionRow('Z1', 1, 0), stallionRow('S11', 1, 1)])
    await db.horses.add(horseRow('M', { sireSystem: 'マンノウォー' }))
    await db.mares.add(substituteMareRow('M', 2, 3, { herd: 'sold', location: 32 }))
    return db
  }

  it('市場母馬買回：恢復生產中、沿用原用途，不重做 8.3 檢查；事件記原離圈狀態', async () => {
    const db = await soldMarket()
    const result = await returnMare(db, GAME, 'M', {}, { now })
    const mare = substituteMareRow('M', 2, 3, { location: 32 })
    expect(result).toEqual({
      status: 'done',
      value: { mare, parentSystemUnknown: false },
      warnings: [],
    })
    expect(await db.mares.get('M')).toEqual(mare)
    expect(await db.events.toArray()).toEqual([
      {
        id: expect.any(String),
        gameId: GAME,
        year: 1990,
        recordedAt: '2026-09-26T01:02:03.000Z',
        source: { kind: 'manual' },
        kind: 'mare-returned',
        horseId: 'M',
        from: 'sold',
      },
    ])
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-26T01:02:03.000Z')
  })

  it('從任務買回：改用配對的用途並照做 8.3 檢查，事件記原用途與新用途（CAND-07）', async () => {
    const db = await soldMarket()
    const input = { assignment: { kind: 'pairing' as const, line: 1 as const, generation: 2 } }
    const warning = {
      kind: 'substitute-parent-system',
      line: 2,
      generation: 1,
      conflicts: [{ kind: 'line', parentSystem: 'マッチェム', lines: [1] }],
    }
    expect(await returnMare(db, GAME, 'M', input)).toEqual({
      status: 'unconfirmed',
      warnings: [warning],
    })
    expect(await db.mares.get('M')).toMatchObject({ herd: 'sold' })
    expect(await db.events.count()).toBe(0)

    const result = await returnMare(db, GAME, 'M', input, { confirmed: true })
    expect(result.status === 'done' && result.value.mare).toEqual(
      substituteMareRow('M', 2, 1, { location: 32 }),
    )
    expect((await db.events.toArray())[0]).toMatchObject({
      kind: 'mare-returned',
      from: 'sold',
      usage: {
        from: { usage: 'substitute', groupLine: 2, groupGeneration: 3 },
        to: { usage: 'substitute', groupLine: 2, groupGeneration: 1 },
      },
      confirmedWarnings: [warning],
    })
  })

  it('從任務買回成例外補入：原因必填，存在母馬與事件；配對不在看板上時阻止；用途相同時不記用途的變化', async () => {
    const db = await soldMarket()
    const found = { kind: 'pairing' as const, line: 2 as const, generation: 2 }
    expect(await returnMare(db, GAME, 'M', { assignment: found })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'reason-required' }],
    })
    expect(
      await returnMare(db, GAME, 'M', { assignment: { kind: 'pairing', line: 3, generation: 3 } }),
    ).toEqual({ status: 'blocked', blocks: [{ kind: 'no-pairing' }] })
    const result = await returnMare(
      db,
      GAME,
      'M',
      { assignment: found, exceptionReason: '自家母駒不足' },
      { confirmed: true },
    )
    expect(result.status === 'done' && result.value.mare).toMatchObject({
      groupLine: 1,
      groupGeneration: 1,
      exceptionReason: '自家母駒不足',
    })
    expect((await db.events.toArray())[0]).toMatchObject({ exceptionReason: '自家母駒不足' })

    await db.mares.update('M', { herd: 'retired' })
    const same = await returnMare(
      db,
      GAME,
      'M',
      {
        assignment: found,
        exceptionReason: '自家母駒不足',
      },
      { confirmed: true },
    )
    expect(same.status).toBe('done')
    const returned = (await db.events.toArray()).filter((event) => event.kind === 'mare-returned')
    expect(returned.filter((event) => 'usage' in event)).toHaveLength(1)
    expect(returned.map((event) => event.kind === 'mare-returned' && event.from).sort()).toEqual([
      'retired',
      'sold',
    ])
  })

  it('自家母駒買回：沿用出生紀錄的系與代數，接替狀態重新判定；成為暫定保留時使該代成立（MARE-30）', async () => {
    const db = await herd()
    await db.horses.add(horseRow('B', { sireId: 'S', damId: 'D' }))
    await db.mares.add(ownMareRow('B', 1, 3, { sisterStatus: 'kept' }))
    await db.mares.update('A', {
      herd: 'sold',
      sisterStatus: 'replaced',
      establishedGeneration: false,
    })
    const candidate = await returnMare(db, GAME, 'A')
    expect(candidate.status === 'done' && candidate.value.mare).toEqual(
      ownMareRow('A', 1, 3, { sisterStatus: 'candidate', establishedGeneration: false }),
    )
    expect((await db.events.toArray())[0]).toMatchObject({
      kind: 'mare-returned',
      sisterStatus: { from: 'replaced', to: 'candidate' },
    })

    await db.mares.update('A', { herd: 'sold', establishedGeneration: false })
    await db.mares.update('B', { herd: 'sold' })
    const provisional = await returnMare(db, GAME, 'A')
    expect(provisional.status === 'done' && provisional.value.mare).toMatchObject({
      groupLine: 1,
      groupGeneration: 3,
      sisterStatus: 'provisional',
      establishedGeneration: true,
    })
  })

  it('以候選買回時不改動已成立的代：establishedGeneration 維持 true（需求規格 8.2）', async () => {
    const db = await herd()
    await db.horses.add(horseRow('B', { sireId: 'S', damId: 'D' }))
    await db.mares.add(ownMareRow('B', 1, 3, { sisterStatus: 'kept' }))
    await db.mares.update('A', { herd: 'sold', sisterStatus: 'replaced' })
    const result = await returnMare(db, GAME, 'A')
    expect(result.status === 'done' && result.value.mare).toMatchObject({
      sisterStatus: 'candidate',
      establishedGeneration: true,
    })
    expect(await db.mares.get('A')).toMatchObject({ establishedGeneration: true })
  })

  it('自由配種所生只恢復生產中；據點一併填時記在事件上，和目前相同時不記', async () => {
    const db = await herd()
    await db.horses.add(horseRow('F'))
    await db.mares.add(ungroupedMareRow('F', 'free', { herd: 'retired' }))
    const free = await returnMare(db, GAME, 'F', { location: 34 })
    expect(free.status === 'done' && free.value.mare).toEqual(
      ungroupedMareRow('F', 'free', { location: 34 }),
    )
    expect((await db.events.toArray())[0]).toEqual(
      expect.objectContaining({ kind: 'mare-returned', from: 'retired', location: { to: 34 } }),
    )
    expect((await db.events.toArray())[0]).not.toHaveProperty('sisterStatus')

    await db.mares.update('M', { herd: 'sold', location: 32 })
    await returnMare(db, GAME, 'M', { location: 32 })
    const [moved] = await db.events.where('[gameId+horseId]').equals([GAME, 'M']).toArray()
    expect(moved).toMatchObject({ kind: 'mare-returned' })
    expect(moved).not.toHaveProperty('location')
  })

  it('母馬找不到、屬於其他局或還在圈內，自家母駒傳了用途，或據點不是 32～35 時丟出錯誤', async () => {
    const db = await herd()
    await addTestGame(db, { id: 'G2' })
    await db.horses.add(horseRow('X', { gameId: 'G2' }))
    await db.mares.add(substituteMareRow('X', 2, 3, { gameId: 'G2', herd: 'sold' }))
    await expect(returnMare(db, GAME, 'Q')).rejects.toThrow('找不到母馬：Q')
    await expect(returnMare(db, GAME, 'X')).rejects.toThrow('找不到母馬：X')
    await expect(returnMare(db, GAME, 'A')).rejects.toThrow('母馬在繁殖圈內，不能買回：A')
    await db.mares.update('A', { herd: 'sold' })
    await expect(returnMare(db, GAME, 'A', { assignment: { kind: 'unassigned' } })).rejects.toThrow(
      '自家母駒與自由配種所生的母馬沿用出生紀錄，不接受用途：A',
    )
    await db.horses.add(horseRow('F'))
    await db.mares.add(ungroupedMareRow('F', 'free', { herd: 'sold' }))
    await expect(returnMare(db, GAME, 'F', { assignment: { kind: 'unassigned' } })).rejects.toThrow(
      '自家母駒與自由配種所生的母馬沿用出生紀錄，不接受用途：F',
    )
    await expect(returnMare(db, GAME, 'A', { location: 36 as Base })).rejects.toThrow(
      '據點不符：36',
    )
  })
})

describe('locationChange', () => {
  it('沒有填新據點或和目前相同時沒有變化；原本不知道據點時沒有 from', () => {
    expect(locationChange(32, undefined)).toBeUndefined()
    expect(locationChange(32, 32)).toBeUndefined()
    expect(locationChange(32, 35)).toStrictEqual({ from: 32, to: 35 })
    expect(locationChange(undefined, 33)).toStrictEqual({ to: 33 })
  })
})

describe('moveMare', () => {
  it('在圈的母馬換據點：事件記原據點與新據點，時點與來源照 WriteOptions', async () => {
    const db = await herd()
    await db.mares.update('M', { location: 32 })
    const result = await moveMare(db, GAME, 'M', 33, { now, timing: { month: 8, week: 2 } })
    const moved = substituteMareRow('M', 2, 3, { location: 33 })
    expect(result).toEqual({ status: 'done', value: moved, warnings: [] })
    expect(await db.mares.get('M')).toEqual(moved)
    expect(await db.events.toArray()).toEqual([
      {
        id: expect.any(String),
        gameId: GAME,
        year: 1990,
        recordedAt: '2026-09-26T01:02:03.000Z',
        source: { kind: 'manual' },
        timing: { month: 8, week: 2 },
        kind: 'mare-moved',
        horseId: 'M',
        from: 32,
        to: 33,
      },
    ])
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-26T01:02:03.000Z')
  })

  it('原本不知道據點時事件沒有原據點；和目前相同時阻止', async () => {
    const db = await herd()
    expect((await moveMare(db, GAME, 'A', 35)).status).toBe('done')
    const [event] = await db.events.toArray()
    expect(event).toMatchObject({ kind: 'mare-moved', to: 35 })
    expect(event).not.toHaveProperty('from')
    expect(await moveMare(db, GAME, 'A', 35)).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'unchanged' }],
    })
    expect(await db.events.count()).toBe(1)
  })

  it('母馬找不到或不在圈內，或據點不是 32～35 時丟出錯誤', async () => {
    const db = await herd()
    await db.mares.update('M', { herd: 'sold' })
    await expect(moveMare(db, GAME, 'Q', 33)).rejects.toThrow('找不到母馬：Q')
    await expect(moveMare(db, GAME, 'M', 33)).rejects.toThrow('不在繁殖圈內的母馬不能轉場：M')
    await expect(moveMare(db, GAME, 'A', 36 as Base)).rejects.toThrow('據點不符：36')
  })
})
