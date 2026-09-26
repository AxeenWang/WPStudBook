import { describe, expect, it } from 'vitest'
import { createGame, loadGame, loadSettings, setCurrentYear } from '../../src/storage/games'
import { loadRuleSnapshot } from '../../src/storage/loaders'
import { addTestGame, testDatabase } from '../support/database'
import { GAME, horseRow, lineRow, ownMareRow } from '../support/rows'

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
    for (const table of [db.mares, db.stallions, db.restorations, db.breedings, db.events]) {
      expect(await table.where('gameId').equals(copy.id).count()).toBe(0)
    }
  })

  it('DATA-11 目前遊戲年 → 只由使用者更新，不依電腦日期', async () => {
    const db = testDatabase()
    const game = await createGame(
      db,
      { name: '第一局', startYear: 1968 },
      new Date('2030-01-01T00:00:00.000Z'),
    )
    expect(game.currentYear).toBe(1968)
    expect((await setCurrentYear(db, game.id, 1969)).status).toBe('done')
    expect((await loadGame(db, game.id)).currentYear).toBe(1969)
  })

  it('DATA-17 手動把目前遊戲年往回改 → 不能早於起始年，也不能早於最後一筆紀錄的年份；推進後還沒留下新紀錄時可以改回', async () => {
    const db = testDatabase()
    await addTestGame(db)
    expect((await setCurrentYear(db, GAME, 1991)).status).toBe('done')
    expect((await setCurrentYear(db, GAME, 1990)).status).toBe('done')

    expect((await setCurrentYear(db, GAME, 1991)).status).toBe('done')
    await db.events.add({
      id: 'E1',
      gameId: GAME,
      year: 1991,
      recordedAt: '2026-09-26T00:00:00.000Z',
      kind: 'restoration-revoked',
      line: 1,
      restorationId: 'R1',
    })
    expect(await setCurrentYear(db, GAME, 1990)).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'before-records', earliest: 1991 }],
    })
    expect((await loadGame(db, GAME)).currentYear).toBe(1991)
  })
})
