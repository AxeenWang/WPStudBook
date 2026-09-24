import { describe, expect, it } from 'vitest'
import { testDatabase } from '../../tests/support/database'
import {
  DEFAULT_SETTINGS,
  createGame,
  currentGameId,
  listGames,
  loadGame,
  loadSettings,
  setCurrentGame,
} from './games'

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
