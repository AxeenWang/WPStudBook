import { describe, expect, it } from 'vitest'
import { foalPlacement } from '../../src/core/generation'
import { BRANCHES, LINE_POSITIONS, pairingDistance, partnerLine } from '../../src/core/lines'
import { describePairing, pairingOf } from '../support/eight-line'

// 需求規格第 15 章「八系管理（LINE）」中由 core 負責的部分；畫面、匯入與儲存的部分由後續計畫補上

describe('八系管理（LINE）', () => {
  it('LINE-08 第 1 系零代 × 起點市場母馬 → 第 1 系 1 代', () => {
    expect(describePairing(pairingOf(1, 1))).toBe('第 1 系 0 代 × 第 1 系起點母馬群 → 第 1 系 1 代')
    expect(foalPlacement({ line: 1, generation: 0 }, { kind: 'start' })).toEqual({
      line: 1,
      generation: 1,
    })
  })

  it('LINE-10 產出 3 代第 1、2 系分出第 3、4 系；產出 4 代第 1、3、2、4 系依序分出第 5～8 系', () => {
    const at = (generation: number) =>
      BRANCHES.filter((branch) => branch.outputGeneration === generation).map((branch) => [
        branch.parent,
        branch.newLine,
      ])
    expect(at(3)).toEqual([
      [1, 3],
      [2, 4],
    ])
    expect(at(4)).toEqual([
      [1, 5],
      [3, 6],
      [2, 7],
      [4, 8],
    ])
  })

  it('LINE-14 循環配對：5 代 1↔2、3↔4、5↔7、6↔8；6 代 1↔3、2↔4、5↔6、7↔8；7 代 1↔5、2↔7、3↔6、4↔8；之後重複', () => {
    const pairsAt = (generation: number): string[] => {
      const distance = pairingDistance(generation)
      if (distance === null) throw new Error('循環期一定有配對距離')
      const pairs = LINE_POSITIONS.map((line) => {
        const partner = partnerLine(line, distance)
        return `${Math.min(line, partner)}↔${Math.max(line, partner)}`
      })
      return [...new Set(pairs)].sort()
    }
    const g5 = ['1↔2', '3↔4', '5↔7', '6↔8']
    const g6 = ['1↔3', '2↔4', '5↔6', '7↔8']
    const g7 = ['1↔5', '2↔7', '3↔6', '4↔8']
    expect([5, 6, 7, 8, 9, 10].map(pairsAt)).toEqual([g5, g6, g7, g5, g6, g7])
  })

  it('LINE-28 代數計算：第 2 系零代 × 第 1 系 1 代母馬 = 第 2 系 2 代；第 1 系 1 代 × 市場母馬 = 第 1 系 2 代', () => {
    expect(
      foalPlacement({ line: 2, generation: 0 }, { kind: 'own', line: 1, generation: 1 }),
    ).toEqual({ line: 2, generation: 2 })
    expect(
      foalPlacement(
        { line: 1, generation: 1 },
        { kind: 'substitute', forLine: 2, forGeneration: 1 },
      ),
    ).toEqual({ line: 1, generation: 2 })
  })
})
