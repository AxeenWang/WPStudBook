import { describe, expect, it } from 'vitest'
import { checkMarketStallionSystem } from '../../src/core/stallions'
import { lineSystemsOf, systemTableOf } from '../support/systems'

// 需求規格第 15 章「種牡馬匯入（STL）」中由 core 負責的部分；匯入、配對與事件由後續計畫補上

describe('種牡馬匯入（STL）', () => {
  it('STL-07 替換種牡馬的子系統與該系不同 → 警告並確認，確認後更新目前子系統名稱', () => {
    const table = systemTableOf([
      ['マンノウォー', 'マッチェム'],
      ['フェアウェイ', 'ファラリス'],
    ])
    const [, , lineThree] = lineSystemsOf({ 3: ['マンノウォー', 'マッチェム'] })
    expect(checkMarketStallionSystem(lineThree, 'フェアウェイ', table).subsystem).toEqual({
      current: 'マンノウォー',
      replacement: 'フェアウェイ',
    })
    expect(checkMarketStallionSystem(lineThree, 'マンノウォー', table).subsystem).toBeNull()
  })
})
