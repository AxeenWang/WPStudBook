import { describe, expect, it } from 'vitest'
import { checkDesignatedBreeding } from '../../src/core/check'
import { pairingOf } from '../support/eight-line'
import { ancestorSlots, duplicateAncestors } from '../../src/core/pedigree'
import { horseNode, matingWithGrandparents, type GrandparentSpec } from '../support/pedigree'
import { systemTableOf, eightLineSystems, subsystemOfLine } from '../support/systems'
import { checkPedigree, estimateVitality } from '../../src/core/vitality'
import { LINE_POSITIONS, type LinePosition } from '../../src/core/lines'
import { buildEightLinePlan } from '../support/eight-line-plan'
import { successorHerd } from '../support/successor'
import { registerBreeding } from '../../src/storage/breeding-writes'
import { transferFilly } from '../../src/storage/own-mare-writes'
import {
  BUILD_PHASE_PEDIGREE,
  buildPhaseHerd,
  cyclePhaseHerd,
  designatedTo,
} from '../support/breeding'
import {
  GAME,
  horseRow,
  ownFoalRow,
  ownMareRow,
  restorationRow,
  stallionRow,
  substituteMareRow,
} from '../support/rows'
import {
  verifySuccessor,
  type DesignatedOrigin,
  type SuccessorCandidate,
} from '../../src/core/successor'

// 需求規格第 15 章「血統檢查（PED）」中由 core 負責的部分；血緣表（10.4，PED-09、10）由後續計畫補上

describe('血統檢查（PED）', () => {
  // 第 1 系 5 代 × 第 3 系 5 代母馬群 → 第 1 系 6 代
  const pairing = pairingOf(1, 6)

  it('PED-06 種牡馬或母馬系別與規則不符時阻止並指出正確的系', () => {
    expect(
      checkDesignatedBreeding(
        pairing,
        { line: 2, generation: 5 },
        { kind: 'own', line: 3, generation: 5 },
      ).blocks,
    ).toEqual([{ side: 'sire', expected: { line: 1, generation: 5 }, mismatches: ['line'] }])
    expect(
      checkDesignatedBreeding(
        pairing,
        { line: 1, generation: 5 },
        { kind: 'own', line: 4, generation: 5 },
      ).blocks,
    ).toEqual([{ side: 'dam', expected: { line: 3, generation: 5 }, mismatches: ['line'] }])
  })

  it('PED-07 種牡馬或母馬代數與規則不符時阻止並指出正確的代數', () => {
    expect(
      checkDesignatedBreeding(
        pairing,
        { line: 1, generation: 4 },
        { kind: 'own', line: 3, generation: 5 },
      ).blocks,
    ).toEqual([{ side: 'sire', expected: { line: 1, generation: 5 }, mismatches: ['generation'] }])
    expect(
      checkDesignatedBreeding(
        pairing,
        { line: 1, generation: 5 },
        { kind: 'own', line: 3, generation: 4 },
      ).blocks,
    ).toEqual([{ side: 'dam', expected: { line: 3, generation: 5 }, mismatches: ['generation'] }])
  })

  it('PED-08 產駒選為正式後繼前 → 再次核對父母、系與代數，不符時阻止', () => {
    // 第 1 系 5 代現任 S5 × 第 3 系 5 代母馬 D35 所生的第 1 系 6 代
    const origin: DesignatedOrigin = {
      kind: 'designated',
      breedingSireId: 'S5',
      breedingDamId: 'D35',
      sire: { line: 1, generation: 5 },
      dam: { kind: 'own', line: 3, generation: 5 },
      recorded: { line: 1, generation: 6 },
    }
    const foal: SuccessorCandidate = { sireId: 'S5', damId: 'D35', origin }
    const lineOneSix = { line: 1, generation: 6 } as const
    expect(verifySuccessor(foal, lineOneSix)).toEqual([])
    // 父母與配種紀錄不符
    expect(verifySuccessor({ ...foal, damId: 'D36' }, lineOneSix)).toEqual([
      { mismatch: 'parents' },
    ])
    // 母馬不是規則指定的系：第 1 系 6 代應配第 3 系 5 代母馬，配到的是第 4 系 5 代母馬
    const wrongLine: SuccessorCandidate = {
      sireId: 'S5',
      damId: 'D45',
      origin: { ...origin, breedingDamId: 'D45', dam: { kind: 'own', line: 4, generation: 5 } },
    }
    expect(verifySuccessor(wrongLine, lineOneSix)).toEqual([
      {
        mismatch: 'pairing',
        blocks: [{ side: 'dam', expected: { line: 3, generation: 5 }, mismatches: ['line'] }],
      },
    ])
    // 要接任的代數與出生紀錄不符
    expect(verifySuccessor(foal, { line: 1, generation: 7 })).toEqual([
      { mismatch: 'target', expected: lineOneSix },
    ])
  })

  it('PED-15 只在第 5 代重複不算 4 代內重複；出現在父母到高祖父母之間兩次以上 → 列為重複', () => {
    const fifth = horseNode('X')
    const chainTo5th = (prefix: string) =>
      horseNode(`${prefix}1`, {
        sire: horseNode(`${prefix}2`, {
          sire: horseNode(`${prefix}3`, { sire: horseNode(`${prefix}4`, { sire: fifth }) }),
        }),
      })
    expect(duplicateAncestors({ sire: chainTo5th('a'), dam: chainTo5th('b') })).toEqual([])

    const shared = horseNode('S')
    const within4 = {
      sire: horseNode('F', { sire: shared }),
      dam: horseNode('M', { sire: horseNode('MF', { sire: shared }) }),
    }
    expect(duplicateAncestors(within4)).toEqual([
      { horse: { id: 'S' }, generations: [2, 3], count: 2 },
    ])
  })

  it('PED-14 零代種牡馬是自己系統的始祖 → 父親依分出來源推定；沒記錄分出來源 → 未知', () => {
    const founder = horseNode('Z', {
      name: 'ノーザンダンサー',
      sireSystem: 'ノーザンダンサー',
      buildPhaseMarket: true,
    })
    const mating = { sire: horseNode('F', { sire: founder }), dam: null }
    const withOrigin = systemTableOf([['ノーザンダンサー', 'ノーザンダンサー', 'ネアルコ']])
    expect(ancestorSlots(mating, withOrigin)[0]).toMatchObject({
      subsystem: 'ネアルコ',
      inferred: true,
      fromBuildPhaseMarket: true,
    })
    const withoutOrigin = systemTableOf([['ノーザンダンサー', 'ノーザンダンサー']])
    expect(ancestorSlots(mating, withoutOrigin)[0]).toMatchObject({
      subsystem: null,
      inferred: false,
    })
  })

  it('PED-01 建系期配種 → 不計算活血，不因市場馬血統不完整警告', () => {
    const { table, lines } = eightLineSystems()
    const marketOnly = matingWithGrandparents([{}, {}, {}, {}])
    expect(checkPedigree(4, marketOnly, table, lines)).toEqual({
      estimate: null,
      duplicates: [],
      warnings: [],
    })
  })

  it('PED-04 循環期 4 代內有重複的馬 → 警告並確認', () => {
    const { table, lines } = eightLineSystems()
    const shared = horseNode('S', { sireSystem: subsystemOfLine(1) })
    const inbred = { sire: horseNode('F', { sire: shared }), dam: horseNode('M', { sire: shared }) }
    expect(checkPedigree(6, inbred, table, lines).warnings).toContainEqual({
      kind: 'close-inbreeding',
      hintOnly: false,
    })
  })

  it('PED-05 血統資料不足 → 警告並確認，不阻止', () => {
    const { table, lines } = eightLineSystems()
    const few = matingWithGrandparents([
      { sire: subsystemOfLine(1), dam: subsystemOfLine(2) },
      { sire: subsystemOfLine(3) },
      {},
      {},
    ])
    const check = checkPedigree(6, few, table, lines)
    expect(check.estimate).toMatchObject({ status: 'insufficient' })
    expect(check.warnings).toEqual([{ kind: 'insufficient-data', hintOnly: false }])
  })

  it('PED-11 未知位置只來自建系期市場馬 → 只提示；含其他未連結的馬 → 仍需確認', () => {
    const { table, lines } = eightLineSystems()
    const buildPhaseOnly: [GrandparentSpec, GrandparentSpec, GrandparentSpec, GrandparentSpec] = [
      { sire: subsystemOfLine(1), dam: subsystemOfLine(2) },
      { sire: subsystemOfLine(3), dam: subsystemOfLine(4) },
      { sireSystem: subsystemOfLine(5), buildPhaseMarket: true },
      { sireSystem: subsystemOfLine(7), buildPhaseMarket: true },
    ]
    expect(checkPedigree(5, matingWithGrandparents(buildPhaseOnly), table, lines).warnings).toEqual(
      [{ kind: 'vitality-below-max', hintOnly: true }],
    )

    const withOtherUnknown: [GrandparentSpec, GrandparentSpec, GrandparentSpec, GrandparentSpec] = [
      buildPhaseOnly[0],
      buildPhaseOnly[1],
      { sireSystem: subsystemOfLine(5) },
      buildPhaseOnly[3],
    ]
    expect(
      checkPedigree(5, matingWithGrandparents(withOtherUnknown), table, lines).warnings,
    ).toEqual([{ kind: 'vitality-below-max', hintOnly: false }])
  })

  it('PED-13 沒有紀錄的父親依市場馬的父系推定並標示推定；沒有紀錄的母親為未知，並列出她決定的還缺的系', () => {
    const { table, lines } = eightLineSystems()
    const mating = matingWithGrandparents([
      { sire: subsystemOfLine(1), dam: subsystemOfLine(2) },
      { sireSystem: subsystemOfLine(5), buildPhaseMarket: true },
      { sire: subsystemOfLine(3), dam: subsystemOfLine(4) },
      { sire: subsystemOfLine(7), dam: subsystemOfLine(8) },
    ])
    const estimate = estimateVitality(mating, table, lines)
    expect(estimate.slots[2]).toMatchObject({
      horse: null,
      subsystem: subsystemOfLine(5),
      parentSystem: '系5親',
      inferred: true,
      fromBuildPhaseMarket: true,
    })
    expect(estimate.slots[3]).toMatchObject({
      subsystem: null,
      parentSystem: null,
      inferred: false,
    })
    expect(estimate).toMatchObject({
      count: 7,
      status: 'at-least',
      unknownSlots: [3],
      missingLines: [6],
    })
  })

  it('PED-02 依 7.3 建系並兩兩互換循環 → 產出 6 代起每系 8 種、無 4 代內重複，不警告', () => {
    const plan = buildEightLinePlan()
    for (const line of LINE_POSITIONS) {
      for (const generation of [6, 7, 8]) {
        const check = checkPedigree(
          generation,
          plan.matingOf(line, generation),
          plan.table,
          plan.lines,
        )
        expect(check.estimate).toMatchObject({
          count: 8,
          status: 'exact',
          established: true,
          missingLines: [],
          unknownSlots: [],
        })
        expect(check.duplicates).toEqual([])
        expect(check.warnings).toEqual([])
      }
    }
  })

  it('PED-12 依 7.3 建系後產出 5 代 → 各系至少 6 種（成立），只剩 2 匹建系期市場馬的母父未知，4 代內沒有重複', () => {
    const plan = buildEightLinePlan()
    const missingByLine: Record<LinePosition, LinePosition[]> = {
      1: [6, 8],
      2: [6, 8],
      5: [6, 8],
      7: [6, 8],
      3: [5, 7],
      4: [5, 7],
      6: [5, 7],
      8: [5, 7],
    }
    for (const line of LINE_POSITIONS) {
      const check = checkPedigree(5, plan.matingOf(line, 5), plan.table, plan.lines)
      expect(check.estimate).toMatchObject({
        count: 6,
        status: 'at-least',
        established: true,
        missingLines: missingByLine[line],
      })
      expect(check.estimate?.unknownSlots).toHaveLength(2)
      expect(check.duplicates).toEqual([])
      expect(check.warnings).toEqual([{ kind: 'vitality-below-max', hintOnly: true }])
    }
  })

  it('PED-03 循環期補入親系統與其他系重複的市場母馬 → 預估低於 8 種，警告並確認', () => {
    // 替代第 6 系 3 代的市場母馬，自身父系屬於第 5 系
    const plan = buildEightLinePlan({
      substituteSubsystem: (line, generation) =>
        line === 6 && generation === 3 ? subsystemOfLine(5) : undefined,
    })
    const check = checkPedigree(6, plan.matingOf(1, 6), plan.table, plan.lines)
    expect(check.estimate).toMatchObject({ count: 7, status: 'exact', missingLines: [6] })
    expect(check.warnings).toEqual([{ kind: 'vitality-below-max', hintOnly: false }])
  })
})

describe('血統檢查（PED）：配種紀錄的寫入', () => {
  it('PED-06 指定配種的母馬系別與規則不符 → 阻止並指出正確的系，不寫入', async () => {
    const db = await buildPhaseHerd()
    // 第 1 系 1 代 × 第 2 系 1 代母馬群 → 第 1 系 2 代，誤選第 1 系 1 代的自家母駒
    expect(await registerBreeding(db, GAME, 'D11', designatedTo(1, 2, 'S11'))).toEqual({
      status: 'blocked',
      blocks: [
        {
          kind: 'rule',
          rule: { side: 'dam', expected: { line: 2, generation: 1 }, mismatches: ['line'] },
        },
      ],
    })
    expect(await db.breedings.count()).toBe(0)
  })

  it('PED-07 指定配種的種牡馬代數與規則不符 → 阻止並指出正確的代數，不寫入', async () => {
    const db = await buildPhaseHerd()
    // 應該用第 1 系 1 代種牡馬，誤選第 1 系零代
    expect(await registerBreeding(db, GAME, 'SUB21', designatedTo(1, 2, 'Z1'))).toEqual({
      status: 'blocked',
      blocks: [
        {
          kind: 'rule',
          rule: { side: 'sire', expected: { line: 1, generation: 1 }, mismatches: ['generation'] },
        },
      ],
    })
    expect(await db.breedings.count()).toBe(0)
  })

  it('PED-16 系與代數相符、但已引退或已被取代的種牡馬 → 阻止；補公系配對選了建系時的零代種牡馬 → 阻止', async () => {
    const db = await buildPhaseHerd()
    await db.stallions.update('S11', { status: 'retired' })
    expect(await registerBreeding(db, GAME, 'SUB21', designatedTo(1, 2, 'S11'))).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'sire-not-active' }],
    })
    await db.restorations.add(restorationRow('R1', 1, 1, 'sire'))
    await db.horses.add(horseRow('ZR', { sex: 'male' }))
    await db.stallions.add(stallionRow('ZR', 1, 0, { restorationId: 'R1' }))
    expect(
      await registerBreeding(db, GAME, 'SUB21', designatedTo(1, 2, 'Z1', '沒有種牡馬')),
    ).toEqual({ status: 'blocked', blocks: [{ kind: 'sire-not-active' }] })
    const result = await registerBreeding(
      db,
      GAME,
      'SUB21',
      designatedTo(1, 2, 'ZR', '沒有種牡馬'),
      {
        confirmed: true,
      },
    )
    expect(result.status).toBe('done')
  })

  it('PED-17 已達定年或已被取代的姊妹 → 不能登記指定配種；登記自由配種不受限', async () => {
    const db = await buildPhaseHerd()
    await db.horses.bulkAdd([
      horseRow('OLD', { sex: 'female', birthYear: 1965 }),
      ownFoalRow('R', 1, 1, { birthYear: 1985 }),
    ])
    await db.mares.bulkAdd([
      substituteMareRow('OLD', 2, 1),
      ownMareRow('R', 1, 1, { sisterStatus: 'replaced' }),
    ])
    expect(await registerBreeding(db, GAME, 'OLD', designatedTo(1, 2, 'S11'))).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'mare-not-listed' }],
    })
    expect(await registerBreeding(db, GAME, 'R', designatedTo(2, 2, 'Z2'))).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'mare-not-listed' }],
    })
    for (const mareId of ['OLD', 'R']) {
      const result = await registerBreeding(db, GAME, mareId, {
        kind: 'free',
        sire: { horseId: 'S11' },
      })
      expect(result.status).toBe('done')
    }
  })

  it('PED-01 建系期的指定配種 → 不計算活血、不警告，規則快照記建系期的結果', async () => {
    const db = await buildPhaseHerd()
    const result = await registerBreeding(db, GAME, 'SUB21', designatedTo(1, 2, 'S11'))
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.warnings).toEqual([])
    expect(result.value.breeding.rule?.pedigree).toEqual(BUILD_PHASE_PEDIGREE)
  })

  it('PED-03 循環期母馬的血統中有親系統與其他系重複的市場母馬 → 預估低於 8 種，警告並確認，確認紀錄存入配種紀錄', async () => {
    // 3 代前的 8 個位置：G0～G3 的父親由他們的父系推定，母親 GD0～GD3 有紀錄；GD3 的父系與 G0 同一個親系統
    const db = await cyclePhaseHerd({
      sire: { sireId: 'G0', damId: 'G1' },
      dam: { sireId: 'G2', damId: 'G3' },
      ancestors: [
        horseRow('G0', { sireSystem: '系1子', damId: 'GD0' }),
        horseRow('GD0', { sireSystem: '系5子' }),
        horseRow('G1', { sireSystem: '系3子', damId: 'GD1' }),
        horseRow('GD1', { sireSystem: '系7子' }),
        horseRow('G2', { sireSystem: '系2子', damId: 'GD2' }),
        horseRow('GD2', { sireSystem: '系6子' }),
        horseRow('G3', { sireSystem: '系4子', damId: 'GD3' }),
        horseRow('GD3', { sireSystem: '系1子' }),
      ],
    })
    const warning = { kind: 'pedigree', warnings: ['vitality-below-max'] }
    expect(await registerBreeding(db, GAME, 'D24', designatedTo(1, 5, 'S14'))).toEqual({
      status: 'unconfirmed',
      warnings: [warning],
    })
    const result = await registerBreeding(db, GAME, 'D24', designatedTo(1, 5, 'S14'), {
      confirmed: true,
    })
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value.breeding).toMatchObject({
      confirmedWarnings: [warning],
      rule: { pedigree: { estimate: { count: 7, status: 'exact', missingLines: [8] } } },
    })
  })

  it('PED-04 循環期父母有同一個父親（4 代內重複的馬）→ 警告並確認，重複的馬存在規則快照', async () => {
    const db = await cyclePhaseHerd({
      sire: { sireId: 'X' },
      dam: { sireId: 'X' },
      ancestors: [horseRow('X', { sex: 'male', sireSystem: '系1子' })],
    })
    const warning = { kind: 'pedigree', warnings: ['insufficient-data', 'close-inbreeding'] }
    expect(await registerBreeding(db, GAME, 'D24', designatedTo(1, 5, 'S14'))).toEqual({
      status: 'unconfirmed',
      warnings: [warning],
    })
    const result = await registerBreeding(db, GAME, 'D24', designatedTo(1, 5, 'S14'), {
      confirmed: true,
    })
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value.breeding.rule?.pedigree.duplicates).toMatchObject([
      { horse: { id: 'X' }, generations: [2], count: 2 },
    ])
  })

  it('PED-05 循環期的血統資料不足 → 警告並確認，確認後可以登記，不阻止', async () => {
    const db = await cyclePhaseHerd()
    expect(await registerBreeding(db, GAME, 'D24', designatedTo(1, 5, 'S14'))).toEqual({
      status: 'unconfirmed',
      warnings: [{ kind: 'pedigree', warnings: ['insufficient-data'] }],
    })
    const result = await registerBreeding(db, GAME, 'D24', designatedTo(1, 5, 'S14'), {
      confirmed: true,
    })
    expect(result.status).toBe('done')
  })

  it('PED-11 產出 5 代的循環配種，資料不足只因含建系期市場馬 → 只提示、不要求確認；含其他未連結的馬 → 仍需確認', async () => {
    // S14 是第 1 系零代 Z1 × 替代第 2 系 3 代 M1 所生，D24 是第 2 系零代 Z2 × 替代第 1 系 3 代 M2 所生
    const pedigree = {
      sire: { sireId: 'Z1', damId: 'M1' },
      dam: { sireId: 'Z2', damId: 'M2' },
      ancestors: [
        horseRow('Z1', { sex: 'male', sireSystem: '系1子' }),
        horseRow('M1', { sex: 'female', sireSystem: '系3子' }),
        horseRow('Z2', { sex: 'male', sireSystem: '系2子' }),
        horseRow('M2', { sex: 'female', sireSystem: '系4子' }),
      ],
    }
    const db = await cyclePhaseHerd(pedigree)
    await db.stallions.bulkAdd([stallionRow('Z1', 1, 0), stallionRow('Z2', 2, 0)])
    await db.mares.bulkAdd([
      substituteMareRow('M1', 2, 3, { herd: 'sold' }),
      substituteMareRow('M2', 1, 3, { herd: 'sold' }),
    ])
    const hinted = await registerBreeding(db, GAME, 'D24', designatedTo(1, 5, 'S14'))
    if (hinted.status !== 'done') throw new Error(hinted.status)
    expect(hinted.warnings).toEqual([])
    expect(hinted.value.breeding.rule?.pedigree.warnings).toEqual([
      { kind: 'insufficient-data', hintOnly: true },
    ])

    // M2 不是建系期的市場馬（沒有母馬資料）：她沒有紀錄的母親不在例外內
    const other = await cyclePhaseHerd(pedigree)
    await other.stallions.bulkAdd([stallionRow('Z1', 1, 0), stallionRow('Z2', 2, 0)])
    await other.mares.add(substituteMareRow('M1', 2, 3, { herd: 'sold' }))
    expect(await registerBreeding(other, GAME, 'D24', designatedTo(1, 5, 'S14'))).toEqual({
      status: 'unconfirmed',
      warnings: [{ kind: 'pedigree', warnings: ['insufficient-data'] }],
    })
  })
})

describe('血統檢查（PED）：後繼與接替的寫入', () => {
  it('PED-08 自家母駒進入母馬群前 → 再次核對父母、系與代數，不符時阻止', async () => {
    const db = await successorHerd()
    await db.horses.update('F88', {
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
  })
})
