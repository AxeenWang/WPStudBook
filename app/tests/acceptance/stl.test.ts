import { describe, expect, it } from 'vitest'
import { checkMarketStallionSystem } from '../../src/core/stallions'
import { openLine } from '../../src/storage/line-writes'
import { loadRuleSnapshot } from '../../src/storage/loaders'
import { addTestGame, testDatabase } from '../support/database'
import { GAME } from '../support/rows'
import { lineSystemsOf, systemTableOf } from '../support/systems'

// 需求規格第 15 章「種牡馬匯入（STL）」中由 core 與儲存層寫入負責的部分；匯入與配對由後續計畫補上

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

describe('種牡馬匯入（STL）：儲存層寫入', () => {
  it('STL-17 建立新系時手動建立零代市場種牡馬、未填能力番号 → 可正常開啟分支', async () => {
    const db = testDatabase()
    await addTestGame(db)
    const result = await openLine(db, GAME, {
      line: 1,
      subsystem: 'マンノウォー',
      parentSystem: 'マッチェム',
      color: '#1f77b4',
      stallion: { kind: 'new', horse: { fullName: 'ウォーアドミラル' } },
    })
    expect(result.status).toBe('done')
    const [horse] = await db.horses.toArray()
    expect(horse?.abilityNumber).toBeUndefined()
    expect((await loadRuleSnapshot(db, GAME)).eightLines.lines[0]).toMatchObject({
      opened: true,
      stallions: [{ generation: 0, state: 'active' }],
    })
  })
})
