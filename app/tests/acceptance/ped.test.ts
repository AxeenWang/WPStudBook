import { describe, expect, it } from 'vitest'
import { checkDesignatedBreeding } from '../../src/core/check'
import { pairingOf } from '../support/eight-line'

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
})
