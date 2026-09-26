import Dexie, { type EntityTable, type Table } from 'dexie'
import type { LinePosition } from '../core/lines'
import type {
  BreedingRow,
  EventRow,
  GameRow,
  HorseRow,
  LineRow,
  MareRow,
  MareYearRow,
  MetaRow,
  RestorationRow,
  SettingsRow,
  StallionRow,
  SystemRow,
} from './records'

/** 瀏覽器裡的資料庫名稱 */
export const DATABASE_NAME = 'wpstudbook'

export type WPStudBookDatabase = Dexie & {
  games: EntityTable<GameRow, 'id'>
  settings: EntityTable<SettingsRow, 'gameId'>
  meta: EntityTable<MetaRow, 'key'>
  horses: EntityTable<HorseRow, 'id'>
  lines: Table<LineRow, [string, LinePosition]>
  systems: Table<SystemRow, [string, string]>
  mares: EntityTable<MareRow, 'horseId'>
  /** 母馬年度資料，主鍵是 [gameId+horseId+year] */
  mareYears: Table<MareYearRow, [string, string, number]>
  stallions: EntityTable<StallionRow, 'id'>
  restorations: EntityTable<RestorationRow, 'id'>
  breedings: EntityTable<BreedingRow, 'id'>
  /** 事件是各種類的聯合型別；EntityTable 的新增型別會把聯合攤平，所以用 Table */
  events: Table<EventRow, string>
}

/** 測試時改用 fake-indexeddb；瀏覽器裡留空，使用內建的 IndexedDB */
export interface DatabaseDependencies {
  indexedDB: IDBFactory
  IDBKeyRange: typeof IDBKeyRange
}

/**
 * 建立資料庫物件；Dexie 在第一次查詢時才開啟資料庫。
 * 結構版本：正式發布前維持 1，直接修改版本 1 的結構；第一次發布後才以版本升級變更（技術設計 4.3）。
 * 索引照需求規格 12.5；除了全域的 meta，每張表都能以 gameId 查詢。
 * 事件依對象（馬匹、系位置、系統對照表的子系統）與年份查詢；母馬年度資料依年份篩選今年計畫（技術設計 4.3）。
 */
export function createDatabase(
  name: string = DATABASE_NAME,
  dependencies?: DatabaseDependencies,
): WPStudBookDatabase {
  const db = new Dexie(name, dependencies) as WPStudBookDatabase
  db.version(1).stores({
    games: 'id',
    settings: 'gameId',
    meta: 'key',
    horses:
      'id, gameId, [gameId+abilityNumber+birthYear], [gameId+birthYear], [gameId+sireId], [gameId+damId], [gameId+baseName]',
    lines: '[gameId+line], gameId',
    systems: '[gameId+subsystem], gameId',
    mares: 'horseId, gameId, [gameId+groupLine+groupGeneration], [gameId+herd]',
    mareYears: '[gameId+horseId+year], gameId, [gameId+year]',
    stallions: 'id, gameId, horseId, [gameId+line+generation]',
    restorations: 'id, gameId',
    breedings: 'id, gameId, &[gameId+mareId+year]',
    events: 'id, gameId, [gameId+year], [gameId+horseId], [gameId+line], [gameId+system]',
  })
  return db
}
