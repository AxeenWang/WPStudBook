import { describe, expect, it } from 'vitest'
import { addTestGame, testDatabase } from '../../tests/support/database'
import {
  GAME,
  horseRow,
  lineRow,
  ownMareRow,
  restorationRow,
  stallionRow,
  startMareRow,
  substituteMareRow,
} from '../../tests/support/rows'
import { loadMating, loadRuleSnapshot } from './loaders'
import { buildMating } from './mating'

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

describe('loadMating', () => {
  it('一代一代讀到第 4 代，近親重複的馬只讀一次，第 5 代不讀；結果與用全部資料列組出的相同', async () => {
    const db = testDatabase()
    await addTestGame(db)
    const horses = [
      horseRow('S', { sireId: 'X', damId: 'SD' }),
      horseRow('D', { sireId: 'X', damId: 'DD' }),
      horseRow('X', { sireId: 'Z1', damId: 'P1' }),
      horseRow('SD', { sireId: 'Y' }),
      horseRow('DD'),
      horseRow('Z1'),
      horseRow('P1', { sireSystem: 'ハイペリオン' }),
      horseRow('Y', { sireId: 'Y1' }),
      horseRow('Y1', { sireId: 'Y2' }),
    ]
    const lines = [lineRow(1, '系1子')]
    const stallions = [stallionRow('Z1', 1, 0)]
    const mares = [startMareRow('P1')]
    await db.horses.bulkAdd(horses)
    await db.lines.bulkAdd(lines)
    await db.stallions.bulkAdd(stallions)
    await db.mares.bulkAdd(mares)

    const mating = await loadMating(db, GAME, 'S', 'D')
    expect(mating).toEqual(
      buildMating('S', 'D', { horses, stallions, mares, restorations: [], lines }),
    )
    expect(mating.sire!.sire!.horse.id).toBe('X')
    expect(mating.dam!.sire!.horse.id).toBe('X')
    expect(mating.sire!.sire!.sire!.horse).toEqual({
      id: 'Z1',
      sireSystem: '系1子',
      buildPhaseMarket: true,
    })
    expect(await loadMating(db, GAME, undefined, undefined)).toEqual({ sire: null, dam: null })
  })

  it('樹上的馬找不到或屬於其他局時丟出錯誤', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.horses.bulkAdd([horseRow('S', { sireId: 'Q' }), horseRow('Q', { gameId: 'G2' })])
    await expect(loadMating(db, GAME, 'S', undefined)).rejects.toThrow('找不到馬匹：Q')
    await expect(loadMating(db, GAME, undefined, 'missing')).rejects.toThrow('找不到馬匹：missing')
  })
})
