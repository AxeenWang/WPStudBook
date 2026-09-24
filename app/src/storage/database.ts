import Dexie, { type EntityTable, type Table } from 'dexie'
import type { LinePosition } from '../core/lines'
import type {
  BreedingRow,
  GameRow,
  HorseRow,
  LineRow,
  MareRow,
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
  stallions: EntityTable<StallionRow, 'id'>
  restorations: EntityTable<RestorationRow, 'id'>
  breedings: EntityTable<BreedingRow, 'id'>
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
    stallions: 'id, gameId, horseId, [gameId+line+generation]',
    restorations: 'id, gameId',
    breedings: 'id, gameId, &[gameId+mareId+year]',
  })
  return db
}
