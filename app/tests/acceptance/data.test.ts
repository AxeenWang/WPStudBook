import { describe, expect, it } from 'vitest'
import { createGame, loadSettings } from '../../src/storage/games'
import { loadRuleSnapshot } from '../../src/storage/loaders'
import { addTestGame, testDatabase } from '../support/database'
import { horseRow, lineRow, ownMareRow } from '../support/rows'

// 需求規格第 15 章「資料保存（DATA）」中由儲存層負責的部分；備份、封存與危險區由後續計畫補上

describe('資料保存（DATA）', () => {
  it('DATA-08 兩個遊戲局有相同馬名、年份與父母 → 完全隔離，只影響目前局', async () => {
    const db = testDatabase()
    for (const gameId of ['G1', 'G2']) {
      await addTestGame(db, { id: gameId })
      await db.lines.add(lineRow(1, 'マンノウォー', { gameId }))
      await db.horses.add(
        horseRow(`${gameId}-M`, {
          gameId,
          baseName: '同名の馬',
          birthYear: 1985,
          sireName: '同じ父',
          damName: '同じ母',
        }),
      )
      await db.mares.add(ownMareRow(`${gameId}-M`, 1, 1, { gameId }))
    }
    await db.mares.update('G1-M', { herd: 'sold', sisterStatus: 'sold' })

    const groupsOf = async (gameId: string) =>
      (await loadRuleSnapshot(db, gameId)).eightLines.lines[0]!.mareGroups
    expect(await groupsOf('G1')).toEqual([
      { generation: 1, established: true, activeMares: 0, ownMares: 0 },
    ])
    expect(await groupsOf('G2')).toEqual([
      { generation: 1, established: true, activeMares: 1, ownMares: 1 },
    ])
  })
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
