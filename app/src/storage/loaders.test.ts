import { describe, expect, it } from 'vitest'
import { addTestGame, testDatabase } from '../../tests/support/database'
import {
  GAME,
  horseRow,
  lineRow,
  ownMareRow,
  restorationRow,
  stallionRow,
  substituteMareRow,
} from '../../tests/support/rows'
import { loadRuleSnapshot } from './loaders'

describe('loadRuleSnapshot', () => {
  it('讀取這一局的系位置、對照表、任用、母馬與補系，組成規則輸入快照', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.lines.bulkAdd([lineRow(1, 'マンノウォー'), lineRow(2, 'ナスルーラ')])
    await db.systems.add({ gameId: GAME, subsystem: 'マンノウォー', parentSystem: 'マッチェム' })
    await db.stallions.bulkAdd([
      stallionRow('Z1', 1, 0),
      stallionRow('Z2', 2, 0, { status: 'retired' }),
    ])
    await db.horses.bulkAdd([
      horseRow('M1', { birthYear: 1985 }),
      horseRow('M2', { birthYear: 1987 }),
    ])
    await db.mares.bulkAdd([ownMareRow('M1', 1, 1), substituteMareRow('M2', 2, 1)])
    await db.restorations.add(restorationRow('R1', 2, 2, 'dam'))

    const snapshot = await loadRuleSnapshot(db, GAME)
    expect(snapshot.systemTable).toEqual([
      { subsystem: 'マンノウォー', parentSystem: 'マッチェム' },
    ])
    expect(snapshot.lineSystems.slice(0, 3)).toEqual([
      { line: 1, subsystem: 'マンノウォー', parentSystem: 'マッチェム' },
      { line: 2, subsystem: 'ナスルーラ', parentSystem: null },
      { line: 3, subsystem: null, parentSystem: null },
    ])
    expect(snapshot.eightLines.lines.slice(0, 3)).toEqual([
      {
        line: 1,
        opened: true,
        stallions: [{ generation: 0, state: 'active' }],
        mareGroups: [{ generation: 1, established: true, activeMares: 1, ownMares: 1 }],
        restorations: [],
      },
      {
        line: 2,
        opened: true,
        stallions: [{ generation: 0, state: 'ended' }],
        mareGroups: [{ generation: 1, established: false, activeMares: 1, ownMares: 0 }],
        restorations: [{ side: 'dam', generation: 2 }],
      },
      { line: 3, opened: false, stallions: [], mareGroups: [], restorations: [] },
    ])
  })

  it('馬齡以目前遊戲年計算，定年取這一局的設定', async () => {
    const db = testDatabase()
    await addTestGame(db, { currentYear: 1990 })
    await db.horses.add(horseRow('M1', { birthYear: 1965 }))
    await db.mares.add(ownMareRow('M1', 1, 1))
    const activeMares = async () =>
      (await loadRuleSnapshot(db, GAME)).eightLines.lines[0]!.mareGroups[0]!.activeMares

    expect(await activeMares()).toBe(0)
    await db.settings.update(GAME, { retirementAge: 26 })
    expect(await activeMares()).toBe(1)
    await db.games.update(GAME, { currentYear: 1991 })
    expect(await activeMares()).toBe(0)
  })

  it('找不到遊戲局、母馬找不到馬匹或馬匹屬於其他局時丟出錯誤', async () => {
    const db = testDatabase()
    await expect(loadRuleSnapshot(db, 'missing')).rejects.toThrow('找不到遊戲局：missing')

    await addTestGame(db)
    await db.mares.add(ownMareRow('M1', 1, 1))
    await expect(loadRuleSnapshot(db, GAME)).rejects.toThrow('找不到馬匹：M1')

    await db.horses.add(horseRow('M1', { gameId: 'G2', birthYear: 1985 }))
    await expect(loadRuleSnapshot(db, GAME)).rejects.toThrow('找不到馬匹：M1')
  })
})
