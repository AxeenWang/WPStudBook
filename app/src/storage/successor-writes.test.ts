import { describe, expect, it } from 'vitest'
import { addTestGame } from '../../tests/support/database'
import { GAME, horseRow, stallionRow } from '../../tests/support/rows'
import { successorHerd } from '../../tests/support/successor'
import type { WPStudBookDatabase } from './database'
import { loadGame } from './games'
import { loadRuleSnapshot } from './loaders'
import type { HorseRow, StallionReadiness, StallionRow } from './records'
import {
  appointStallion,
  cancelSuccessor,
  confirmSuccessorBirth,
  designateSuccessor,
  setSuccessorReadiness,
} from './successor-writes'

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

describe('confirmSuccessorBirth', () => {
  /** 後繼牧場，B90 已指定為第 1 系的預定後繼；產駒 C91（牡，1991 年生）的欄位可以覆寫，null 表示還沒建立 */
  async function unbornHerd(foal: Partial<HorseRow> | null = {}) {
    const db = await successorHerd()
    const designated = await designateSuccessor(db, GAME, { target: { breedingId: 'B90' } })
    if (designated.status !== 'done') throw new Error(designated.status)
    if (foal) {
      await db.horses.add(
        horseRow('C91', {
          sex: 'male',
          birthYear: 1991,
          sireId: 'S14',
          damId: 'D24',
          birth: { breedingId: 'B90', placement: { line: 1, generation: 5 } },
          disposition: 'keep',
          ...foal,
        }),
      )
    }
    await db.events.clear()
    return { db, stallionId: designated.value.id }
  }

  it('產駒出生後由使用者確認：這一列改存馬匹、拿掉配種紀錄，就緒為競走中；事件 successor-born', async () => {
    const { db, stallionId } = await unbornHerd()
    const result = await confirmSuccessorBirth(db, GAME, stallionId, { now })
    const row: StallionRow = {
      id: stallionId,
      gameId: GAME,
      line: 1,
      generation: 5,
      horseId: 'C91',
      readiness: 'racing',
    }
    expect(result).toStrictEqual({ status: 'done', value: row, warnings: [] })
    expect(await db.stallions.get(stallionId)).toStrictEqual(row)
    expect(await db.events.toArray()).toStrictEqual([
      {
        ...EVENT,
        kind: 'successor-born',
        line: 1,
        horseId: 'C91',
        stallionId,
        breedingId: 'B90',
      },
    ])
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-28T01:02:03.000Z')
  })

  it('產駒還沒建立時阻止；產駒是牝時阻止（預定後繼失效，由使用者取消），什麼都不寫', async () => {
    const notBorn = await unbornHerd(null)
    expect(await confirmSuccessorBirth(notBorn.db, GAME, notBorn.stallionId)).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'not-born' }],
    })
    const filly = await unbornHerd({ sex: 'female' })
    expect(await confirmSuccessorBirth(filly.db, GAME, filly.stallionId)).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'foal-female', horseId: 'C91' }],
    })
    expect(await filly.db.stallions.get(filly.stallionId)).toMatchObject({ breedingId: 'B90' })
    expect(await filly.db.events.count()).toBe(0)
  })

  it('產駒的 9.6 核對不符時阻止：父母不符；這一列的系與代數和出生紀錄不同', async () => {
    const parents = await unbornHerd({ sireId: 'C87' })
    expect(await confirmSuccessorBirth(parents.db, GAME, parents.stallionId)).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'successor', mismatches: [{ mismatch: 'parents' }] }],
    })
    const target = await unbornHerd()
    await target.db.stallions.update(target.stallionId, { generation: 6 })
    expect(await confirmSuccessorBirth(target.db, GAME, target.stallionId)).toEqual({
      status: 'blocked',
      blocks: [
        {
          kind: 'successor',
          mismatches: [{ mismatch: 'target', expected: { line: 1, generation: 5 } }],
        },
      ],
    })
  })

  it('任用找不到、屬於其他局、已接任或已出生時丟出錯誤', async () => {
    const { db, stallionId } = await unbornHerd()
    const colt = await confirmSuccessorBirth(db, GAME, stallionId)
    expect(colt.status).toBe('done')
    await expect(confirmSuccessorBirth(db, GAME, stallionId)).rejects.toThrow(
      `預定後繼已經出生：${stallionId}`,
    )
    await expect(confirmSuccessorBirth(db, GAME, 'S14')).rejects.toThrow(
      '已接任的種牡馬不是預定後繼：S14',
    )
    await expect(confirmSuccessorBirth(db, GAME, 'X')).rejects.toThrow('找不到種牡馬的任用：X')
  })
})

describe('setSuccessorReadiness', () => {
  it('已出生的預定後繼在競走中與已引退待指定之間切換；事件記原狀態與新狀態', async () => {
    const db = await successorHerd()
    const designated = await designateSuccessor(db, GAME, { target: { horseId: 'C87' } })
    if (designated.status !== 'done') throw new Error(designated.status)
    await db.events.clear()
    const id = designated.value.id
    const result = await setSuccessorReadiness(db, GAME, id, 'retired-awaiting', { now })
    const row = { ...designated.value, readiness: 'retired-awaiting' }
    expect(result).toStrictEqual({ status: 'done', value: row, warnings: [] })
    expect(await db.stallions.get(id)).toStrictEqual(row)
    expect(await db.events.toArray()).toStrictEqual([
      {
        ...EVENT,
        kind: 'successor-readiness-changed',
        line: 1,
        horseId: 'C87',
        stallionId: id,
        from: 'racing',
        to: 'retired-awaiting',
      },
    ])
    expect((await setSuccessorReadiness(db, GAME, id, 'racing')).status).toBe('done')
    expect(await setSuccessorReadiness(db, GAME, id, 'racing')).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'unchanged' }],
    })
  })

  it('尚未出生、已接任、找不到，或就緒不符時丟出錯誤；已出生卻沒有就緒時丟出 RangeError', async () => {
    const db = await successorHerd()
    const unborn = await designateSuccessor(db, GAME, { target: { breedingId: 'B90' } })
    if (unborn.status !== 'done') throw new Error(unborn.status)
    await db.stallions.add({ id: 'BROKEN', gameId: GAME, line: 2, generation: 5, horseId: 'C89' })
    await expect(setSuccessorReadiness(db, GAME, unborn.value.id, 'racing')).rejects.toThrow(
      `尚未出生的預定後繼沒有就緒狀態：${unborn.value.id}`,
    )
    await expect(setSuccessorReadiness(db, GAME, 'S14', 'racing')).rejects.toThrow(
      '已接任的種牡馬不是預定後繼：S14',
    )
    await expect(setSuccessorReadiness(db, GAME, 'X', 'racing')).rejects.toThrow(
      '找不到種牡馬的任用：X',
    )
    await expect(
      setSuccessorReadiness(db, GAME, 'BROKEN', 'active' as StallionReadiness),
    ).rejects.toThrow('就緒狀態不符：active')
    await expect(setSuccessorReadiness(db, GAME, 'BROKEN', 'racing')).rejects.toThrow(RangeError)
  })
})

describe('appointStallion', () => {
  /** 第 1 系 5 代這一格的任用：[馬匹, 狀態]，依馬匹排序 */
  async function slotOf(db: WPStudBookDatabase) {
    const rows = await db.stallions.where('[gameId+line+generation]').equals([GAME, 1, 5]).toArray()
    return rows.map((row) => [row.horseId, row.status]).sort()
  }

  it('新一代第一次接任：新增在崗的任用，不需原因；上一代的現任不動；事件 stallion-appointed', async () => {
    const db = await successorHerd()
    const result = await appointStallion(db, GAME, { horseId: 'C87' }, { now })
    if (result.status !== 'done') throw new Error(result.status)
    const appointment: StallionRow = {
      id: result.value.appointment.id,
      gameId: GAME,
      line: 1,
      generation: 5,
      horseId: 'C87',
      status: 'active',
    }
    expect(result).toStrictEqual({
      status: 'done',
      value: { appointment, replaced: [] },
      warnings: [],
    })
    expect(await db.stallions.get(appointment.id)).toStrictEqual(appointment)
    expect(await db.stallions.get('S14')).toMatchObject({ status: 'active' })
    expect(await db.events.toArray()).toStrictEqual([
      {
        ...EVENT,
        kind: 'stallion-appointed',
        line: 1,
        horseId: 'C87',
        stallionId: appointment.id,
        generation: 5,
        replacedHorseIds: [],
      },
    ])
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-28T01:02:03.000Z')
    expect(await db.horseNumbers.count()).toBe(0)
  })

  it('預定後繼正式接任：沿用那一列，改為在崗並拿掉就緒', async () => {
    const db = await successorHerd()
    const designated = await designateSuccessor(db, GAME, {
      target: { horseId: 'C87' },
      readiness: 'retired-awaiting',
    })
    if (designated.status !== 'done') throw new Error(designated.status)
    const result = await appointStallion(db, GAME, { horseId: 'C87' })
    if (result.status !== 'done') throw new Error(result.status)
    const appointment: StallionRow = {
      id: designated.value.id,
      gameId: GAME,
      line: 1,
      generation: 5,
      horseId: 'C87',
      status: 'active',
    }
    expect(result.value.appointment).toStrictEqual(appointment)
    expect(await db.stallions.get(designated.value.id)).toStrictEqual(appointment)
    expect(await db.stallions.count()).toBe(2)
  })

  it('更換現任要附原因：同一格原本在崗的改為已被取代，事件記原因（說明去掉空白）與被取代的馬', async () => {
    const db = await successorHerd()
    const first = await appointStallion(db, GAME, { horseId: 'C87' })
    if (first.status !== 'done') throw new Error(first.status)
    expect(await appointStallion(db, GAME, { horseId: 'C89' })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'reason-required' }],
    })
    await db.events.clear()
    const result = await appointStallion(
      db,
      GAME,
      { horseId: 'C89', reason: { kind: 'younger-brother', note: ' 能力較高 ' } },
      { now },
    )
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value.replaced).toStrictEqual([
      { ...first.value.appointment, status: 'replaced' },
    ])
    expect(await slotOf(db)).toEqual([
      ['C87', 'replaced'],
      ['C89', 'active'],
    ])
    expect(await db.events.toArray()).toStrictEqual([
      {
        ...EVENT,
        kind: 'stallion-appointed',
        line: 1,
        horseId: 'C89',
        stallionId: result.value.appointment.id,
        generation: 5,
        reason: { kind: 'younger-brother', note: '能力較高' },
        replacedHorseIds: ['C87'],
      },
    ])
  })

  it('被取代的可以換回來：沿用那一列，原本在崗的改為已被取代', async () => {
    const db = await successorHerd()
    const first = await appointStallion(db, GAME, { horseId: 'C87' })
    if (first.status !== 'done') throw new Error(first.status)
    const reason = { kind: 'other' as const }
    await appointStallion(db, GAME, { horseId: 'C89', reason })
    const back = await appointStallion(db, GAME, { horseId: 'C87', reason })
    if (back.status !== 'done') throw new Error(back.status)
    expect(back.value.appointment.id).toBe(first.value.appointment.id)
    expect(await slotOf(db)).toEqual([
      ['C87', 'active'],
      ['C89', 'replaced'],
    ])
  })

  it('那一格只剩已離場的種牡馬時也是更換，要附原因；同一格還沒接任的預定後繼不算', async () => {
    const db = await successorHerd()
    const unborn = await designateSuccessor(db, GAME, { target: { breedingId: 'B90' } })
    if (unborn.status !== 'done') throw new Error(unborn.status)
    const first = await appointStallion(db, GAME, { horseId: 'C87' })
    expect(first.status).toBe('done')
    expect(await db.stallions.get(unborn.value.id)).toMatchObject({ breedingId: 'B90' })
    if (first.status !== 'done') throw new Error(first.status)
    await db.stallions.update(first.value.appointment.id, { status: 'retired' })
    expect(await appointStallion(db, GAME, { horseId: 'C89' })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'reason-required' }],
    })
    const replaced = await appointStallion(db, GAME, {
      horseId: 'C89',
      reason: { kind: 'predecessor-retired' },
    })
    if (replaced.status !== 'done') throw new Error(replaced.status)
    expect(replaced.value.replaced).toEqual([])
    // 尚未出生的預定後繼沒有馬匹與狀態，排序時排在最前面
    expect(await slotOf(db)).toEqual([
      [undefined, undefined],
      ['C87', 'retired'],
      ['C89', 'active'],
    ])
  })

  it('他在那一格已退出或已引退時阻止（先更正狀態）；已在崗時阻止', async () => {
    const db = await successorHerd()
    const reason = { kind: 'other' as const }
    for (const status of ['withdrawn', 'retired'] as const) {
      await db.stallions.put(stallionRow('C87', 1, 5, { status }))
      expect(await appointStallion(db, GAME, { horseId: 'C87', reason })).toEqual({
        status: 'blocked',
        blocks: [{ kind: 'stallion-ended' }],
      })
    }
    await db.stallions.put(stallionRow('C87', 1, 5))
    expect(await appointStallion(db, GAME, { horseId: 'C87', reason })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'unchanged' }],
    })
    expect(await db.events.count()).toBe(0)
  })

  it('尚未出生的預定後繼指定的就是他出生的配種時阻止，先確認出生；確認後沿用那一列接任', async () => {
    const db = await successorHerd()
    const unborn = await designateSuccessor(db, GAME, { target: { breedingId: 'B90' } })
    if (unborn.status !== 'done') throw new Error(unborn.status)
    await db.horses.add(
      horseRow('C91', {
        sex: 'male',
        birthYear: 1991,
        sireId: 'S14',
        damId: 'D24',
        birth: { breedingId: 'B90', placement: { line: 1, generation: 5 } },
        disposition: 'keep',
      }),
    )
    await db.events.clear()
    expect(await appointStallion(db, GAME, { horseId: 'C91' })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'birth-unconfirmed', stallionId: unborn.value.id }],
    })
    expect(await db.stallions.count()).toBe(2)
    expect(await db.events.count()).toBe(0)
    expect((await confirmSuccessorBirth(db, GAME, unborn.value.id)).status).toBe('done')
    const result = await appointStallion(db, GAME, { horseId: 'C91' })
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value.appointment).toStrictEqual({
      id: unborn.value.id,
      gameId: GAME,
      line: 1,
      generation: 5,
      horseId: 'C91',
      status: 'active',
    })
    expect(await db.stallions.count()).toBe(2)
  })

  it('9.6 核對不符或種牡馬馬番号格式不符時阻止，阻止原因一次列全，什麼都不寫（PED-08、BRD-15）', async () => {
    const db = await successorHerd()
    await db.horses.update('C87', { damId: 'D24B' })
    expect(await appointStallion(db, GAME, { horseId: 'C87', horseNumber: '0xZZ' })).toEqual({
      status: 'blocked',
      blocks: [
        { kind: 'successor', mismatches: [{ mismatch: 'parents' }] },
        { kind: 'horse-number' },
      ],
    })
    expect(await appointStallion(db, GAME, { horseId: 'C89', horseNumber: '12' })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'horse-number' }],
    })
    await db.horses.add(
      horseRow('FC', { sex: 'male', birthYear: 1990, damId: 'D24B', birth: { breedingId: 'F89' } }),
    )
    expect(await appointStallion(db, GAME, { horseId: 'FC' })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'successor', mismatches: [{ mismatch: 'free-breeding' }] }],
    })
    expect(await db.stallions.count()).toBe(1)
    expect(await db.events.count()).toBe(0)
    expect(await db.horseNumbers.count()).toBe(0)
    expect((await loadGame(db, GAME)).updatedAt).toBe(CREATED_AT)
  })

  it('種牡馬馬番号去掉前後空白、統一寫法後記一筆種牡馬階段；只有空白時不記（STL-03）', async () => {
    const db = await successorHerd()
    expect(
      (await appointStallion(db, GAME, { horseId: 'C87', horseNumber: ' 0x1a2 ' })).status,
    ).toBe('done')
    expect(await db.horseNumbers.toArray()).toStrictEqual([
      {
        id: expect.any(String),
        gameId: GAME,
        horseId: 'C87',
        stage: 'stallion',
        number: '0x01A2',
        year: 1990,
        source: { kind: 'manual' },
      },
    ])
    const reason = { kind: 'younger-brother' as const }
    expect(
      (await appointStallion(db, GAME, { horseId: 'C89', reason, horseNumber: '  ' })).status,
    ).toBe('done')
    expect(await db.horseNumbers.count()).toBe(1)
  })

  it('馬匹找不到、屬於其他局、不是自家產駒或不是公駒時丟出錯誤', async () => {
    const db = await successorHerd()
    await addTestGame(db, { id: 'G2' })
    await db.horses.bulkAdd([
      horseRow('MARKET', { sex: 'male' }),
      horseRow('OTHER', { gameId: 'G2', sex: 'male', birth: {} }),
    ])
    await expect(appointStallion(db, GAME, { horseId: 'F88' })).rejects.toThrow(
      '只有公駒可以接任種牡馬：F88',
    )
    await expect(appointStallion(db, GAME, { horseId: 'MARKET' })).rejects.toThrow(
      '不是自家產駒：MARKET',
    )
    await expect(appointStallion(db, GAME, { horseId: 'OTHER' })).rejects.toThrow(
      '找不到馬匹：OTHER',
    )
    await expect(appointStallion(db, GAME, { horseId: 'X' })).rejects.toThrow('找不到馬匹：X')
  })
})
