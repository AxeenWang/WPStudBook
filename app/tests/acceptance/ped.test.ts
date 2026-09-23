import { describe, expect, it } from 'vitest'
import { checkDesignatedBreeding } from '../../src/core/check'
import { pairingOf } from '../support/eight-line'
import { ancestorSlots, duplicateAncestors } from '../../src/core/pedigree'
import { horseNode, matingWithGrandparents, type GrandparentSpec } from '../support/pedigree'
import { systemTableOf, eightLineSystems, subsystemOfLine } from '../support/systems'
import { checkPedigree, estimateVitality } from '../../src/core/vitality'

// 需求規格第 15 章「血統檢查（PED）」中由 core 負責的部分；活血與 4 代內重複由後續的血統推算計畫補上

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
})
