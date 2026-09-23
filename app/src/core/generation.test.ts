import { describe, expect, it } from 'vitest'
import { damGeneration, foalPlacement } from './generation'

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

  it('零代種牡馬配 12 代母馬，產駒承接 13 代', () => {
    expect(
      foalPlacement({ line: 5, generation: 0 }, { kind: 'own', line: 6, generation: 12 }),
    ).toEqual({ line: 5, generation: 13 })
  })
})
