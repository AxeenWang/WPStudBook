import { describe, expect, it } from 'vitest'
import { checkDesignatedBreeding } from '../../src/core/check'
import { pairingOf } from '../support/eight-line'
import { ancestorSlots, duplicateAncestors } from '../../src/core/pedigree'
import { horseNode } from '../support/pedigree'
import { systemTableOf } from '../support/systems'

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
})
