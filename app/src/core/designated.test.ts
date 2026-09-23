import { describe, expect, it } from 'vitest'
import { designatedPairing, designatedPairings } from './designated'
import { foalPlacement, type DamRole } from './generation'

describe('designatedPairing', () => {
  it('1 代只有第 1 系起點：零代種牡馬配起點母馬群', () => {
    expect(designatedPairing(1, 1)).toEqual({
      kind: 'start',
      distance: null,
      sire: { line: 1, generation: 0 },
      mares: { kind: 'start' },
      output: { line: 1, generation: 1 },
    })
    expect(designatedPairing(2, 1)).toBeNull()
  })

  it('產出 2 代：推進第 1 系配第 2 系 1 代母馬群，建立第 2 系用零代配第 1 系 1 代母馬群', () => {
    expect(designatedPairing(1, 2)).toEqual({
      kind: 'advance',
      distance: 1,
      sire: { line: 1, generation: 1 },
      mares: { kind: 'group', line: 2, generation: 1 },
      output: { line: 1, generation: 2 },
    })
    expect(designatedPairing(2, 2)).toEqual({
      kind: 'found',
      distance: 1,
      sire: { line: 2, generation: 0 },
      mares: { kind: 'group', line: 1, generation: 1 },
      output: { line: 2, generation: 2 },
    })
  })

  it('第 6 系在 4 代由第 3 系 3 代母馬成立，之前沒有配對', () => {
    expect(designatedPairing(6, 3)).toBeNull()
    expect(designatedPairing(6, 4)).toMatchObject({
      kind: 'found',
      sire: { line: 6, generation: 0 },
      mares: { kind: 'group', line: 3, generation: 3 },
    })
  })

  it('5 代起為循環：第 p 系 N 代種牡馬配配對系 N 代母馬群', () => {
    expect(designatedPairing(5, 5)).toMatchObject({
      kind: 'cycle',
      distance: 1,
      sire: { line: 5, generation: 4 },
      mares: { kind: 'group', line: 7, generation: 4 },
    })
  })
})

describe('designatedPairings', () => {
  it('產出的系數：1 代 1 系、2 代 2 系、3 代 4 系、4 代起 8 系', () => {
    expect([1, 2, 3, 4, 5, 10].map((generation) => designatedPairings(generation).length)).toEqual([
      1, 2, 4, 8, 8, 8,
    ])
  })

  it('依指定配對配種，產駒剛好是預計產出', () => {
    for (let generation = 1; generation <= 10; generation++) {
      for (const pairing of designatedPairings(generation)) {
        const dam: DamRole =
          pairing.mares.kind === 'start'
            ? { kind: 'start' }
            : { kind: 'own', line: pairing.mares.line, generation: pairing.mares.generation }
        expect(foalPlacement(pairing.sire, dam)).toEqual(pairing.output)
      }
    }
  })
})
