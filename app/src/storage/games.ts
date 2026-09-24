import { DEFAULT_MARE_AGE_SETTINGS } from '../core/mares'
import { DEFAULT_STALLION_REMINDER_AGE } from '../core/stallions'
import type { WPStudBookDatabase } from './database'
import type { GameRow, SettingsRow, SystemRow } from './records'

/** 新局的預設設定（需求規格 7.7、8.5） */
export const DEFAULT_SETTINGS: Readonly<Omit<SettingsRow, 'gameId'>> = {
  retirementAge: DEFAULT_MARE_AGE_SETTINGS.retirementAge,
  seniorAge: DEFAULT_MARE_AGE_SETTINGS.seniorAge,
  stallionReminderAge: DEFAULT_STALLION_REMINDER_AGE,
}

/** meta 表中記錄目前遊戲局的鍵 */
const CURRENT_GAME_KEY = 'currentGame'

export interface NewGame {
  name: string
  startYear: number
  /** 從這一局只複製系統對照表與設定（需求規格 12.1）；留空時全新空白 */
  copyFrom?: string
}

/**
 * 建立遊戲局（需求規格 12.1）：全新空白，或只複製另一局的系統對照表與設定，
 * 不複製八系位置、馬匹或歷程（DATA-13）。目前遊戲年從起始年開始，局名去除前後空白。
 * 局名空白或起始年不是整數時丟出 RangeError；要複製的局不存在時丟出錯誤，不建立新局。
 */
export async function createGame(
  db: WPStudBookDatabase,
  input: NewGame,
  now: Date = new Date(),
): Promise<GameRow> {
  const name = input.name.trim()
  if (name === '') throw new RangeError('局名不能空白')
  if (!Number.isInteger(input.startYear)) {
    throw new RangeError(`起始年必須是整數：${input.startYear}`)
  }
  const timestamp = now.toISOString()
  const game: GameRow = {
    id: crypto.randomUUID(),
    name,
    startYear: input.startYear,
    currentYear: input.startYear,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  await db.transaction('rw', [db.games, db.settings, db.systems], async () => {
    let settings: SettingsRow = { gameId: game.id, ...DEFAULT_SETTINGS }
    let systems: SystemRow[] = []
    if (input.copyFrom !== undefined) {
      await loadGame(db, input.copyFrom)
      settings = { ...(await loadSettings(db, input.copyFrom)), gameId: game.id }
      const source = await db.systems.where('gameId').equals(input.copyFrom).toArray()
      systems = source.map((row) => ({ ...row, gameId: game.id }))
    }
    await db.games.add(game)
    await db.settings.add(settings)
    await db.systems.bulkAdd(systems)
  })
  return game
}

/** 所有遊戲局，依建立時間排序 */
export async function listGames(db: WPStudBookDatabase): Promise<GameRow[]> {
  const games = await db.games.toArray()
  return games.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/** 讀取遊戲局；找不到時丟出錯誤 */
export async function loadGame(db: WPStudBookDatabase, gameId: string): Promise<GameRow> {
  const game = await db.games.get(gameId)
  if (!game) throw new Error(`找不到遊戲局：${gameId}`)
  return game
}

/** 讀取一局的設定；找不到時丟出錯誤 */
export async function loadSettings(db: WPStudBookDatabase, gameId: string): Promise<SettingsRow> {
  const settings = await db.settings.get(gameId)
  if (!settings) throw new Error(`找不到遊戲局的設定：${gameId}`)
  return settings
}

/** 目前使用的遊戲局；還沒選過時為 undefined（需求規格 12.1：所有操作只作用於目前遊戲局） */
export async function currentGameId(db: WPStudBookDatabase): Promise<string | undefined> {
  return (await db.meta.get(CURRENT_GAME_KEY))?.value
}

/** 切換目前遊戲局；遊戲局不存在時丟出錯誤 */
export async function setCurrentGame(db: WPStudBookDatabase, gameId: string): Promise<void> {
  await db.transaction('rw', [db.games, db.meta], async () => {
    await loadGame(db, gameId)
    await db.meta.put({ key: CURRENT_GAME_KEY, value: gameId })
  })
}
