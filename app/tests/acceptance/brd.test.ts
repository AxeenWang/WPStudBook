import { describe, expect, it } from 'vitest'
import { verifySuccessor } from '../../src/core/successor'

// 需求規格第 15 章「配種與產駒（BRD）」中由 core 負責的部分；繁殖紀錄、匯入與畫面由後續計畫補上

describe('配種與產駒（BRD）', () => {
  it('BRD-15 自由配種產駒 → 不能選為八系後繼', () => {
    expect(
      verifySuccessor(
        { sireId: 'X', damId: 'D35', origin: { kind: 'free' } },
        { line: 1, generation: 6 },
      ),
    ).toEqual([{ mismatch: 'free-breeding' }])
  })
})
