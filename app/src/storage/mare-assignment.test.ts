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
import type { LinePosition } from '../core/lines'
import type { WPStudBookDatabase } from './database'
import { readRuleRows, ruleTables, type RuleRows } from './loaders'
import { assertBase, resolveAssignment } from './mare-assignment'
import type { Base } from './records'

/** 在唯讀交易內讀取規則輸入的資料列 */
function rowsOf(db: WPStudBookDatabase): Promise<RuleRows> {
  return db.transaction('r', ruleTables(db), () => readRuleRows(db, GAME))
}

/** 任務看板上產出第 line 系第 generation 代的配對 */
const pairing = (line: LinePosition, generation: number) => ({
  kind: 'pairing' as const,
  line,
  generation,
})

/**
 * 第 1 系已開啟（マンノウォー，親系統 マッチェム），零代種牡馬 Z1 在崗：只有建系起點的任務。
 * 對照表另有 ネアルコ 與 フェアウェイ，親系統都是 ファラリス
 */
async function lineOne(): Promise<WPStudBookDatabase> {
  const db = testDatabase()
  await addTestGame(db)
  await db.lines.add(lineRow(1, 'マンノウォー'))
  await db.systems.bulkAdd([
    { gameId: GAME, subsystem: 'マンノウォー', parentSystem: 'マッチェム' },
    { gameId: GAME, subsystem: 'ネアルコ', parentSystem: 'ファラリス' },
    { gameId: GAME, subsystem: 'フェアウェイ', parentSystem: 'ファラリス' },
  ])
  await db.stallions.add(stallionRow('Z1', 1, 0))
  return db
}

/** lineOne 再加上第 1 系 1 代種牡馬 S11：第 2 系的分支可以開啟（產出第 1 系 2 代與第 2 系 2 代） */
async function lineOneAtOne(): Promise<WPStudBookDatabase> {
  const db = await lineOne()
  await db.stallions.add(stallionRow('S11', 1, 1))
  return db
}

/** 第 1 系與第 5 系已開啟，第 1 系 12 代種牡馬在崗 */
async function cycleThirteen(): Promise<WPStudBookDatabase> {
  const db = testDatabase()
  await addTestGame(db)
  await db.lines.bulkAdd([lineRow(1, 'マンノウォー'), lineRow(5, 'ハイペリオン')])
  await db.stallions.add(stallionRow('S112', 1, 12))
  return db
}

describe('resolveAssignment', () => {
  it('待指定用途：不屬於任何母馬群，來源由使用者選，不做 8.3 檢查', async () => {
    const db = await lineOne()
    expect(resolveAssignment(await rowsOf(db), { kind: 'unassigned' }, {}, ' 理由 ')).toEqual({
      ok: true,
      value: {
        placement: { usage: 'unassigned' },
        sourceKind: null,
        warnings: [],
        parentSystemUnknown: false,
      },
    })
  })

  it('建系起點：第 1 系起點用（第 1 系 0 代）、市場創系，不是例外補入，不做 8.3 檢查', async () => {
    const db = await lineOne()
    expect(resolveAssignment(await rowsOf(db), pairing(1, 1), {}, '不保存')).toEqual({
      ok: true,
      value: {
        placement: { usage: 'start', groupLine: 1, groupGeneration: 0 },
        sourceKind: 'market-founding',
        warnings: [],
        parentSystemUnknown: false,
      },
    })
  })

  it('推進原系（可開啟但尚未開啟的分支）：替代配對系的前一代、市場創系；父系查不到親系統時只提示', async () => {
    const db = await lineOneAtOne()
    expect(
      resolveAssignment(await rowsOf(db), pairing(1, 2), { sireSystem: 'ハイペリオン' }, undefined),
    ).toEqual({
      ok: true,
      value: {
        placement: { usage: 'substitute', groupLine: 2, groupGeneration: 1 },
        sourceKind: 'market-founding',
        warnings: [],
        parentSystemUnknown: true,
      },
    })
  })

  it('建立新系的零代種牡馬配對底下是例外補入：原因必填，去掉前後空白後保存，並要確認（MARE-31）', async () => {
    const db = await lineOneAtOne()
    const rows = await rowsOf(db)
    const reasonRequired = { ok: false, blocks: [{ kind: 'reason-required' }] }
    expect(resolveAssignment(rows, pairing(2, 2), {}, undefined)).toEqual(reasonRequired)
    expect(resolveAssignment(rows, pairing(2, 2), {}, ' ')).toEqual(reasonRequired)
    expect(
      resolveAssignment(rows, pairing(2, 2), { sireSystem: 'マンノウォー' }, ' 自家母駒不足 '),
    ).toEqual({
      ok: true,
      value: {
        placement: { usage: 'substitute', groupLine: 1, groupGeneration: 1 },
        sourceKind: 'market-founding',
        exceptionReason: '自家母駒不足',
        warnings: [{ kind: 'exception-entry', line: 2, generation: 2 }],
        parentSystemUnknown: false,
      },
    })
  })

  it('循環任務為市場補血；配對的母馬群已宣告補母系時為市場補系，已撤銷、別代、別系或補公系的宣告不算', async () => {
    const db = await cycleThirteen()
    await db.horses.add(horseRow('F', { birthYear: 1985 }))
    await db.mares.add(ownMareRow('F', 5, 12))
    const sourceOf = async () => {
      const resolved = resolveAssignment(await rowsOf(db), pairing(1, 13), {}, undefined)
      if (!resolved.ok) throw new Error('配對應該在看板上')
      return resolved.value
    }
    expect(await sourceOf()).toMatchObject({
      placement: { usage: 'substitute', groupLine: 5, groupGeneration: 12 },
      sourceKind: 'market-supplement',
    })

    await db.restorations.bulkAdd([
      restorationRow('R1', 5, 12, 'dam', { revoked: true }),
      restorationRow('R2', 5, 11, 'dam'),
      restorationRow('R3', 1, 12, 'dam'),
      restorationRow('R4', 5, 12, 'sire'),
    ])
    expect((await sourceOf()).sourceKind).toBe('market-supplement')

    await db.restorations.add(restorationRow('R5', 5, 12, 'dam'))
    expect((await sourceOf()).sourceKind).toBe('market-restoration')
  })

  it('補公系配對：例外補入、市場補系，替代原本指定的配對系母馬群', async () => {
    const db = await cycleThirteen()
    await db.stallions.add(stallionRow('S512', 5, 12, { status: 'retired' }))
    await db.restorations.add(restorationRow('R1', 5, 12, 'sire'))
    expect(resolveAssignment(await rowsOf(db), pairing(5, 13), {}, '母駒不足')).toEqual({
      ok: true,
      value: {
        placement: { usage: 'substitute', groupLine: 1, groupGeneration: 12 },
        sourceKind: 'market-restoration',
        exceptionReason: '母駒不足',
        warnings: [{ kind: 'exception-entry', line: 5, generation: 13 }],
        parentSystemUnknown: true,
      },
    })
  })

  it('配對不在任務看板上時阻止', async () => {
    const db = await lineOne()
    const rows = await rowsOf(db)
    const noPairing = { ok: false, blocks: [{ kind: 'no-pairing' }] }
    expect(resolveAssignment(rows, pairing(1, 2), {}, undefined)).toEqual(noPairing)
    expect(resolveAssignment(rows, pairing(3, 3), {}, '理由')).toEqual(noPairing)
  })

  it('8.3：親系統與第 q 系以外已開啟的系、或同代替代其他系的母馬相同時警告；不和自己比較', async () => {
    const db = await lineOneAtOne()
    await db.horses.add(horseRow('X', { sireSystem: 'フェアウェイ' }))
    await db.mares.add(substituteMareRow('X', 3, 1))
    const rows = await rowsOf(db)
    expect(
      resolveAssignment(rows, pairing(1, 2), { sireSystem: 'マンノウォー' }, undefined),
    ).toMatchObject({
      ok: true,
      value: {
        warnings: [
          {
            kind: 'substitute-parent-system',
            line: 2,
            generation: 1,
            conflicts: [{ kind: 'line', parentSystem: 'マッチェム', lines: [1] }],
          },
        ],
        parentSystemUnknown: false,
      },
    })
    expect(
      resolveAssignment(rows, pairing(1, 2), { sireSystem: 'ネアルコ' }, undefined),
    ).toMatchObject({
      ok: true,
      value: {
        warnings: [
          {
            kind: 'substitute-parent-system',
            line: 2,
            generation: 1,
            conflicts: [{ kind: 'substitute', parentSystem: 'ファラリス', lines: [3] }],
          },
        ],
      },
    })
    expect(
      resolveAssignment(
        rows,
        pairing(1, 2),
        { horseId: 'X', sireSystem: 'フェアウェイ' },
        undefined,
      ),
    ).toMatchObject({ ok: true, value: { warnings: [], parentSystemUnknown: false } })
    expect(resolveAssignment(rows, pairing(1, 2), {}, undefined)).toMatchObject({
      ok: true,
      value: { warnings: [], parentSystemUnknown: true },
    })
  })
})

describe('assertBase', () => {
  it('據點要是 32～35；其他值丟出錯誤', () => {
    for (const base of [32, 33, 34, 35] as const) expect(() => assertBase(base)).not.toThrow()
    expect(() => assertBase(31 as Base)).toThrow('據點不符：31')
    expect(() => assertBase(36 as Base)).toThrow('據點不符：36')
  })
})
