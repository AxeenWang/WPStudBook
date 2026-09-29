import { describe, expect, it } from 'vitest'
import { addTestGame, testDatabase } from '../../tests/support/database'
import { addSampleGame } from '../../tests/support/game-data'
import { GAME, horseRow } from '../../tests/support/rows'
import { countRows, readGameData } from './game-data'
import {
  DEFAULT_SETTINGS,
  DELETE_ALL_PHRASE,
  createGame,
  currentGameId,
  deleteAllGames,
  deleteGame,
  listGames,
  loadGame,
  loadSettings,
  recordBackup,
  setCurrentGame,
  setCurrentYear,
  updateSettings,
} from './games'
import { APP_VERSION } from './version'

describe('createGame', () => {
  it('全新空白的局：目前遊戲年從起始年開始，設定為預設值，沒有系統對照表', async () => {
    const db = testDatabase()
    const now = new Date('2026-09-24T01:02:03.000Z')
    const game = await createGame(db, { name: '  第一局  ', startYear: 1968 }, now)
    expect(game).toEqual({
      id: game.id,
      name: '第一局',
      startYear: 1968,
      currentYear: 1968,
      createdAt: '2026-09-24T01:02:03.000Z',
      updatedAt: '2026-09-24T01:02:03.000Z',
      appVersion: APP_VERSION,
    })
    expect(await loadGame(db, game.id)).toEqual(game)
    expect(await loadSettings(db, game.id)).toEqual({
      gameId: game.id,
      retirementAge: 25,
      seniorAge: 18,
      stallionReminderAge: 26,
    })
    expect(await db.systems.where('gameId').equals(game.id).count()).toBe(0)
  })

  it('預設設定：定年 25、高齡提醒 18、種牡馬提醒 26 歲', () => {
    expect(DEFAULT_SETTINGS).toEqual({ retirementAge: 25, seniorAge: 18, stallionReminderAge: 26 })
  })

  it('只複製另一局的系統對照表與設定，不複製八系位置與馬匹', async () => {
    const db = testDatabase()
    const source = await createGame(db, { name: '第一局', startYear: 1968 })
    await db.settings.update(source.id, { retirementAge: 24, seniorAge: 20 })
    await db.systems.bulkAdd([
      { gameId: source.id, subsystem: 'マンノウォー', parentSystem: 'マッチェム' },
      {
        gameId: source.id,
        subsystem: 'ノーザンダンサー',
        parentSystem: 'ノーザンダンサー',
        origin: 'ニアークティック',
      },
    ])
    await db.lines.add({
      gameId: source.id,
      line: 1,
      subsystem: 'マンノウォー',
      color: '#1f77b4',
      openedYear: 1968,
    })
    await db.horses.add({ id: 'H1', gameId: source.id, baseName: 'テストホース' })

    const copy = await createGame(db, { name: '第二局', startYear: 1980, copyFrom: source.id })
    expect(copy.currentYear).toBe(1980)
    expect(await loadSettings(db, copy.id)).toEqual({
      gameId: copy.id,
      retirementAge: 24,
      seniorAge: 20,
      stallionReminderAge: 26,
    })
    expect(await db.systems.where('gameId').equals(copy.id).sortBy('subsystem')).toEqual([
      {
        gameId: copy.id,
        subsystem: 'ノーザンダンサー',
        parentSystem: 'ノーザンダンサー',
        origin: 'ニアークティック',
      },
      { gameId: copy.id, subsystem: 'マンノウォー', parentSystem: 'マッチェム' },
    ])
    expect(await db.lines.where('gameId').equals(copy.id).count()).toBe(0)
    expect(await db.horses.where('gameId').equals(copy.id).count()).toBe(0)
    expect(await db.systems.where('gameId').equals(source.id).count()).toBe(2)
  })

  it('局名空白或起始年不是整數時丟出錯誤', async () => {
    const db = testDatabase()
    await expect(createGame(db, { name: '  ', startYear: 1968 })).rejects.toThrow(RangeError)
    await expect(createGame(db, { name: '第一局', startYear: 1968.5 })).rejects.toThrow(RangeError)
    expect(await db.games.count()).toBe(0)
  })

  it('要複製的局不存在時丟出錯誤，也不建立新局', async () => {
    const db = testDatabase()
    await expect(
      createGame(db, { name: '第二局', startYear: 1980, copyFrom: 'missing' }),
    ).rejects.toThrow('找不到遊戲局：missing')
    expect(await db.games.count()).toBe(0)
    expect(await db.settings.count()).toBe(0)
  })
})

describe('listGames', () => {
  it('依建立時間排序', async () => {
    const db = testDatabase()
    const later = await createGame(
      db,
      { name: '後建立', startYear: 1970 },
      new Date('2026-09-24T02:00:00.000Z'),
    )
    const earlier = await createGame(
      db,
      { name: '先建立', startYear: 1968 },
      new Date('2026-09-24T01:00:00.000Z'),
    )
    expect((await listGames(db)).map((game) => game.id)).toEqual([earlier.id, later.id])
  })
})

describe('loadGame、loadSettings', () => {
  it('找不到時丟出錯誤', async () => {
    const db = testDatabase()
    await expect(loadGame(db, 'missing')).rejects.toThrow('找不到遊戲局：missing')
    await expect(loadSettings(db, 'missing')).rejects.toThrow('找不到遊戲局的設定：missing')
  })
})

describe('currentGameId、setCurrentGame', () => {
  it('還沒選過時為 undefined，切換後讀回同一局', async () => {
    const db = testDatabase()
    expect(await currentGameId(db)).toBeUndefined()
    const first = await createGame(db, { name: '第一局', startYear: 1968 })
    const second = await createGame(db, { name: '第二局', startYear: 1980 })
    await setCurrentGame(db, first.id)
    expect(await currentGameId(db)).toBe(first.id)
    await setCurrentGame(db, second.id)
    expect(await currentGameId(db)).toBe(second.id)
  })

  it('切換到不存在的局時丟出錯誤，目前遊戲局不變', async () => {
    const db = testDatabase()
    const game = await createGame(db, { name: '第一局', startYear: 1968 })
    await setCurrentGame(db, game.id)
    await expect(setCurrentGame(db, 'missing')).rejects.toThrow('找不到遊戲局：missing')
    expect(await currentGameId(db)).toBe(game.id)
  })
})

describe('setCurrentYear', () => {
  const now = new Date('2026-09-26T01:02:03.000Z')

  it('往後可以改成任何年份：更新目前遊戲年與更新時間，不寫事件', async () => {
    const db = testDatabase()
    const game = await addTestGame(db)
    const updated = { ...game, currentYear: 1995, updatedAt: '2026-09-26T01:02:03.000Z' }
    expect(await setCurrentYear(db, GAME, 1995, { now })).toEqual({
      status: 'done',
      value: updated,
      warnings: [],
    })
    expect(await loadGame(db, GAME)).toEqual(updated)
    expect(await db.events.count()).toBe(0)
  })

  it('應用版本改為目前版本', async () => {
    const db = testDatabase()
    await addTestGame(db, { appVersion: '0.0.0-old' })
    const result = await setCurrentYear(db, GAME, 1995, { now })
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value.appVersion).toBe(APP_VERSION)
    expect(await loadGame(db, GAME)).toEqual(result.value)
  })

  it('和目前相同時不寫入，更新時間不變', async () => {
    const db = testDatabase()
    const game = await addTestGame(db)
    expect(await setCurrentYear(db, GAME, 1990, { now })).toEqual({
      status: 'done',
      value: game,
      warnings: [],
    })
    expect(await loadGame(db, GAME)).toEqual(game)
  })

  it('往回不能早於最後紀錄年：這一局事件的最大年份與馬的最大出生年（需求規格 12.1）', async () => {
    const db = testDatabase()
    const game = await addTestGame(db)
    await addTestGame(db, { id: 'G2' })
    await db.horses.bulkAdd([
      horseRow('H1', { birthYear: 1985 }),
      horseRow('H2', { gameId: 'G2', birthYear: 1989 }),
    ])
    await db.events.add({
      id: 'E2',
      gameId: 'G2',
      year: 1989,
      recordedAt: '2026-09-26T00:00:00.000Z',
      source: { kind: 'manual' },
      kind: 'line-subsystem-changed',
      line: 1,
      from: 'A',
      to: 'B',
    })
    expect(await setCurrentYear(db, GAME, 1984, { now })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'before-records', earliest: 1985 }],
    })
    expect(await loadGame(db, GAME)).toEqual(game)

    await db.events.add({
      id: 'E1',
      gameId: GAME,
      year: 1987,
      recordedAt: '2026-09-26T00:00:00.000Z',
      source: { kind: 'manual' },
      kind: 'line-subsystem-changed',
      line: 1,
      from: 'A',
      to: 'B',
    })
    expect(await setCurrentYear(db, GAME, 1986, { now })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'before-records', earliest: 1987 }],
    })
    expect((await setCurrentYear(db, GAME, 1987, { now })).status).toBe('done')
    expect((await loadGame(db, GAME)).currentYear).toBe(1987)
  })

  it('沒有任何紀錄時，往回不能早於起始年', async () => {
    const db = testDatabase()
    await addTestGame(db)
    expect(await setCurrentYear(db, GAME, 1967, { now })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'before-records', earliest: 1968 }],
    })
    expect((await setCurrentYear(db, GAME, 1968, { now })).status).toBe('done')
  })

  it('年份不是整數時阻止；遊戲局不存在時丟出錯誤', async () => {
    const db = testDatabase()
    await addTestGame(db)
    expect(await setCurrentYear(db, GAME, 1990.5, { now })).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'not-integer' }],
    })
    await expect(setCurrentYear(db, 'missing', 1990)).rejects.toThrow('找不到遊戲局：missing')
  })
})

describe('updateSettings', () => {
  const now = new Date('2026-09-26T01:02:03.000Z')

  it('只改有填的欄位，更新時間設為現在，不寫事件', async () => {
    const db = testDatabase()
    await addTestGame(db)
    const result = await updateSettings(db, GAME, { retirementAge: 24 }, { now })
    const expected = { gameId: GAME, ...DEFAULT_SETTINGS, retirementAge: 24 }
    expect(result).toEqual({ status: 'done', value: expected, warnings: [] })
    expect(await loadSettings(db, GAME)).toEqual(expected)
    expect((await loadGame(db, GAME)).updatedAt).toBe('2026-09-26T01:02:03.000Z')
    expect(await db.events.count()).toBe(0)
  })

  it('不是 1 以上的整數時阻止，列出每一個不符的欄位，設定不變', async () => {
    const db = testDatabase()
    await addTestGame(db)
    const result = await updateSettings(db, GAME, {
      retirementAge: 0,
      seniorAge: 18.5,
      stallionReminderAge: 26,
    })
    expect(result).toEqual({
      status: 'blocked',
      blocks: [
        { kind: 'not-positive-integer', field: 'retirementAge' },
        { kind: 'not-positive-integer', field: 'seniorAge' },
      ],
    })
    expect(await loadSettings(db, GAME)).toEqual({ gameId: GAME, ...DEFAULT_SETTINGS })
  })

  it('沒有變更時不寫入，更新時間不變', async () => {
    const db = testDatabase()
    const game = await addTestGame(db)
    const settings = { gameId: GAME, ...DEFAULT_SETTINGS }
    for (const change of [{}, { retirementAge: DEFAULT_SETTINGS.retirementAge }]) {
      expect(await updateSettings(db, GAME, change, { now })).toEqual({
        status: 'done',
        value: settings,
        warnings: [],
      })
    }
    expect(await loadGame(db, GAME)).toEqual(game)
  })

  it('設定不存在時丟出錯誤', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.settings.delete(GAME)
    await expect(updateSettings(db, GAME, { retirementAge: 24 })).rejects.toThrow(
      '找不到遊戲局的設定：G',
    )
  })
})

describe('recordBackup', () => {
  it('最近備份時間設為匯出時間，不改更新時間與應用版本（需求規格 12.2）', async () => {
    const db = testDatabase()
    const game = await addTestGame(db, { appVersion: '0.0.0-old' })
    const expected = { ...game, lastBackupAt: '2026-09-29T01:02:03.000Z' }
    expect(await recordBackup(db, GAME, '2026-09-29T01:02:03.000Z')).toEqual(expected)
    expect(await loadGame(db, GAME)).toEqual(expected)
    expect(await db.events.count()).toBe(0)
  })

  it('只往後不往回：比目前的最近備份時間早或相同時不變', async () => {
    const db = testDatabase()
    const game = await addTestGame(db, { lastBackupAt: '2026-09-29T01:02:03.000Z' })
    for (const exportedAt of ['2026-09-28T00:00:00.000Z', '2026-09-29T01:02:03.000Z']) {
      expect(await recordBackup(db, GAME, exportedAt)).toEqual(game)
    }
    expect(await loadGame(db, GAME)).toEqual(game)
    expect((await recordBackup(db, GAME, '2026-09-30T00:00:00.000Z')).lastBackupAt).toBe(
      '2026-09-30T00:00:00.000Z',
    )
  })

  it('遊戲局不存在時丟出錯誤', async () => {
    const db = testDatabase()
    await expect(recordBackup(db, 'missing', '2026-09-29T01:02:03.000Z')).rejects.toThrow(
      '找不到遊戲局：missing',
    )
  })
})

describe('deleteGame', () => {
  it('局名相符時刪除這一局的全部資料列並回傳各表筆數；其他局不受影響（需求規格 12.1）', async () => {
    const db = testDatabase()
    const data = await addSampleGame(db)
    const other = await addSampleGame(db, { id: 'G2' })
    expect(await deleteGame(db, GAME, '  測試局 G  ')).toEqual({
      status: 'done',
      value: countRows(data),
      warnings: [],
    })
    expect(await db.games.get(GAME)).toBeUndefined()
    expect(await db.horses.where('gameId').equals(GAME).count()).toBe(0)
    expect(await readGameData(db, 'G2')).toStrictEqual(other)
    expect(await db.events.count()).toBe(1)
  })

  it('目前遊戲局是這一局時一併清除；是別的局時不變', async () => {
    const db = testDatabase()
    await addSampleGame(db)
    await addSampleGame(db, { id: 'G2' })
    await addSampleGame(db, { id: 'G3' })
    await setCurrentGame(db, 'G2')
    expect((await deleteGame(db, GAME, '測試局 G')).status).toBe('done')
    expect(await currentGameId(db)).toBe('G2')
    expect((await deleteGame(db, 'G2', '測試局 G2')).status).toBe('done')
    expect(await currentGameId(db)).toBeUndefined()
  })

  it('局名不符時阻止，什麼都不刪；遊戲局不存在時丟出錯誤', async () => {
    const db = testDatabase()
    const data = await addSampleGame(db)
    await setCurrentGame(db, GAME)
    expect(await deleteGame(db, GAME, '測試局')).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'name-mismatch' }],
    })
    expect(await readGameData(db, GAME)).toStrictEqual(data)
    expect(await currentGameId(db)).toBe(GAME)
    await expect(deleteGame(db, 'missing', '測試局 G')).rejects.toThrow('找不到遊戲局：missing')
  })
})

describe('deleteAllGames', () => {
  it('輸入「刪除全部存檔」時清空每一張表（含 meta），回傳遊戲局數與總筆數（需求規格 12.1）', async () => {
    const db = testDatabase()
    await addSampleGame(db)
    await addSampleGame(db, { id: 'G2' })
    await setCurrentGame(db, GAME)
    expect(DELETE_ALL_PHRASE).toBe('刪除全部存檔')
    expect(await deleteAllGames(db, ' 刪除全部存檔 ')).toEqual({
      status: 'done',
      value: { games: 2, rows: 30 },
      warnings: [],
    })
    for (const table of db.tables) expect(await table.count()).toBe(0)
  })

  it('文字不符時阻止，什麼都不刪', async () => {
    const db = testDatabase()
    const data = await addSampleGame(db)
    await setCurrentGame(db, GAME)
    expect(await deleteAllGames(db, '刪除全部')).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'phrase-mismatch' }],
    })
    expect(await readGameData(db, GAME)).toStrictEqual(data)
    expect(await currentGameId(db)).toBe(GAME)
  })
})
