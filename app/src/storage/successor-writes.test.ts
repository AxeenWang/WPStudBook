import { describe, expect, it } from 'vitest'
import { addTestGame } from '../../tests/support/database'
import { GAME, horseRow, stallionRow } from '../../tests/support/rows'
import { successorHerd } from '../../tests/support/successor'
import { loadGame } from './games'
import { loadRuleSnapshot } from './loaders'
import type { StallionReadiness, StallionRow } from './records'
import { cancelSuccessor, designateSuccessor } from './successor-writes'

const now = new Date('2026-09-28T01:02:03.000Z')

/** addTestGame 的建立與更新時間 */
const CREATED_AT = '2026-09-24T00:00:00.000Z'

/** 事件的共用欄位（手動、1990 年、寫入時間 now） */
const EVENT = {
  id: expect.any(String),
  gameId: GAME,
  year: 1990,
  recordedAt: '2026-09-28T01:02:03.000Z',
  source: { kind: 'manual' },
}

describe('designateSuccessor', () => {
  it('指定已出生的公駒：新增狀態留空的任用，就緒預設競走中；事件同時記系位置與馬匹', async () => {
    const db = await successorHerd()
    const result = await designateSuccessor(db, GAME, { target: { horseId: 'C87' } }, { now })
    if (result.status !== 'done') throw new Error(result.status)
    const row: StallionRow = {
      id: result.value.id,
      gameId: GAME,
      line: 1,
      generation: 5,
      horseId: 'C87',
      readiness: 'racing',
    }
    expect(result).toStrictEqual({ status: 'done', value: row, warnings: [] })
    expect(await db.stallions.get(row.id)).toStrictEqual(row)
    expect(await db.events.toArray()).toStrictEqual([
      {
        ...EVENT,
        kind: 'successor-designated',
        line: 1,
        horseId: 'C87',
        stallionId: row.id,
        generation: 5,
        readiness: 'racing',
      },
    ])
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-28T01:02:03.000Z')
    // 那一格有了種牡馬紀錄：已指定、還沒正式供用
    const { eightLines } = await loadRuleSnapshot(db, GAME)
    expect(eightLines.lines[0]!.stallions).toEqual([
      { generation: 4, state: 'active' },
      { generation: 5, state: 'waiting' },
    ])
  })

  it('可以直接指定為已引退待指定', async () => {
    const db = await successorHerd()
    const result = await designateSuccessor(db, GAME, {
      target: { horseId: 'C89' },
      readiness: 'retired-awaiting',
    })
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value).toMatchObject({ horseId: 'C89', readiness: 'retired-awaiting' })
  })

  it('指定尚未出生的受胎配種：任用存配種紀錄，沒有馬匹與就緒；事件只記系位置', async () => {
    const db = await successorHerd()
    const result = await designateSuccessor(db, GAME, { target: { breedingId: 'B90' } }, { now })
    if (result.status !== 'done') throw new Error(result.status)
    const row: StallionRow = {
      id: result.value.id,
      gameId: GAME,
      line: 1,
      generation: 5,
      breedingId: 'B90',
    }
    expect(result.value).toStrictEqual(row)
    expect(await db.events.toArray()).toStrictEqual([
      {
        ...EVENT,
        kind: 'successor-designated',
        line: 1,
        stallionId: row.id,
        generation: 5,
        breedingId: 'B90',
      },
    ])
  })

  it('這一系已有預定後繼時阻止並指出那一筆；公駒在那一格已有接任過的任用時阻止，什麼都不寫', async () => {
    const db = await successorHerd()
    const first = await designateSuccessor(db, GAME, { target: { breedingId: 'B90' } })
    if (first.status !== 'done') throw new Error(first.status)
    await db.stallions.add(stallionRow('C87', 1, 5, { status: 'replaced' }))
    expect(await designateSuccessor(db, GAME, { target: { horseId: 'C87' } })).toEqual({
      status: 'blocked',
      blocks: [
        { kind: 'line-has-successor', stallionId: first.value.id },
        { kind: 'already-appointed', stallionId: 'C87' },
      ],
    })
    expect(await designateSuccessor(db, GAME, { target: { horseId: 'C89' } })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'line-has-successor', stallionId: first.value.id }],
    })
    expect(await db.stallions.count()).toBe(3)
    expect(await db.events.count()).toBe(1)

    // 同一匹公駒已是預定後繼時，只算這一系已有預定後繼
    await cancelSuccessor(db, GAME, first.value.id)
    const colt = await designateSuccessor(db, GAME, { target: { horseId: 'C89' } })
    if (colt.status !== 'done') throw new Error(colt.status)
    expect(await designateSuccessor(db, GAME, { target: { horseId: 'C89' } })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'line-has-successor', stallionId: colt.value.id }],
    })
  })

  it('其他系的預定後繼不算', async () => {
    const db = await successorHerd()
    await db.stallions.add({ id: 'P2', gameId: GAME, line: 2, generation: 5, breedingId: 'X' })
    expect((await designateSuccessor(db, GAME, { target: { horseId: 'C87' } })).status).toBe('done')
  })

  it('指定的配種已有產駒出生時阻止，改為指定那匹產駒', async () => {
    const db = await successorHerd()
    expect(await designateSuccessor(db, GAME, { target: { breedingId: 'B86' } })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'foal-exists', horseId: 'C87' }],
    })
    expect(await db.stallions.count()).toBe(1)
  })

  it('9.6 核對不符時阻止：自由配種所生、父母不符、預計產出與配對不符（PED-08、BRD-15）', async () => {
    const db = await successorHerd()
    await db.horses.add(
      horseRow('FC', { sex: 'male', birthYear: 1990, damId: 'D24B', birth: { breedingId: 'F89' } }),
    )
    expect(await designateSuccessor(db, GAME, { target: { horseId: 'FC' } })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'successor', mismatches: [{ mismatch: 'free-breeding' }] }],
    })
    await db.horses.update('C87', { damId: 'D24B' })
    expect(await designateSuccessor(db, GAME, { target: { horseId: 'C87' } })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'successor', mismatches: [{ mismatch: 'parents' }] }],
    })
    const b90 = await db.breedings.get('B90')
    await db.breedings.update('B90', {
      rule: { ...b90!.rule!, output: { line: 1, generation: 6 } },
    })
    expect(await designateSuccessor(db, GAME, { target: { breedingId: 'B90' } })).toEqual({
      status: 'blocked',
      blocks: [
        {
          kind: 'successor',
          mismatches: [{ mismatch: 'placement', expected: { line: 1, generation: 5 } }],
        },
      ],
    })
    expect(await db.stallions.count()).toBe(1)
    expect(await db.events.count()).toBe(0)
    expect((await loadGame(db, GAME)).updatedAt).toBe(CREATED_AT)
  })

  it('對象是牝駒、市場馬、不是受胎或不是八系指定配種的紀錄，尚未出生時傳了就緒，或就緒不符時丟出錯誤', async () => {
    const db = await successorHerd()
    await addTestGame(db, { id: 'G2' })
    await db.horses.add(horseRow('MARKET', { sex: 'male' }))
    await db.breedings.update('B89', { conception: '未確認' })
    const designate = (target: { horseId: string } | { breedingId: string }) =>
      designateSuccessor(db, GAME, { target })
    await expect(designate({ horseId: 'F88' })).rejects.toThrow('只有公駒可以當預定後繼：F88')
    await expect(designate({ horseId: 'MARKET' })).rejects.toThrow('不是自家產駒：MARKET')
    await expect(designate({ horseId: 'X' })).rejects.toThrow('找不到馬匹：X')
    await expect(designate({ breedingId: 'B89' })).rejects.toThrow('不是受胎的八系指定配種：B89')
    await expect(designate({ breedingId: 'F89' })).rejects.toThrow('不是受胎的八系指定配種：F89')
    await expect(designate({ breedingId: 'X' })).rejects.toThrow('找不到配種紀錄：X')
    await expect(
      designateSuccessor(db, GAME, { target: { breedingId: 'B90' }, readiness: 'racing' }),
    ).rejects.toThrow('尚未出生的預定後繼沒有就緒狀態：B90')
    await expect(
      designateSuccessor(db, GAME, {
        target: { horseId: 'C87' },
        readiness: 'retired' as StallionReadiness,
      }),
    ).rejects.toThrow('就緒狀態不符：retired')
    expect(await db.stallions.count()).toBe(1)
  })
})

describe('cancelSuccessor', () => {
  it('取消預定後繼：刪除那一列任用，事件記系位置、代數與對象', async () => {
    const db = await successorHerd()
    const colt = await designateSuccessor(db, GAME, { target: { horseId: 'C87' } })
    if (colt.status !== 'done') throw new Error(colt.status)
    await db.events.clear()
    const result = await cancelSuccessor(db, GAME, colt.value.id, { now })
    expect(result).toStrictEqual({ status: 'done', value: colt.value, warnings: [] })
    expect(await db.stallions.get(colt.value.id)).toBeUndefined()
    expect(await db.events.toArray()).toStrictEqual([
      {
        ...EVENT,
        kind: 'successor-cancelled',
        line: 1,
        horseId: 'C87',
        stallionId: colt.value.id,
        generation: 5,
      },
    ])
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-28T01:02:03.000Z')

    const unborn = await designateSuccessor(db, GAME, { target: { breedingId: 'B90' } })
    if (unborn.status !== 'done') throw new Error(unborn.status)
    await db.events.clear()
    expect((await cancelSuccessor(db, GAME, unborn.value.id)).status).toBe('done')
    const [event] = await db.events.toArray()
    expect(event).toMatchObject({ kind: 'successor-cancelled', breedingId: 'B90' })
    expect(event).not.toHaveProperty('horseId')
  })

  it('任用找不到、屬於其他局或已接任時丟出錯誤', async () => {
    const db = await successorHerd()
    await addTestGame(db, { id: 'G2' })
    await db.stallions.add({ id: 'OTHER', gameId: 'G2', line: 1, generation: 5, breedingId: 'X' })
    await expect(cancelSuccessor(db, GAME, 'X')).rejects.toThrow('找不到種牡馬的任用：X')
    await expect(cancelSuccessor(db, GAME, 'OTHER')).rejects.toThrow('找不到種牡馬的任用：OTHER')
    await expect(cancelSuccessor(db, GAME, 'S14')).rejects.toThrow(
      '已接任的種牡馬不是預定後繼：S14',
    )
    expect(await db.stallions.get('S14')).toBeDefined()
  })
})
