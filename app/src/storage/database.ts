import Dexie, { type EntityTable, type Table } from 'dexie'
import type { LinePosition } from '../core/lines'
import type {
  ArchiveRow,
  BreedingRow,
  CheckpointContentRow,
  CheckpointRow,
  EventRow,
  GameRow,
  HorseNumberRow,
  HorseRow,
  ImportRecord,
  LineRow,
  MareRow,
  MareYearRow,
  MatingRatingRow,
  MetaRow,
  RestorationRow,
  SettingsRow,
  StallionRow,
  SystemRow,
} from './records'

/** 瀏覽器裡的資料庫名稱 */
export const DATABASE_NAME = 'wpstudbook'

/** 結構版本：Dexie 的版本號，備份檔的結構版本與遷移也用這個號碼（技術設計 4.3） */
export const SCHEMA_VERSION = 1

export type WPStudBookDatabase = Dexie & {
  games: EntityTable<GameRow, 'id'>
  settings: EntityTable<SettingsRow, 'gameId'>
  /** 全域資料依鍵區分型別；EntityTable 的新增型別會把聯合攤平，所以用 Table */
  meta: Table<MetaRow, string>
  horses: EntityTable<HorseRow, 'id'>
  lines: Table<LineRow, [string, LinePosition]>
  systems: Table<SystemRow, [string, string]>
  mares: EntityTable<MareRow, 'horseId'>
  /** 母馬年度資料，主鍵是 [gameId+horseId+year] */
  mareYears: Table<MareYearRow, [string, string, number]>
  stallions: EntityTable<StallionRow, 'id'>
  restorations: EntityTable<RestorationRow, 'id'>
  breedings: EntityTable<BreedingRow, 'id'>
  matingRatings: EntityTable<MatingRatingRow, 'id'>
  /** 事件是各種類的聯合型別；EntityTable 的新增型別會把聯合攤平，所以用 Table */
  events: Table<EventRow, string>
  horseNumbers: EntityTable<HorseNumberRow, 'id'>
  /** 匯入紀錄（技術設計 4.4「流程」） */
  imports: EntityTable<ImportRecord, 'id'>
  /** 檢查點的中繼資料；不屬於 GAME_TABLES（技術設計 4.3「檢查點與回溯」） */
  checkpoints: EntityTable<CheckpointRow, 'id'>
  /** 檢查點的內容，主鍵是 checkpointId */
  checkpointContents: EntityTable<CheckpointContentRow, 'checkpointId'>
  /** 封存索引；全域，不屬於 GAME_TABLES（技術設計 4.3「封存」） */
  archives: EntityTable<ArchiveRow, 'id'>
}

/** 測試時改用 fake-indexeddb；瀏覽器裡留空，使用內建的 IndexedDB */
export interface DatabaseDependencies {
  indexedDB: IDBFactory
  IDBKeyRange: typeof IDBKeyRange
}

/**
 * 建立資料庫物件；Dexie 在第一次查詢時才開啟資料庫。
 * 結構版本：正式發布前維持 1，直接修改版本 1 的結構；第一次發布後才以版本升級變更（技術設計 4.3）。
 * 索引照需求規格 12.5；除了全域的 meta 與封存索引，每張表都能以 gameId 查詢。
 * 事件依對象（馬匹、系位置、系統對照表的子系統）與年份查詢；母馬年度資料依年份篩選今年計畫；
 * 總合評價與爆發力依母馬查詢；階段馬番号依馬匹查詢；匯入紀錄依類型與年查詢；檢查點的中繼資料與內容分兩張表；
 * 封存索引以原遊戲局的識別為主鍵（技術設計 4.3）。
 */
export function createDatabase(
  name: string = DATABASE_NAME,
  dependencies?: DatabaseDependencies,
): WPStudBookDatabase {
  const db = new Dexie(name, dependencies) as WPStudBookDatabase
  db.version(SCHEMA_VERSION).stores({
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
    matingRatings: 'id, gameId, [gameId+mareId]',
    events: 'id, gameId, [gameId+year], [gameId+horseId], [gameId+line], [gameId+system]',
    horseNumbers: 'id, gameId, [gameId+horseId]',
    imports: 'id, gameId, [gameId+type+year]',
    checkpoints: 'id, gameId',
    checkpointContents: 'checkpointId, gameId',
    archives: 'id',
  })
  return db
}
