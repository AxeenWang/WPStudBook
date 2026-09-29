import { describe, expect, it } from 'vitest'
import { addTestGame } from '../../tests/support/database'
import { GAME, horseRow, ownFoalRow, ownMareRow, substituteMareRow } from '../../tests/support/rows'
import { successorHerd } from '../../tests/support/successor'
import { loadGame } from './games'
import { keepSister, transferFilly } from './own-mare-writes'
import type { Base, MareRow } from './records'

const now = new Date('2026-09-28T01:02:03.000Z')

/** addTestGame 的建立與更新時間 */
const CREATED_AT = '2026-09-24T00:00:00.000Z'

describe('transferFilly', () => {
  it('八系指定配種所生的牝駒轉入：用途自家、母馬群依出生紀錄；姊妹不在圈 → 暫定保留並使該代成立；事件 mare-transferred', async () => {
    const db = await successorHerd()
    const result = await transferFilly(db, GAME, 'F88', {}, { now })
    const mare: MareRow = {
      horseId: 'F88',
      gameId: GAME,
      usage: 'own',
      groupLine: 1,
      groupGeneration: 5,
      herd: 'in-herd',
      sisterStatus: 'provisional',
      establishedGeneration: true,
      source: { kind: 'retired-racehorse' },
    }
    expect(result).toStrictEqual({ status: 'done', value: mare, warnings: [] })
    expect(await db.mares.get('F88')).toStrictEqual(mare)
    expect(await db.events.toArray()).toStrictEqual([
      {
        id: expect.any(String),
        gameId: GAME,
        year: 1990,
        recordedAt: '2026-09-28T01:02:03.000Z',
        source: { kind: 'manual' },
        kind: 'mare-transferred',
        horseId: 'F88',
        placement: { usage: 'own', groupLine: 1, groupGeneration: 5 },
        sisterStatus: 'provisional',
      },
    ])
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-28T01:02:03.000Z')
    // 牧場處置不變
    expect((await db.horses.get('F88'))?.disposition).toBe('keep')
  })

  it('已有姊妹在圈時為候選，不使該代成立；第二匹不被阻止（8.9、MARE-12）', async () => {
    const db = await successorHerd()
    expect((await transferFilly(db, GAME, 'F88')).status).toBe('done')
    const result = await transferFilly(db, GAME, 'F90')
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value).toMatchObject({ sisterStatus: 'candidate', establishedGeneration: false })
    const events = await db.events.where('[gameId+horseId]').equals([GAME, 'F90']).toArray()
    expect(events).toEqual([
      expect.objectContaining({ kind: 'mare-transferred', sisterStatus: 'candidate' }),
    ])
  })

  it('姊妹都已離圈時為暫定保留', async () => {
    const db = await successorHerd()
    await transferFilly(db, GAME, 'F88')
    await db.mares.update('F88', { herd: 'sold' })
    const result = await transferFilly(db, GAME, 'F90')
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value).toMatchObject({ sisterStatus: 'provisional', establishedGeneration: true })
  })

  it('自由配種所生與比照自由配種：生產中、用途為自由配種所生，不分群、沒有接替狀態（11.5、MAY-10）', async () => {
    const db = await successorHerd()
    await db.horses.add(
      horseRow('U85', {
        sex: 'female',
        birthYear: 1985,
        damId: 'D24',
        birth: {},
        disposition: 'for-sale',
      }),
    )
    for (const horseId of ['FREE90', 'U85']) {
      const mare: MareRow = {
        horseId,
        gameId: GAME,
        usage: 'free',
        herd: 'in-herd',
        establishedGeneration: false,
        source: { kind: 'retired-racehorse' },
      }
      expect(await transferFilly(db, GAME, horseId)).toStrictEqual({
        status: 'done',
        value: mare,
        warnings: [],
      })
    }
    const events = await db.events.toArray()
    expect(events).toHaveLength(2)
    for (const event of events) {
      expect(event).toMatchObject({ kind: 'mare-transferred', placement: { usage: 'free' } })
      expect(event).not.toHaveProperty('sisterStatus')
    }
  })

  it('9.6 核對不符時阻止並列出不符的項目，什麼都不寫（PED-08）', async () => {
    const db = await successorHerd()
    await db.horses.update('F88', { sireId: 'C87' })
    expect(await transferFilly(db, GAME, 'F88')).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'successor', mismatches: [{ mismatch: 'parents' }] }],
    })
    await db.horses.update('F88', {
      sireId: 'S14',
      birth: { breedingId: 'B87', placement: { line: 1, generation: 6 } },
    })
    expect(await transferFilly(db, GAME, 'F88')).toEqual({
      status: 'blocked',
      blocks: [
        {
          kind: 'successor',
          mismatches: [{ mismatch: 'placement', expected: { line: 1, generation: 5 } }],
        },
      ],
    })
    expect(await db.mares.get('F88')).toBeUndefined()
    expect(await db.events.count()).toBe(0)
    expect((await loadGame(db, GAME)).updatedAt).toBe(CREATED_AT)
  })

  it('據點與備註：備註去掉前後空白，只有空白時不寫；據點記在事件上', async () => {
    const db = await successorHerd()
    const result = await transferFilly(db, GAME, 'F88', { location: 33, note: ' 引退後轉入 ' })
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value).toMatchObject({
      location: 33,
      source: { kind: 'retired-racehorse', note: '引退後轉入' },
    })
    expect(await db.events.toArray()).toEqual([
      expect.objectContaining({ kind: 'mare-transferred', location: 33 }),
    ])
    const blank = await transferFilly(db, GAME, 'FREE90', { note: '  ' })
    if (blank.status !== 'done') throw new Error(blank.status)
    expect(blank.value.source).toStrictEqual({ kind: 'retired-racehorse' })
    expect(blank.value).not.toHaveProperty('location')
  })

  it('馬匹找不到、屬於其他局、不是自家產駒或不是牝駒、已經進過繁殖圈，或據點不是 32～35 時丟出錯誤', async () => {
    const db = await successorHerd()
    await addTestGame(db, { id: 'G2' })
    await db.horses.bulkAdd([
      horseRow('OTHER', { gameId: 'G2', sex: 'female', birth: {} }),
      horseRow('MARKET', { sex: 'female' }),
    ])
    await expect(transferFilly(db, GAME, 'X')).rejects.toThrow('找不到馬匹：X')
    await expect(transferFilly(db, GAME, 'OTHER')).rejects.toThrow('找不到馬匹：OTHER')
    await expect(transferFilly(db, GAME, 'MARKET')).rejects.toThrow('不是自家產駒：MARKET')
    await expect(transferFilly(db, GAME, 'C87')).rejects.toThrow('只有牝駒可以轉入繁殖圈：C87')
    await expect(transferFilly(db, GAME, 'D24')).rejects.toThrow(
      '已經進過繁殖圈的母馬要用買回：D24',
    )
    await expect(transferFilly(db, GAME, 'F88', { location: 31 as Base })).rejects.toThrow(
      '據點不符：31',
    )
    expect(await db.mares.get('F88')).toBeUndefined()
    expect(await db.events.count()).toBe(0)
  })
})

describe('keepSister', () => {
  /** 後繼牧場，姊妹 F88（暫定保留）與 F90（候選）都已轉入 */
  async function sistersHerd() {
    const db = await successorHerd()
    await transferFilly(db, GAME, 'F88')
    await transferFilly(db, GAME, 'F90')
    await db.events.clear()
    return db
  }

  it('選定正式保留：她改為正式保留並使該代成立，在圈而且列入任務的姊妹改為已被取代；每匹各寫一筆事件', async () => {
    const db = await sistersHerd()
    const result = await keepSister(db, GAME, 'F90', { now })
    const f90 = ownMareRow('F90', 1, 5, { sisterStatus: 'kept' })
    const f88 = ownMareRow('F88', 1, 5, { sisterStatus: 'replaced' })
    expect(result).toEqual({ status: 'done', value: [f90, f88], warnings: [] })
    expect(await db.mares.get('F90')).toEqual(f90)
    expect(await db.mares.get('F88')).toEqual(f88)
    const events = await db.events.toArray()
    expect(events).toHaveLength(2)
    const common = {
      id: expect.any(String),
      gameId: GAME,
      year: 1990,
      recordedAt: '2026-09-28T01:02:03.000Z',
      source: { kind: 'manual' },
      kind: 'sister-status-changed',
      keptHorseId: 'F90',
    }
    expect(events).toContainEqual({ ...common, horseId: 'F90', from: 'candidate', to: 'kept' })
    expect(events).toContainEqual({
      ...common,
      horseId: 'F88',
      from: 'provisional',
      to: 'replaced',
    })
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-28T01:02:03.000Z')
  })

  it('之後改保留另一匹：對她再做一次，原本正式保留的改為已被取代', async () => {
    const db = await sistersHerd()
    await keepSister(db, GAME, 'F90')
    const result = await keepSister(db, GAME, 'F88')
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value.map((mare) => [mare.horseId, mare.sisterStatus])).toEqual([
      ['F88', 'kept'],
      ['F90', 'replaced'],
    ])
  })

  it('已售出或不在圈的姊妹不變；沒有姊妹時也可以選，暫定保留改為正式保留', async () => {
    const db = await sistersHerd()
    await db.horses.add(ownFoalRow('F85', 1, 5, { sireId: 'S14', damId: 'D24' }))
    await db.mares.add(ownMareRow('F85', 1, 5, { herd: 'sold', sisterStatus: 'kept' }))
    const result = await keepSister(db, GAME, 'F88')
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value.map((mare) => mare.horseId)).toEqual(['F88', 'F90'])
    // 被取代的候選不會因此使該代成立
    expect(await db.mares.get('F90')).toEqual(
      ownMareRow('F90', 1, 5, { sisterStatus: 'replaced', establishedGeneration: false }),
    )
    expect(await db.mares.get('F85')).toMatchObject({ herd: 'sold', sisterStatus: 'kept' })

    // D24 沒有父母紀錄，沒有姊妹
    const alone = await keepSister(db, GAME, 'D24')
    if (alone.status !== 'done') throw new Error(alone.status)
    expect(alone.value).toEqual([ownMareRow('D24', 2, 4, { sisterStatus: 'kept' })])
  })

  it('候選選為正式保留時使該代成立；已是正式保留而沒有姊妹要取代時阻止，什麼都不寫', async () => {
    const db = await sistersHerd()
    await db.mares.update('F88', { herd: 'sold' })
    const result = await keepSister(db, GAME, 'F90')
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value).toEqual([
      ownMareRow('F90', 1, 5, { sisterStatus: 'kept', establishedGeneration: true }),
    ])
    const before = await db.events.count()
    expect(await keepSister(db, GAME, 'F90')).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'unchanged' }],
    })
    expect(await db.events.count()).toBe(before)
  })

  it('母馬找不到、屬於其他局、不在圈內，或不是自家母駒時丟出錯誤', async () => {
    const db = await sistersHerd()
    await addTestGame(db, { id: 'G2' })
    await db.horses.add(horseRow('M', { sex: 'female' }))
    await db.mares.bulkAdd([
      substituteMareRow('M', 2, 4),
      ownMareRow('OTHER', 1, 5, { gameId: 'G2' }),
    ])
    await transferFilly(db, GAME, 'FREE90')
    await db.mares.update('F88', { herd: 'sold' })
    await expect(keepSister(db, GAME, 'X')).rejects.toThrow('找不到母馬：X')
    await expect(keepSister(db, GAME, 'OTHER')).rejects.toThrow('找不到母馬：OTHER')
    // 不在圈內是畫面不會送出的狀況，丟出一般錯誤，不是資料矛盾的 RangeError
    await expect(keepSister(db, GAME, 'F88')).rejects.not.toBeInstanceOf(RangeError)
    await expect(keepSister(db, GAME, 'F88')).rejects.toThrow(
      '不在繁殖圈內的母馬不能選為正式保留：F88',
    )
    await expect(keepSister(db, GAME, 'M')).rejects.toThrow('只有自家母駒有接替狀態：M')
    await expect(keepSister(db, GAME, 'FREE90')).rejects.toThrow('只有自家母駒有接替狀態：FREE90')
  })
})
