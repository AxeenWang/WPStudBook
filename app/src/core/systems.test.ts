import { describe, expect, it } from 'vitest'
import { lineSystemsOf, systemTableOf } from '../../tests/support/systems'
import { findParentSystemConflict, originOf, parentSystemOf, summarizeLineSystems } from './systems'

const table = systemTableOf([
  ['マンノウォー', 'マッチェム'],
  ['ノーザンダンサー', 'ノーザンダンサー', 'ネアルコ'],
])

describe('parentSystemOf', () => {
  it('查得到時回傳親系統', () => {
    expect(parentSystemOf(table, 'マンノウォー')).toBe('マッチェム')
  })

  it('沒登錄或沒有子系統時為 null', () => {
    expect(parentSystemOf(table, 'エクリプス')).toBeNull()
    expect(parentSystemOf(table, null)).toBeNull()
  })
})

describe('originOf', () => {
  it('有登錄分出來源時回傳來源，沒登錄時為 null', () => {
    expect(originOf(table, 'ノーザンダンサー')).toBe('ネアルコ')
    expect(originOf(table, 'マンノウォー')).toBeNull()
    expect(originOf(table, null)).toBeNull()
  })
})

describe('summarizeLineSystems', () => {
  it('算出親系統種類數，並列出重複的系', () => {
    const lines = lineSystemsOf({
      1: ['系1子', 'ナスルーラ'],
      2: ['系2子', 'ナスルーラ'],
      3: ['系3子', 'マッチェム'],
    })
    expect(summarizeLineSystems(lines)).toEqual({
      distinctCount: 2,
      duplicates: [{ parentSystem: 'ナスルーラ', lines: [1, 2] }],
    })
  })

  it('尚未開啟的系不計入', () => {
    expect(summarizeLineSystems(lineSystemsOf({}))).toEqual({ distinctCount: 0, duplicates: [] })
  })
})

describe('findParentSystemConflict', () => {
  const lines = lineSystemsOf({ 1: ['系1子', 'ナスルーラ'], 2: ['系2子', 'マッチェム'] })

  it('與其他系的親系統相同時回傳衝突', () => {
    expect(findParentSystemConflict(lines, 3, 'ナスルーラ')).toEqual({
      parentSystem: 'ナスルーラ',
      lines: [1],
    })
  })

  it('沒有重複、或沒有填親系統時為 null', () => {
    expect(findParentSystemConflict(lines, 3, 'エクリプス')).toBeNull()
    expect(findParentSystemConflict(lines, 3, null)).toBeNull()
  })

  it('不跟自己比較', () => {
    expect(findParentSystemConflict(lines, 1, 'ナスルーラ')).toBeNull()
  })
})
