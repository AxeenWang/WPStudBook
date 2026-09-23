import { describe, expect, it } from 'vitest'
import { systemTableOf } from '../../tests/support/systems'
import {
  DEFAULT_STALLION_REMINDER_AGE,
  checkBrothers,
  checkMarketStallionSystem,
  chooseIncumbent,
  needsSuccessorReminder,
  type StallionRecord,
} from './stallions'

/** 第 1 系 3 代、父馬 S 的種牡馬 */
const son = (id: string, status?: StallionRecord['status']): StallionRecord => ({
  id,
  placement: { line: 1, generation: 3 },
  sireId: 'S',
  status,
})

describe('checkBrothers', () => {
  it('同系同代的同父兄弟可以選入比較', () => {
    expect(checkBrothers(son('A', 'active'), [son('B')])).toEqual([])
  })

  it('不同系、不同代或不同父時阻止，並指出不符的項目', () => {
    const otherLine = { id: 'C', placement: { line: 2 as const, generation: 3 }, sireId: 'X' }
    const otherGeneration = { id: 'D', placement: { line: 1 as const, generation: 4 }, sireId: 'S' }
    const otherSire = { id: 'E', placement: { line: 1 as const, generation: 3 }, sireId: 'T' }
    expect(checkBrothers(son('A', 'active'), [otherLine, otherGeneration, otherSire])).toEqual([
      { id: 'C', mismatches: ['line', 'sire'] },
      { id: 'D', mismatches: ['generation'] },
      { id: 'E', mismatches: ['sire'] },
    ])
  })

  it('父馬不明時無法確認同父，一律阻止', () => {
    const unknownSire = { id: 'F', placement: { line: 1 as const, generation: 3 } }
    expect(checkBrothers(son('A', 'active'), [unknownSire])).toEqual([
      { id: 'F', mismatches: ['sire'] },
    ])
  })
})

describe('chooseIncumbent', () => {
  it('選定的改為在崗，同系同代原本在崗的改為已被取代', () => {
    expect(chooseIncumbent('B', [son('A', 'active'), son('B')])).toEqual([
      { id: 'B', to: 'active' },
      { id: 'A', from: 'active', to: 'replaced' },
    ])
  })

  it('其他代的在崗種牡馬不變：交接期間上下兩代可同時在崗', () => {
    const father = {
      id: 'S',
      placement: { line: 1 as const, generation: 2 },
      status: 'active' as const,
    }
    expect(chooseIncumbent('B', [father, son('A', 'active'), son('B', 'replaced')])).toEqual([
      { id: 'B', from: 'replaced', to: 'active' },
      { id: 'A', from: 'active', to: 'replaced' },
    ])
  })

  it('選定的已經在崗時沒有變更', () => {
    expect(chooseIncumbent('A', [son('A', 'active'), son('B', 'replaced')])).toEqual([])
  })

  it('還沒接任的種牡馬，變更紀錄沒有 from', () => {
    const [change] = chooseIncumbent('B', [son('A', 'active'), son('B')])
    expect(change).not.toHaveProperty('from')
  })

  it('選定的不存在、已退出生產行列或已引退時丟出錯誤', () => {
    expect(() => chooseIncumbent('X', [son('A', 'active')])).toThrow(RangeError)
    expect(() => chooseIncumbent('A', [son('A', 'withdrawn')])).toThrow(RangeError)
    expect(() => chooseIncumbent('A', [son('A', 'retired')])).toThrow(RangeError)
  })
})

describe('checkMarketStallionSystem', () => {
  const table = systemTableOf([
    ['マンノウォー', 'マッチェム'],
    ['フェアウェイ', 'ファラリス'],
    ['ファラリス', 'ファラリス'],
  ])
  const line = { line: 3 as const, subsystem: 'マンノウォー', parentSystem: 'マッチェム' }

  it('父系與該系目前的子系統相同，或父系不明時不警告', () => {
    expect(checkMarketStallionSystem(line, 'マンノウォー', table)).toEqual({
      subsystem: null,
      parentSystem: null,
    })
    expect(checkMarketStallionSystem(line, undefined, table)).toEqual({
      subsystem: null,
      parentSystem: null,
    })
  })

  it('子系統不同時警告；親系統也不同時一併提示', () => {
    expect(checkMarketStallionSystem(line, 'フェアウェイ', table)).toEqual({
      subsystem: { current: 'マンノウォー', replacement: 'フェアウェイ' },
      parentSystem: { current: 'マッチェム', replacement: 'ファラリス' },
    })
  })

  it('子系統不同但親系統相同時只警告子系統', () => {
    const sameParent = { line: 3 as const, subsystem: 'ファラリス', parentSystem: 'ファラリス' }
    expect(checkMarketStallionSystem(sameParent, 'フェアウェイ', table)).toEqual({
      subsystem: { current: 'ファラリス', replacement: 'フェアウェイ' },
      parentSystem: null,
    })
  })

  it('替換者的子系統沒登錄在對照表時，仍回報親系統不同，讓畫面提示補登', () => {
    expect(checkMarketStallionSystem(line, '未登録の系統', table)).toEqual({
      subsystem: { current: 'マンノウォー', replacement: '未登録の系統' },
      parentSystem: { current: 'マッチェム', replacement: null },
    })
  })
})

describe('needsSuccessorReminder', () => {
  it('預設 26 歲起提醒準備後繼，可調整', () => {
    expect(needsSuccessorReminder(25, DEFAULT_STALLION_REMINDER_AGE)).toBe(false)
    expect(needsSuccessorReminder(26, DEFAULT_STALLION_REMINDER_AGE)).toBe(true)
    expect(needsSuccessorReminder(24, 24)).toBe(true)
  })
})
