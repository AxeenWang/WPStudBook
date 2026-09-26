import Dexie from 'dexie'
import { DEFAULT_MARE_AGE_SETTINGS } from '../core/mares'
import { DEFAULT_STALLION_REMINDER_AGE } from '../core/stallions'
import type { WPStudBookDatabase } from './database'
import type { GameRow, SettingsRow, SystemRow } from './records'
import { gate, runWrite, type WriteOptions, type WriteResult } from './writes'

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

/**
 * 目前遊戲年的阻止原因：
 * - not-integer：年份不是整數
 * - before-records：往回改到起始年或最後紀錄年以前（需求規格 12.1）；earliest 是可以改的最早年份
 */
export type YearBlock = { kind: 'not-integer' } | { kind: 'before-records'; earliest: number }

/**
 * 更新目前遊戲年（需求規格 12.1）：只由使用者更新，更新前的影響與確認由畫面負責。
 * 往後可以改成任何年份；往回不能早於起始年，也不能早於最後紀錄年，
 * 也就是這一局事件的最大年份與馬的最大出生年（使用者 2026-09-26 決定）。
 * 和目前相同時不寫入；遊戲年變更本身不寫事件。遊戲局不存在時丟出錯誤。
 */
export async function setCurrentYear(
  db: WPStudBookDatabase,
  gameId: string,
  year: number,
  options: WriteOptions = {},
): Promise<WriteResult<GameRow, YearBlock>> {
  return runWrite(db, gameId, [db.horses], options, async (context) => {
    const { game } = context
    const blocks: YearBlock[] = []
    if (!Number.isInteger(year)) {
      blocks.push({ kind: 'not-integer' })
    } else if (year < game.currentYear) {
      const earliest = Math.max(game.startYear, await latestRecordYear(db, gameId))
      if (year < earliest) blocks.push({ kind: 'before-records', earliest })
    }
    const stop = gate(blocks, [], context.confirmed)
    if (stop) return stop
    if (year === game.currentYear) return { status: 'done', value: game, warnings: [] }
    await db.games.update(gameId, { currentYear: year })
    return context.done({ ...game, currentYear: year, updatedAt: context.now })
  })
}

/** 最後紀錄年：這一局事件的最大年份與馬的最大出生年；兩者都沒有時為 -Infinity */
async function latestRecordYear(db: WPStudBookDatabase, gameId: string): Promise<number> {
  const lastEvent = await db.events
    .where('[gameId+year]')
    .between([gameId, Dexie.minKey], [gameId, Dexie.maxKey])
    .last()
  const lastBorn = await db.horses
    .where('[gameId+birthYear]')
    .between([gameId, Dexie.minKey], [gameId, Dexie.maxKey])
    .last()
  return Math.max(lastEvent?.year ?? -Infinity, lastBorn?.birthYear ?? -Infinity)
}

/** 可以修改的設定 */
export type SettingsChange = Partial<Omit<SettingsRow, 'gameId'>>

const SETTING_FIELDS: readonly (keyof SettingsChange)[] = [
  'retirementAge',
  'seniorAge',
  'stallionReminderAge',
]

/** 設定的阻止原因：field 不是 1 以上的整數 */
export interface SettingsBlock {
  kind: 'not-positive-integer'
  field: keyof SettingsChange
}

/**
 * 修改這一局的設定（需求規格 7.7、8.5）：只改 change 有填的欄位，每一項都要是 1 以上的整數。
 * 不寫事件；新設定從下一次判斷開始生效（MARE-10）。遊戲局或設定不存在時丟出錯誤。
 */
export async function updateSettings(
  db: WPStudBookDatabase,
  gameId: string,
  change: SettingsChange,
  options: WriteOptions = {},
): Promise<WriteResult<SettingsRow, SettingsBlock>> {
  return runWrite(db, gameId, [db.settings], options, async (context) => {
    const blocks = SETTING_FIELDS.filter((field) => {
      const value = change[field]
      return value !== undefined && !(Number.isInteger(value) && value >= 1)
    }).map((field): SettingsBlock => ({ kind: 'not-positive-integer', field }))
    const stop = gate(blocks, [], context.confirmed)
    if (stop) return stop
    const settings = { ...(await loadSettings(db, gameId)) }
    for (const field of SETTING_FIELDS) {
      const value = change[field]
      if (value !== undefined) settings[field] = value
    }
    await db.settings.put(settings)
    return context.done(settings)
  })
}
