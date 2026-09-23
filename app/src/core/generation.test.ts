import { describe, expect, it } from 'vitest'
import { damGeneration, damPlacement, foalPlacement } from './generation'

describe('damPlacement', () => {
  it('自家母駒計入出生紀錄的系與代數', () => {
    expect(damPlacement({ kind: 'own', line: 3, generation: 5 })).toEqual({
      kind: 'group',
      line: 3,
      generation: 5,
    })
  })

  it('替代母馬計入她替代的系與代數，不是她自己的系', () => {
    expect(damPlacement({ kind: 'substitute', forLine: 2, forGeneration: 4 })).toEqual({
      kind: 'group',
      line: 2,
      generation: 4,
    })
  })

  it('起點母馬計入第 1 系起點母馬群', () => {
    expect(damPlacement({ kind: 'start' })).toEqual({ kind: 'start' })
  })

  it('自家母駒或替代的代數不是 1 以上的整數時丟出錯誤', () => {
    expect(() => damPlacement({ kind: 'own', line: 1, generation: 0 })).toThrow(RangeError)
    expect(() => damPlacement({ kind: 'substitute', forLine: 1, forGeneration: 1.5 })).toThrow(
      RangeError,
    )
  })
})

describe('damGeneration', () => {
  it('自家母駒用出生紀錄的代數', () => {
    expect(damGeneration({ kind: 'own', line: 1, generation: 3 })).toBe(3)
  })

  it('替代母馬以她替代的代數計', () => {
    expect(damGeneration({ kind: 'substitute', forLine: 1, forGeneration: 2 })).toBe(2)
  })

  it('起點母馬為零代', () => {
    expect(damGeneration({ kind: 'start' })).toBe(0)
  })
})

describe('foalPlacement', () => {
  it('系跟父馬所在的系，代數取父母較大者加 1', () => {
    expect(
      foalPlacement({ line: 2, generation: 0 }, { kind: 'own', line: 1, generation: 1 }),
    ).toEqual({ line: 2, generation: 2 })
    expect(
      foalPlacement(
        { line: 1, generation: 1 },
        { kind: 'substitute', forLine: 2, forGeneration: 1 },
      ),
    ).toEqual({ line: 1, generation: 2 })
    expect(foalPlacement({ line: 1, generation: 0 }, { kind: 'start' })).toEqual({
      line: 1,
      generation: 1,
    })
  })

  it('種牡馬或母馬的代數不合理時丟出錯誤', () => {
    expect(() =>
      foalPlacement({ line: 1, generation: -1 }, { kind: 'own', line: 2, generation: 1 }),
    ).toThrow(RangeError)
    expect(() =>
      foalPlacement({ line: 1, generation: 1 }, { kind: 'own', line: 2, generation: 0 }),
    ).toThrow(RangeError)
  })

  it('零代種牡馬配 12 代母馬，產駒承接 13 代', () => {
    expect(
      foalPlacement({ line: 5, generation: 0 }, { kind: 'own', line: 6, generation: 12 }),
    ).toEqual({ line: 5, generation: 13 })
  })
})
