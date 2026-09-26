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
import type { LinePosition } from '../core/lines'
import type { WPStudBookDatabase } from './database'
import { loadGame } from './games'
import { addMarketMare, changeMareUsage } from './mare-writes'
import type { Base } from './records'
import type { NewHorseInput } from './writes'

const now = new Date('2026-09-26T01:02:03.000Z')

/** addTestGame 的建立與更新時間 */
const CREATED_AT = '2026-09-24T00:00:00.000Z'

/** 任務看板上產出第 line 系第 generation 代的配對 */
const pairing = (line: LinePosition, generation: number) => ({
  kind: 'pairing' as const,
  line,
  generation,
})

/**
 * 第 1 系已開啟（マンノウォー，親系統 マッチェム），零代與 1 代種牡馬在崗：
 * 第 2 系的分支可以開啟（產出第 1 系 2 代的推進原系、產出第 2 系 2 代的建立新系）
 */
async function lineOneAtOne(): Promise<WPStudBookDatabase> {
  const db = testDatabase()
  await addTestGame(db)
  await db.lines.add(lineRow(1, 'マンノウォー'))
  await db.systems.add({ gameId: GAME, subsystem: 'マンノウォー', parentSystem: 'マッチェム' })
  await db.stallions.bulkAdd([stallionRow('Z1', 1, 0), stallionRow('S11', 1, 1)])
  return db
}

describe('addMarketMare', () => {
  it('從任務新增：替代配對系的前一代、來源由配對推出；寫入牝馬、在圈的母馬與事件', async () => {
    const db = await lineOneAtOne()
    const result = await addMarketMare(
      db,
      GAME,
      {
        horse: {
          fullName: '(外)ハナカゴ',
          birthYear: 1985,
          sireName: 'ハイペリオン',
          sireSystem: 'ハイペリオン系',
        },
        assignment: pairing(1, 2),
        sourceNote: ' セリ購入 ',
        location: 33,
        exceptionReason: '不是例外補入，不保存',
      },
      { now },
    )
    if (result.status !== 'done') throw new Error(result.status)
    const { horse, mare } = result.value
    expect(result).toEqual({
      status: 'done',
      value: { horse, mare, parentSystemUnknown: true },
      warnings: [],
    })
    expect(horse).toEqual({
      id: horse.id,
      gameId: GAME,
      fullName: '(外)ハナカゴ',
      baseName: 'ハナカゴ',
      nameSource: 'manual',
      birthYear: 1985,
      sex: 'female',
      sireName: 'ハイペリオン',
      sireSystem: 'ハイペリオン',
      pedigreeSource: 'manual',
    })
    expect(mare).toEqual({
      horseId: horse.id,
      gameId: GAME,
      usage: 'substitute',
      groupLine: 2,
      groupGeneration: 1,
      herd: 'in-herd',
      establishedGeneration: false,
      source: { kind: 'market-founding', note: 'セリ購入' },
      location: 33,
    })
    expect(await db.horses.get(horse.id)).toEqual(horse)
    expect(await db.mares.get(horse.id)).toEqual(mare)
    expect(await db.events.toArray()).toEqual([
      {
        id: expect.any(String),
        gameId: GAME,
        year: 1990,
        recordedAt: '2026-09-26T01:02:03.000Z',
        source: { kind: 'manual' },
        kind: 'mare-added',
        horseId: horse.id,
        placement: { usage: 'substitute', groupLine: 2, groupGeneration: 1 },
        mareSource: { kind: 'market-founding', note: 'セリ購入' },
      },
    ])
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-26T01:02:03.000Z')
  })

  it('例外補入：要填原因並確認，確認前什麼都不寫；確認後原因存在母馬與事件（MARE-31）', async () => {
    const db = await lineOneAtOne()
    const input = {
      horse: { fullName: 'ハナカゴ' },
      assignment: pairing(2, 2),
      exceptionReason: ' 自家母駒不足 ',
    }
    expect(await addMarketMare(db, GAME, { ...input, exceptionReason: undefined })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'reason-required' }],
    })
    const warning = { kind: 'exception-entry', line: 2, generation: 2 }
    expect(await addMarketMare(db, GAME, input)).toEqual({
      status: 'unconfirmed',
      warnings: [warning],
    })
    expect(await db.horses.count()).toBe(0)
    expect(await db.mares.count()).toBe(0)
    expect(await db.events.count()).toBe(0)
    expect((await loadGame(db, GAME)).updatedAt).toBe(CREATED_AT)

    const result = await addMarketMare(db, GAME, input, { confirmed: true })
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.warnings).toEqual([warning])
    expect(result.value.mare).toMatchObject({
      usage: 'substitute',
      groupLine: 1,
      groupGeneration: 1,
      exceptionReason: '自家母駒不足',
    })
    expect(await db.events.toArray()).toEqual([
      expect.objectContaining({
        kind: 'mare-added',
        exceptionReason: '自家母駒不足',
        confirmedWarnings: [warning],
      }),
    ])
  })

  it('替代母馬的親系統撞到其他系時要確認；確認後寫入，警告存在事件上', async () => {
    const db = await lineOneAtOne()
    const input = {
      horse: { fullName: 'A', sireSystem: 'マンノウォー' },
      assignment: pairing(1, 2),
    }
    const warning = {
      kind: 'substitute-parent-system',
      line: 2,
      generation: 1,
      conflicts: [{ kind: 'line', parentSystem: 'マッチェム', lines: [1] }],
    }
    expect(await addMarketMare(db, GAME, input)).toEqual({
      status: 'unconfirmed',
      warnings: [warning],
    })
    const result = await addMarketMare(db, GAME, input, { confirmed: true })
    expect(result.status === 'done' && result.value.parentSystemUnknown).toBe(false)
    expect((await db.events.toArray())[0]).toMatchObject({
      kind: 'mare-added',
      confirmedWarnings: [warning],
    })
  })

  it('待指定用途：不屬於任何母馬群，來源由使用者選，省略時為其他（MARE-26）', async () => {
    const db = await lineOneAtOne()
    const crossbreed = await addMarketMare(db, GAME, {
      horse: { fullName: 'A' },
      assignment: { kind: 'unassigned' },
      sourceKind: 'market-crossbreed',
    })
    expect(crossbreed.status === 'done' && crossbreed.value.mare).toEqual({
      horseId: expect.any(String),
      gameId: GAME,
      usage: 'unassigned',
      herd: 'in-herd',
      establishedGeneration: false,
      source: { kind: 'market-crossbreed' },
    })
    const other = await addMarketMare(db, GAME, {
      horse: { fullName: 'B' },
      assignment: { kind: 'unassigned' },
    })
    expect(other.status === 'done' && other.value.mare.source).toEqual({ kind: 'other' })
  })

  it('馬匹的輸入不符、配對不在看板上時阻止，原因一起列出，什麼都不寫', async () => {
    const db = await lineOneAtOne()
    expect(
      await addMarketMare(db, GAME, { horse: { fullName: '(外)' }, assignment: pairing(3, 3) }),
    ).toEqual({ status: 'blocked', blocks: [{ kind: 'horse-name' }, { kind: 'no-pairing' }] })
    expect(await db.horses.count()).toBe(0)
    expect(await db.events.count()).toBe(0)
  })

  it('馬名與已售出的母馬相同、能力番号與出生年不矛盾時，提示可能是買回；確認不是買回後照常建立（MARE-29）', async () => {
    const db = await lineOneAtOne()
    await db.horses.bulkAdd([
      horseRow('A', {
        fullName: 'ハナカゴ',
        baseName: 'ハナカゴ',
        birthYear: 1980,
        abilityNumber: '0x0100',
      }),
      horseRow('B', { fullName: '[地]ハナカゴ', baseName: 'ハナカゴ', birthYear: 1975 }),
      horseRow('C', { fullName: 'ハナカゴ', baseName: 'ハナカゴ' }),
      horseRow('D', { fullName: 'ハナカゴ', baseName: 'ハナカゴ' }),
      horseRow('E', { fullName: 'ハナカゴニ', baseName: 'ハナカゴニ' }),
    ])
    await db.mares.bulkAdd([
      ungroupedMareRow('A', 'unassigned', { herd: 'sold' }),
      ungroupedMareRow('B', 'unassigned', { herd: 'sold' }),
      ungroupedMareRow('C', 'unassigned'),
      ungroupedMareRow('D', 'unassigned', { herd: 'retired' }),
      ungroupedMareRow('E', 'unassigned', { herd: 'sold' }),
    ])
    const add = (horse: NewHorseInput, confirmed = false) =>
      addMarketMare(db, GAME, { horse, assignment: { kind: 'unassigned' } }, { confirmed })
    const buyback = (horseIds: string[]) => ({ kind: 'possible-buyback', horseIds })

    expect(await add({ fullName: '(外)ハナカゴ' })).toEqual({
      status: 'unconfirmed',
      warnings: [buyback(['A', 'B'])],
    })
    expect(await add({ fullName: 'ハナカゴ', birthYear: 1980 })).toEqual({
      status: 'unconfirmed',
      warnings: [buyback(['A'])],
    })
    expect(await add({ fullName: 'ハナカゴ', abilityNumber: '0x0200' })).toEqual({
      status: 'unconfirmed',
      warnings: [buyback(['B'])],
    })
    expect((await add({ fullName: 'ハナカゴ', birthYear: 1985 })).status).toBe('done')
    const confirmed = await add({ fullName: 'ハナカゴ' }, true)
    expect(confirmed.status === 'done' && confirmed.warnings).toEqual([buyback(['A', 'B'])])
    expect(await db.mares.count()).toBe(7)
  })

  it('據點不是 32～35 時丟出錯誤', async () => {
    const db = await lineOneAtOne()
    await expect(
      addMarketMare(db, GAME, {
        horse: { fullName: 'A' },
        assignment: { kind: 'unassigned' },
        location: 36 as Base,
      }),
    ).rejects.toThrow('據點不符：36')
  })
})

describe('changeMareUsage', () => {
  /** lineOneAtOne 再加上待指定用途的市場母馬 U（父系 マンノウォー，來源其他） */
  async function withUnassigned(): Promise<WPStudBookDatabase> {
    const db = await lineOneAtOne()
    await db.horses.add(horseRow('U', { sireSystem: 'ハイペリオン' }))
    await db.mares.add(ungroupedMareRow('U', 'unassigned'))
    return db
  }

  it('待指定用途改掛到配對：用途與所屬母馬群改變，來源不變；事件記原用途與新用途', async () => {
    const db = await withUnassigned()
    const result = await changeMareUsage(db, GAME, 'U', { assignment: pairing(1, 2) }, { now })
    const mare = {
      horseId: 'U',
      gameId: GAME,
      usage: 'substitute',
      groupLine: 2,
      groupGeneration: 1,
      herd: 'in-herd',
      establishedGeneration: false,
      source: { kind: 'other' },
    }
    expect(result).toEqual({
      status: 'done',
      value: { mare, parentSystemUnknown: true },
      warnings: [],
    })
    expect(await db.mares.get('U')).toEqual(mare)
    expect(await db.events.toArray()).toEqual([
      {
        id: expect.any(String),
        gameId: GAME,
        year: 1990,
        recordedAt: '2026-09-26T01:02:03.000Z',
        source: { kind: 'manual' },
        kind: 'mare-usage-changed',
        horseId: 'U',
        from: { usage: 'unassigned' },
        to: { usage: 'substitute', groupLine: 2, groupGeneration: 1 },
      },
    ])
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-26T01:02:03.000Z')
  })

  it('改為待指定用途：清掉所屬母馬群與例外補入的原因', async () => {
    const db = await lineOneAtOne()
    await db.horses.add(horseRow('E'))
    await db.mares.add(substituteMareRow('E', 1, 1, { exceptionReason: '自家母駒不足' }))
    const result = await changeMareUsage(db, GAME, 'E', { assignment: { kind: 'unassigned' } })
    expect(result.status).toBe('done')
    expect(await db.mares.get('E')).toEqual({
      horseId: 'E',
      gameId: GAME,
      usage: 'unassigned',
      herd: 'in-herd',
      establishedGeneration: false,
      source: { kind: 'market-supplement' },
    })
    expect((await db.events.toArray())[0]).toMatchObject({
      from: { usage: 'substitute', groupLine: 1, groupGeneration: 1 },
      to: { usage: 'unassigned' },
    })
  })

  it('改成例外補入：原因必填並要確認；和目前相同時阻止', async () => {
    const db = await withUnassigned()
    const input = { assignment: pairing(2, 2), exceptionReason: ' 自家母駒不足 ' }
    expect(await changeMareUsage(db, GAME, 'U', { assignment: pairing(2, 2) })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'reason-required' }],
    })
    const warning = { kind: 'exception-entry', line: 2, generation: 2 }
    expect(await changeMareUsage(db, GAME, 'U', input)).toEqual({
      status: 'unconfirmed',
      warnings: [warning],
    })
    expect(await db.mares.get('U')).toEqual(ungroupedMareRow('U', 'unassigned'))
    expect(await db.events.count()).toBe(0)

    const result = await changeMareUsage(db, GAME, 'U', input, { confirmed: true })
    expect(result.status === 'done' && result.value.mare.exceptionReason).toBe('自家母駒不足')
    expect((await db.events.toArray())[0]).toMatchObject({
      exceptionReason: '自家母駒不足',
      confirmedWarnings: [warning],
    })
    expect(await changeMareUsage(db, GAME, 'U', input, { confirmed: true })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'unchanged' }],
    })
  })

  it('8.3 以她自己的父系檢查', async () => {
    const db = await lineOneAtOne()
    await db.horses.add(horseRow('U', { sireSystem: 'マンノウォー' }))
    await db.mares.add(ungroupedMareRow('U', 'unassigned'))
    expect(await changeMareUsage(db, GAME, 'U', { assignment: pairing(1, 2) })).toEqual({
      status: 'unconfirmed',
      warnings: [
        {
          kind: 'substitute-parent-system',
          line: 2,
          generation: 1,
          conflicts: [{ kind: 'line', parentSystem: 'マッチェム', lines: [1] }],
        },
      ],
    })
  })

  it('母馬找不到、屬於其他局、是自家母駒或自由配種所生、不在圈內時丟出錯誤', async () => {
    const db = await lineOneAtOne()
    await addTestGame(db, { id: 'G2' })
    await db.horses.bulkAdd([
      horseRow('F'),
      horseRow('R'),
      horseRow('S'),
      horseRow('X', { gameId: 'G2' }),
    ])
    await db.mares.bulkAdd([
      ownMareRow('F', 1, 1),
      ungroupedMareRow('R', 'free'),
      substituteMareRow('S', 2, 1, { herd: 'sold' }),
      ungroupedMareRow('X', 'unassigned', { gameId: 'G2' }),
    ])
    const change = (horseId: string) =>
      changeMareUsage(db, GAME, horseId, { assignment: { kind: 'unassigned' } })
    await expect(change('Q')).rejects.toThrow('找不到母馬：Q')
    await expect(change('X')).rejects.toThrow('找不到母馬：X')
    await expect(change('F')).rejects.toThrow('自家母駒的系與代數由出生紀錄決定，不能修改用途：F')
    await expect(change('R')).rejects.toThrow('自家母駒的系與代數由出生紀錄決定，不能修改用途：R')
    await expect(change('S')).rejects.toThrow('不在繁殖圈內的母馬不能修改用途：S')
  })
})
