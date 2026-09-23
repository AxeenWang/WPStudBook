import { describe, expect, it } from 'vitest'
import { verifySuccessor, type DesignatedOrigin, type SuccessorCandidate } from './successor'

/** 第 1 系 5 代現任 S5 × 第 3 系 5 代自家母馬 D35，出生紀錄為第 1 系 6 代 */
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

describe('verifySuccessor', () => {
  it('父母、系與代數都相符時通過', () => {
    expect(verifySuccessor(foal, lineOneSix)).toEqual([])
  })

  it('替代母馬所生，以她替代的代數核對', () => {
    const fromSubstitute: SuccessorCandidate = {
      sireId: 'S1',
      damId: 'M2',
      origin: {
        kind: 'designated',
        breedingSireId: 'S1',
        breedingDamId: 'M2',
        sire: { line: 1, generation: 1 },
        dam: { kind: 'substitute', forLine: 2, forGeneration: 1 },
        recorded: { line: 1, generation: 2 },
      },
    }
    expect(verifySuccessor(fromSubstitute, { line: 1, generation: 2 })).toEqual([])
  })

  it('自由配種所生一律阻止', () => {
    const free: SuccessorCandidate = { sireId: 'X', damId: 'D35', origin: { kind: 'free' } }
    expect(verifySuccessor(free, lineOneSix)).toEqual([{ mismatch: 'free-breeding' }])
  })

  it('產駒記載的父母與配種紀錄不符或不明時阻止', () => {
    expect(verifySuccessor({ ...foal, damId: 'OTHER' }, lineOneSix)).toEqual([
      { mismatch: 'parents' },
    ])
    expect(verifySuccessor({ ...foal, sireId: undefined }, lineOneSix)).toEqual([
      { mismatch: 'parents' },
    ])
  })

  it('出生紀錄的系與代數和規則重算不符時阻止，並指出正確的系與代數', () => {
    const wrongRecord: SuccessorCandidate = {
      ...foal,
      origin: { ...origin, recorded: { line: 1, generation: 5 } },
    }
    expect(verifySuccessor(wrongRecord, { line: 1, generation: 5 })).toEqual([
      { mismatch: 'placement', expected: lineOneSix },
    ])
  })

  it('系與代數算得對、但不是那一代的指定配對時阻止，例如偏離規則配到別系的種牡馬', () => {
    // 實際配到第 2 系 5 代種牡馬：產駒依實際父馬歸第 2 系 6 代，但第 2 系 6 代應配第 4 系 5 代母馬
    const deviated: SuccessorCandidate = {
      sireId: 'T5',
      damId: 'D35',
      origin: {
        ...origin,
        breedingSireId: 'T5',
        sire: { line: 2, generation: 5 },
        recorded: { line: 2, generation: 6 },
      },
    }
    expect(verifySuccessor(deviated, { line: 2, generation: 6 })).toEqual([
      {
        mismatch: 'pairing',
        blocks: [{ side: 'dam', expected: { line: 4, generation: 5 }, mismatches: ['line'] }],
      },
    ])
  })

  it('建立新系時零代種牡馬例外配市場母馬所生，只是警告，核對通過', () => {
    const exception: SuccessorCandidate = {
      sireId: 'Z3',
      damId: 'M12',
      origin: {
        kind: 'designated',
        breedingSireId: 'Z3',
        breedingDamId: 'M12',
        sire: { line: 3, generation: 0 },
        dam: { kind: 'substitute', forLine: 1, forGeneration: 2 },
        recorded: { line: 3, generation: 3 },
      },
    }
    expect(verifySuccessor(exception, { line: 3, generation: 3 })).toEqual([])
  })

  it('出生紀錄那一代該系還沒成立時，沒有可比對的指定配對，阻止', () => {
    // 第 6 系在產出 4 代才成立，產出 2 代沒有指定配對
    const tooEarly: SuccessorCandidate = {
      sireId: 'Z6',
      damId: 'D11',
      origin: {
        kind: 'designated',
        breedingSireId: 'Z6',
        breedingDamId: 'D11',
        sire: { line: 6, generation: 0 },
        dam: { kind: 'own', line: 1, generation: 1 },
        recorded: { line: 6, generation: 2 },
      },
    }
    expect(verifySuccessor(tooEarly, { line: 6, generation: 2 })).toEqual([
      { mismatch: 'pairing', blocks: [] },
    ])
  })

  it('補公系所生，以補公系配對核對', () => {
    // 第 5 系 12 代補公系：零代市場種牡馬 Z5 × 第 1 系 12 代自家母馬 D1，出生紀錄為第 5 系 13 代
    const restoredOrigin: DesignatedOrigin = {
      kind: 'designated',
      breedingSireId: 'Z5',
      breedingDamId: 'D1',
      sire: { line: 5, generation: 0 },
      dam: { kind: 'own', line: 1, generation: 12 },
      recorded: { line: 5, generation: 13 },
      restoration: true,
    }
    const lineFiveThirteen = { line: 5, generation: 13 } as const
    expect(
      verifySuccessor({ sireId: 'Z5', damId: 'D1', origin: restoredOrigin }, lineFiveThirteen),
    ).toEqual([])
    // 規則快照沒有補公系記號時，零代種牡馬不是第 5 系 13 代的指定種牡馬
    const plainOrigin: DesignatedOrigin = { ...restoredOrigin, restoration: false }
    expect(
      verifySuccessor({ sireId: 'Z5', damId: 'D1', origin: plainOrigin }, lineFiveThirteen),
    ).toEqual([
      {
        mismatch: 'pairing',
        blocks: [
          { side: 'sire', expected: { line: 5, generation: 12 }, mismatches: ['generation'] },
        ],
      },
    ])
  })

  it('補公系所生，母馬不是補公系配對指定的母馬群時阻止，指出母馬應在哪個母馬群', () => {
    // 第 5 系補公系配第 1 系 12 代母馬群，這裡誤配第 3 系 12 代母馬，出生紀錄照 8.2 重算仍是第 5 系 13 代
    const mismatchedOrigin: DesignatedOrigin = {
      kind: 'designated',
      breedingSireId: 'Z5',
      breedingDamId: 'D3',
      sire: { line: 5, generation: 0 },
      dam: { kind: 'own', line: 3, generation: 12 },
      recorded: { line: 5, generation: 13 },
      restoration: true,
    }
    expect(
      verifySuccessor(
        { sireId: 'Z5', damId: 'D3', origin: mismatchedOrigin },
        { line: 5, generation: 13 },
      ),
    ).toEqual([
      {
        mismatch: 'pairing',
        blocks: [{ side: 'dam', expected: { line: 1, generation: 12 }, mismatches: ['line'] }],
      },
    ])
  })

  it('補公系記號的斷血代數早於該系成立的代數時，沒有可比對的配對，阻止', () => {
    // 第 6 系在產出 4 代才成立，3 代不能補公系
    const tooEarly: DesignatedOrigin = {
      kind: 'designated',
      breedingSireId: 'Z6',
      breedingDamId: 'D33',
      sire: { line: 6, generation: 0 },
      dam: { kind: 'own', line: 3, generation: 3 },
      recorded: { line: 6, generation: 4 },
      restoration: true,
    }
    expect(
      verifySuccessor({ sireId: 'Z6', damId: 'D33', origin: tooEarly }, { line: 6, generation: 4 }),
    ).toEqual([{ mismatch: 'pairing', blocks: [] }])
  })

  it('要進入的母馬群或接任的位置與出生紀錄不符時阻止', () => {
    expect(verifySuccessor(foal, { line: 1, generation: 7 })).toEqual([
      { mismatch: 'target', expected: lineOneSix },
    ])
    expect(verifySuccessor(foal, { line: 3, generation: 6 })).toEqual([
      { mismatch: 'target', expected: lineOneSix },
    ])
  })
})
