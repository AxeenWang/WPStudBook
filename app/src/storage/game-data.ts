import type { Table } from 'dexie'
import type { WPStudBookDatabase } from './database'
import type {
  BreedingRow,
  EventRow,
  GameRow,
  HorseNumberRow,
  HorseRow,
  LineRow,
  MareRow,
  MareYearRow,
  MatingRatingRow,
  RestorationRow,
  SettingsRow,
  StallionRow,
  SystemRow,
} from './records'

// 整局資料的讀出、寫入與刪除（技術設計 4.3「備份與還原」）：備份、還原與危險區共用

/** 一局的全部資料：GAME_TABLES 每張表一個陣列，資料列原樣 */
export interface GameData {
  games: GameRow[]
  settings: SettingsRow[]
  horses: HorseRow[]
  lines: LineRow[]
  systems: SystemRow[]
  mares: MareRow[]
  mareYears: MareYearRow[]
  stallions: StallionRow[]
  restorations: RestorationRow[]
  breedings: BreedingRow[]
  matingRatings: MatingRatingRow[]
  events: EventRow[]
  horseNumbers: HorseNumberRow[]
}

export type GameTableName = keyof GameData

/**
 * 屬於一局的資料表：meta 以外的每一張。games 以 id 歸屬，其他以 gameId 歸屬。
 * 匯出、還原、刪除與計算筆數都用這份清單；加表時一併更新（測試會檢查）
 */
export const GAME_TABLES: readonly GameTableName[] = [
  'games',
  'settings',
  'horses',
  'lines',
  'systems',
  'mares',
  'mareYears',
  'stallions',
  'restorations',
  'breedings',
  'matingRatings',
  'events',
  'horseNumbers',
]

/** 各表的筆數 */
export type RowCounts = Record<GameTableName, number>

/** GAME_TABLES 對應的 Dexie 資料表，供開交易使用 */
export function gameTables(db: WPStudBookDatabase): Table[] {
  return GAME_TABLES.map((name) => db.table(name))
}

/**
 * 讀出一局的全部資料（需求規格 12.2「一致快照」）：在單一唯讀交易內完成。
 * 陣列的順序照 GAME_TABLES。遊戲局不存在時丟出錯誤
 */
export async function readGameData(db: WPStudBookDatabase, gameId: string): Promise<GameData> {
  return db.transaction('r', gameTables(db), async () => {
    const game = await db.games.get(gameId)
    if (!game) throw new Error(`找不到遊戲局：${gameId}`)
    const data: Partial<Record<GameTableName, unknown[]>> = {}
    for (const name of GAME_TABLES) {
      data[name] =
        name === 'games' ? [game] : await db.table(name).where('gameId').equals(gameId).toArray()
    }
    return data as GameData
  })
}

/**
 * 重新產生整局的識別（技術設計 4.3「備份與還原」）：遊戲局與各列的 id 換成 newId 產生的新識別
 * （預設是新的 UUID），任何欄位（含事件內容）中整個字串等於舊識別的值一律換成新的；懸空的引用保持原值。
 * 回傳新的資料，不改傳入的資料
 */
export function remapIds(
  data: GameData,
  newId: (oldId: string) => string = () => crypto.randomUUID(),
): GameData {
  const ids = new Map<string, string>()
  for (const name of GAME_TABLES) {
    for (const row of data[name] as readonly object[]) {
      if ('id' in row && typeof row.id === 'string') ids.set(row.id, newId(row.id))
    }
  }
  const remap = (value: unknown): unknown => {
    if (typeof value === 'string') return ids.get(value) ?? value
    if (Array.isArray(value)) return value.map(remap)
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item)]))
    }
    return value
  }
  return remap(data) as GameData
}

/**
 * 把整局資料寫進資料庫（一個 rw 交易；包進外層交易時成為子交易）。
 * 識別要是這個資料庫裡還沒有的：還原先以 remapIds 重新產生。
 * onProgress 在每張表寫完後收到已寫筆數與總筆數
 */
export async function addGameData(
  db: WPStudBookDatabase,
  data: GameData,
  onProgress?: (written: number, total: number) => void,
): Promise<void> {
  const total = totalRows(countRows(data))
  let written = 0
  await db.transaction('rw', gameTables(db), async () => {
    for (const name of GAME_TABLES) {
      const rows = data[name] as readonly unknown[]
      await db.table(name).bulkAdd(rows)
      written += rows.length
      onProgress?.(written, total)
    }
  })
}

/**
 * 從 GAME_TABLES 刪除一局的全部資料列（一個 rw 交易），回傳各表刪除的筆數。
 * 不碰 meta；遊戲局不存在時什麼都不刪，筆數都是 0
 */
export async function deleteGameData(db: WPStudBookDatabase, gameId: string): Promise<RowCounts> {
  return db.transaction('rw', gameTables(db), async () => {
    const counts = {} as RowCounts
    for (const name of GAME_TABLES) {
      if (name === 'games') {
        counts.games = (await db.games.get(gameId)) ? 1 : 0
        await db.games.delete(gameId)
      } else {
        counts[name] = await db.table(name).where('gameId').equals(gameId).delete()
      }
    }
    return counts
  })
}

/** 一局在 GAME_TABLES 各表的筆數（需求規格 12.1「顯示筆數」）；遊戲局不存在時丟出錯誤 */
export async function countGameRows(db: WPStudBookDatabase, gameId: string): Promise<RowCounts> {
  return db.transaction('r', gameTables(db), async () => {
    if (!(await db.games.get(gameId))) throw new Error(`找不到遊戲局：${gameId}`)
    const counts = {} as RowCounts
    for (const name of GAME_TABLES) {
      counts[name] =
        name === 'games' ? 1 : await db.table(name).where('gameId').equals(gameId).count()
    }
    return counts
  })
}

/** 整局資料各表的筆數 */
export function countRows(data: GameData): RowCounts {
  const counts = {} as RowCounts
  for (const name of GAME_TABLES) counts[name] = data[name].length
  return counts
}

/** 各表筆數的合計 */
export function totalRows(counts: RowCounts): number {
  return GAME_TABLES.reduce((sum, name) => sum + counts[name], 0)
}
