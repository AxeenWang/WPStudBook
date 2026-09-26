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
import {
  loadKnownHorses,
  loadMating,
  loadRuleSnapshot,
  loadSisters,
  loadStallionRecords,
  loadSubstituteMares,
  loadSuccessorCandidate,
  readRuleRows,
  ruleTables,
} from './loaders'
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

  it('任用與母馬資料只讀這一局的', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.horses.bulkAdd([horseRow('S', { sireSystem: 'ハイペリオン' }), horseRow('D')])
    await db.stallions.add(stallionRow('S', 3, 0, { id: 'other-game-post', gameId: 'G2' }))
    await db.mares.add(startMareRow('D', { gameId: 'G2' }))
    expect(await loadMating(db, GAME, 'S', 'D')).toEqual({
      sire: {
        horse: { id: 'S', sireSystem: 'ハイペリオン', buildPhaseMarket: false },
        sire: null,
        dam: null,
      },
      dam: { horse: { id: 'D', buildPhaseMarket: false }, sire: null, dam: null },
    })
  })
})

describe('loadSisters', () => {
  it('讀取這一局同父同母的自家母駒；父母任一方不明時回傳空陣列', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.horses.bulkAdd([
      horseRow('A', { sireId: 'S', damId: 'D' }),
      horseRow('B', { sireId: 'S', damId: 'D' }),
      horseRow('C', { sireId: 'S2', damId: 'D' }),
      horseRow('E', { sireId: 'S', damId: 'D' }),
      horseRow('H', { gameId: 'G2', sireId: 'S', damId: 'D' }),
    ])
    await db.mares.bulkAdd([
      ownMareRow('A', 1, 2),
      ownMareRow('B', 1, 2, { sisterStatus: 'candidate', establishedGeneration: false }),
      ownMareRow('C', 1, 2),
      ownMareRow('H', 1, 2, { gameId: 'G2' }),
    ])
    const sisters = await loadSisters(db, GAME, 'S', 'D')
    expect(sisters.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'A', sireId: 'S', damId: 'D', inHerd: true, status: 'provisional' },
      { id: 'B', sireId: 'S', damId: 'D', inHerd: true, status: 'candidate' },
    ])
    expect(await loadSisters(db, GAME, undefined, 'D')).toEqual([])
    expect(await loadSisters(db, GAME, 'S', undefined)).toEqual([])
  })
})

describe('loadStallionRecords', () => {
  it('一般任用與補公系補入的任用分開讀取', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.horses.bulkAdd([horseRow('A'), horseRow('B'), horseRow('C', { sireId: 'A' })])
    await db.stallions.bulkAdd([
      stallionRow('A', 5, 0),
      stallionRow('B', 5, 0, { restorationId: 'R1' }),
      stallionRow('C', 5, 1),
    ])
    expect(await loadStallionRecords(db, GAME, 5, 0)).toEqual([
      { id: 'A', placement: { line: 5, generation: 0 }, status: 'active' },
    ])
    expect(await loadStallionRecords(db, GAME, 5, 0, 'R1')).toEqual([
      { id: 'B', placement: { line: 5, generation: 0 }, status: 'active' },
    ])
    expect(await loadStallionRecords(db, GAME, 5, 1)).toEqual([
      { id: 'C', placement: { line: 5, generation: 1 }, sireId: 'A', status: 'active' },
    ])
  })
})

describe('loadSuccessorCandidate', () => {
  it('讀取產駒與出生紀錄連結的配種紀錄；沒有配種紀錄時比照自由配種', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.horses.bulkAdd([
      horseRow('F', {
        sireId: 'S',
        damId: 'M',
        birth: { breedingId: 'BR', placement: { line: 1, generation: 5 } },
      }),
      horseRow('P', { sireId: 'S', damId: 'M' }),
    ])
    await db.breedings.add({
      id: 'BR',
      gameId: GAME,
      mareId: 'M',
      year: 1990,
      kind: 'designated',
      sireId: 'S',
      conception: '受胎',
      rule: {
        distance: 1,
        sire: { line: 1, generation: 4 },
        dam: { kind: 'own', line: 2, generation: 4 },
        output: { line: 1, generation: 5 },
      },
    })
    expect(await loadSuccessorCandidate(db, GAME, 'F')).toEqual({
      sireId: 'S',
      damId: 'M',
      origin: {
        kind: 'designated',
        breedingSireId: 'S',
        breedingDamId: 'M',
        sire: { line: 1, generation: 4 },
        dam: { kind: 'own', line: 2, generation: 4 },
        recorded: { line: 1, generation: 5 },
      },
    })
    expect(await loadSuccessorCandidate(db, GAME, 'P')).toEqual({
      sireId: 'S',
      damId: 'M',
      origin: { kind: 'free' },
    })
  })

  it('產駒找不到，或出生紀錄連結的配種紀錄找不到、屬於其他局時丟出錯誤', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.horses.add(horseRow('F', { birth: { breedingId: 'BR' } }))
    await expect(loadSuccessorCandidate(db, GAME, 'missing')).rejects.toThrow('找不到馬匹：missing')
    await expect(loadSuccessorCandidate(db, GAME, 'F')).rejects.toThrow('找不到配種紀錄：BR')
    await db.breedings.add({ id: 'BR', gameId: 'G2', mareId: 'M', year: 1990, kind: 'free' })
    await expect(loadSuccessorCandidate(db, GAME, 'F')).rejects.toThrow('找不到配種紀錄：BR')
  })
})

describe('loadSubstituteMares、loadKnownHorses', () => {
  it('只讀這一局的馬', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.horses.bulkAdd([
      horseRow('A', { sireSystem: 'ハイペリオン', baseName: 'エー' }),
      horseRow('B', { sireSystem: 'ハイペリオン', baseName: 'ビー' }),
      horseRow('H', { gameId: 'G2', sireSystem: 'ハイペリオン', baseName: 'エイチ' }),
    ])
    await db.mares.bulkAdd([
      substituteMareRow('A', 5, 3),
      substituteMareRow('B', 7, 3),
      substituteMareRow('H', 6, 3, { gameId: 'G2' }),
    ])
    expect(await loadSubstituteMares(db, GAME, 3, 'B')).toEqual([
      { forLine: 5, forGeneration: 3, ownSireSystem: 'ハイペリオン' },
    ])
    expect((await loadKnownHorses(db, GAME)).map((horse) => horse.name).sort()).toEqual([
      'エー',
      'ビー',
    ])
  })
})

describe('readRuleRows', () => {
  it('傳入交易已讀的遊戲局時直接使用，不再讀取 games', async () => {
    const db = testDatabase()
    const game = await addTestGame(db)
    const loaded = { ...game, currentYear: 1999 }
    const rows = await db.transaction('r', ruleTables(db), () => readRuleRows(db, GAME, loaded))
    expect(rows.game).toBe(loaded)
    const read = await db.transaction('r', ruleTables(db), () => readRuleRows(db, GAME))
    expect(read.game).toEqual(game)
  })
})
