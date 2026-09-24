import { describe, expect, it } from 'vitest'
import { createGame, loadSettings } from '../../src/storage/games'
import { testDatabase } from '../support/database'

// 需求規格第 15 章「資料保存（DATA）」中由儲存層負責的部分；備份、封存與危險區由後續計畫補上

describe('資料保存（DATA）', () => {
  it('DATA-13 新局選擇只複製設定 → 沒有八系位置、馬匹或歷程', async () => {
    const db = testDatabase()
    const source = await createGame(db, { name: '第一局', startYear: 1968 })
    await db.settings.update(source.id, { retirementAge: 24 })
    await db.systems.add({
      gameId: source.id,
      subsystem: 'マンノウォー',
      parentSystem: 'マッチェム',
    })
    await db.lines.add({
      gameId: source.id,
      line: 1,
      subsystem: 'マンノウォー',
      color: '#1f77b4',
      openedYear: 1968,
    })
    await db.horses.add({ id: 'H1', gameId: source.id, baseName: 'テストホース' })

    const copy = await createGame(db, { name: '第二局', startYear: 1980, copyFrom: source.id })
    expect((await loadSettings(db, copy.id)).retirementAge).toBe(24)
    expect(await db.systems.where('gameId').equals(copy.id).count()).toBe(1)
    expect(await db.lines.where('gameId').equals(copy.id).count()).toBe(0)
    expect(await db.horses.where('gameId').equals(copy.id).count()).toBe(0)
  })
})
