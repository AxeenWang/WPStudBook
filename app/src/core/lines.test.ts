import { describe, expect, it } from 'vitest'
import {
  BRANCHES,
  LINE_POSITIONS,
  PAIRING_TABLE,
  branchOf,
  pairingDistance,
  partnerLine,
  type PairingDistance,
} from './lines'

const DISTANCES: PairingDistance[] = [1, 2, 4]

describe('pairingDistance', () => {
  it('1 代是建系起點，沒有距離', () => {
    expect(pairingDistance(1)).toBeNull()
  })

  it('2～10 代依 1、2、4 輪替', () => {
    expect([2, 3, 4, 5, 6, 7, 8, 9, 10].map(pairingDistance)).toEqual([1, 2, 4, 1, 2, 4, 1, 2, 4])
  })

  it('代數不是 1 以上的整數時丟出錯誤', () => {
    expect(() => pairingDistance(0)).toThrow(RangeError)
    expect(() => pairingDistance(2.5)).toThrow(RangeError)
  })
})

describe('partnerLine', () => {
  it('每個距離都把八系兩兩配成四組，彼此互為配對', () => {
    for (const distance of DISTANCES) {
      expect(PAIRING_TABLE[distance].flat().sort((a, b) => a - b)).toEqual([...LINE_POSITIONS])
      for (const line of LINE_POSITIONS) {
        const partner = partnerLine(line, distance)
        expect(partner).not.toBe(line)
        expect(partnerLine(partner, distance)).toBe(line)
      }
    }
  })

  it('連續三代用距離 1、2、4，每系配到三個不同的系', () => {
    for (const line of LINE_POSITIONS) {
      const partners = DISTANCES.map((distance) => partnerLine(line, distance))
      expect(new Set(partners).size).toBe(3)
    }
  })
})

describe('BRANCHES', () => {
  it('每條分支的原系與新系，就是該代配對距離的同一組配對', () => {
    for (const branch of BRANCHES) {
      if (branch.parent === null) continue
      const distance = pairingDistance(branch.outputGeneration)
      if (distance === null) throw new Error('分支一定有配對距離')
      expect(partnerLine(branch.parent, distance)).toBe(branch.newLine)
    }
  })

  it('每個系位置剛好由一個分支成立', () => {
    expect(BRANCHES.map((branch) => branch.newLine).sort((a, b) => a - b)).toEqual([
      ...LINE_POSITIONS,
    ])
  })

  it('branchOf 找出成立該系的分支', () => {
    expect(branchOf(1)).toEqual({ outputGeneration: 1, parent: null, newLine: 1 })
    expect(branchOf(6)).toEqual({ outputGeneration: 4, parent: 3, newLine: 6 })
    expect(branchOf(7)).toEqual({ outputGeneration: 4, parent: 2, newLine: 7 })
  })
})
