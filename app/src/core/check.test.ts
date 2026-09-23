import { describe, expect, it } from 'vitest'
import { pairingOf } from '../../tests/support/eight-line'
import { checkDesignatedBreeding } from './check'

const clean = { blocks: [], warnings: [] }

describe('checkDesignatedBreeding', () => {
  it('種牡馬與母馬都符合時沒有阻止與警告', () => {
    expect(
      checkDesignatedBreeding(
        pairingOf(1, 6),
        { line: 1, generation: 5 },
        { kind: 'own', line: 3, generation: 5 },
      ),
    ).toEqual(clean)
  })

  it('替代同一系同一代的市場母馬也符合', () => {
    expect(
      checkDesignatedBreeding(
        pairingOf(1, 6),
        { line: 1, generation: 5 },
        { kind: 'substitute', forLine: 3, forGeneration: 5 },
      ),
    ).toEqual(clean)
  })

  it('推進原系配替代母馬是正常流程，不警告', () => {
    expect(
      checkDesignatedBreeding(
        pairingOf(1, 2),
        { line: 1, generation: 1 },
        { kind: 'substitute', forLine: 2, forGeneration: 1 },
      ),
    ).toEqual(clean)
  })

  it('種牡馬的系與代數都不符時一起指出', () => {
    expect(
      checkDesignatedBreeding(
        pairingOf(1, 6),
        { line: 2, generation: 4 },
        { kind: 'own', line: 3, generation: 5 },
      ).blocks,
    ).toEqual([
      { side: 'sire', expected: { line: 1, generation: 5 }, mismatches: ['line', 'generation'] },
    ])
  })

  it('八系以外的種牡馬被阻止', () => {
    expect(
      checkDesignatedBreeding(pairingOf(1, 6), null, { kind: 'own', line: 3, generation: 5 })
        .blocks,
    ).toEqual([{ side: 'sire', expected: { line: 1, generation: 5 }, mismatches: ['role'] }])
  })

  it('待指定用途或起點用的母馬不能用在一般母馬群', () => {
    for (const dam of [{ kind: 'unassigned' }, { kind: 'start' }] as const) {
      expect(
        checkDesignatedBreeding(pairingOf(1, 6), { line: 1, generation: 5 }, dam).blocks,
      ).toEqual([{ side: 'dam', expected: { line: 3, generation: 5 }, mismatches: ['role'] }])
    }
  })

  it('建系起點只接受起點母馬，而且不需要確認', () => {
    const start = pairingOf(1, 1)
    expect(checkDesignatedBreeding(start, { line: 1, generation: 0 }, { kind: 'start' })).toEqual(
      clean,
    )
    expect(
      checkDesignatedBreeding(
        start,
        { line: 1, generation: 0 },
        { kind: 'substitute', forLine: 2, forGeneration: 1 },
      ).blocks,
    ).toEqual([{ side: 'dam', expected: 'start', mismatches: ['role'] }])
  })

  it('零代種牡馬配替代母馬時警告並要求確認；配自家母馬不警告', () => {
    const found = pairingOf(3, 3)
    expect(
      checkDesignatedBreeding(
        found,
        { line: 3, generation: 0 },
        { kind: 'substitute', forLine: 1, forGeneration: 2 },
      ),
    ).toEqual({ blocks: [], warnings: [{ kind: 'zero-sire-market-mare' }] })
    expect(
      checkDesignatedBreeding(
        found,
        { line: 3, generation: 0 },
        { kind: 'own', line: 1, generation: 2 },
      ),
    ).toEqual(clean)
  })
})
