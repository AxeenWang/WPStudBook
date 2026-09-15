import type { IDBPDatabase, IDBPTransaction } from 'idb';

export const DATABASE_NAME = 'wpstudbook';

/** IndexedDB 版本與備份 schemaVersion 共用同一個號碼（設計決策 5.6 節）。 */
export const SCHEMA_VERSION = 1;

/** 主鍵為 [gameId, id]、收錄於備份的資料表。 */
export const RECORD_COLLECTIONS = [
  'lines',
  'systemMap',
  'horses',
  'mares',
  'stallionDuties',
  'mareYearly',
  'stallionYearly',
  'breedings',
  'matingRatings',
  'foals',
  'recoveries',
  'imports',
  'events',
] as const;

export type RecordCollection = (typeof RECORD_COLLECTIONS)[number];

/** 備份 collections 的資料表：gameSettings（每局一筆，主鍵 gameId）加上 RECORD_COLLECTIONS。 */
export const BACKUP_COLLECTIONS = ['gameSettings', ...RECORD_COLLECTIONS] as const;

export type BackupCollection = (typeof BACKUP_COLLECTIONS)[number];

export const CHECKPOINT_STORES = ['checkpoints', 'checkpointData'] as const;

export const APP_STORES = ['games', 'archives', 'appMeta'] as const;

/** 刪除一局時要清除的全部資料表（games 另外處理）。 */
export const GAME_DATA_STORES = [...BACKUP_COLLECTIONS, ...CHECKPOINT_STORES] as const;

export type GameDataStore = (typeof GAME_DATA_STORES)[number];

export const ALL_STORES = [...APP_STORES, ...GAME_DATA_STORES] as const;

export type StoreName = (typeof ALL_STORES)[number];

export interface IndexDefinition {
  readonly name: string;
  readonly keyPath: string | readonly string[];
  readonly unique: boolean;
  readonly multiEntry: boolean;
}

export interface StoreDefinition {
  readonly keyPath: string | readonly string[];
  readonly indexes: readonly IndexDefinition[];
}

const GAME_KEY = ['gameId', 'id'] as const;

function gameIndex(fields: readonly string[], unique = false): IndexDefinition {
  return { name: fields.join('+'), keyPath: ['gameId', ...fields], unique, multiEntry: false };
}

/** 第 1 版的資料表定義；已發布版本的常數不得修改，結構改版時新增新版常數並改指向它。 */
export const VERSION_1_STORE_DEFINITIONS: Readonly<Record<StoreName, StoreDefinition>> = {
  games: { keyPath: 'id', indexes: [] },
  archives: { keyPath: 'id', indexes: [] },
  appMeta: { keyPath: 'key', indexes: [] },
  gameSettings: { keyPath: 'gameId', indexes: [] },
  lines: { keyPath: GAME_KEY, indexes: [gameIndex(['position'], true)] },
  systemMap: { keyPath: GAME_KEY, indexes: [gameIndex(['subsystem'], true)] },
  horses: {
    keyPath: GAME_KEY,
    indexes: [
      gameIndex(['abilityNo', 'birthYear'], true),
      gameIndex(['sireId']),
      gameIndex(['damId']),
      { name: 'nameKeys', keyPath: 'nameKeys', unique: false, multiEntry: true },
    ],
  },
  mares: {
    keyPath: GAME_KEY,
    indexes: [gameIndex(['status']), gameIndex(['group.position', 'group.generation'])],
  },
  stallionDuties: {
    keyPath: GAME_KEY,
    indexes: [gameIndex(['position', 'generation']), gameIndex(['horseId'])],
  },
  mareYearly: { keyPath: GAME_KEY, indexes: [gameIndex(['horseId', 'gameYear'], true)] },
  stallionYearly: { keyPath: GAME_KEY, indexes: [gameIndex(['horseId', 'gameYear'], true)] },
  breedings: {
    keyPath: GAME_KEY,
    indexes: [gameIndex(['mareId', 'gameYear'], true), gameIndex(['stallionId'])],
  },
  matingRatings: {
    keyPath: GAME_KEY,
    indexes: [gameIndex(['stallionId', 'mareId', 'gameYear'], true)],
  },
  foals: {
    keyPath: GAME_KEY,
    indexes: [
      gameIndex(['damId', 'birthYear'], true),
      gameIndex(['lineage.position', 'lineage.generation']),
    ],
  },
  recoveries: { keyPath: GAME_KEY, indexes: [gameIndex(['status'])] },
  imports: {
    keyPath: GAME_KEY,
    indexes: [gameIndex(['type', 'gameYear', 'timing.month', 'timing.week'])],
  },
  events: {
    keyPath: GAME_KEY,
    indexes: [gameIndex(['subjectId']), gameIndex(['type', 'gameYear'])],
  },
  checkpoints: { keyPath: GAME_KEY, indexes: [gameIndex(['gameYear'])] },
  checkpointData: { keyPath: GAME_KEY, indexes: [] },
};

/** 目前版本的定義；結構改版時新增新版常數並改指向它，已發布版本的常數不得修改。 */
export const STORE_DEFINITIONS: Readonly<Record<StoreName, StoreDefinition>> =
  VERSION_1_STORE_DEFINITIONS;

export type UpgradeTransaction = IDBPTransaction<unknown, string[], 'versionchange'>;

export type SchemaUpgrade = (database: IDBPDatabase, transaction: UpgradeTransaction) => void;

function toKeyPath(keyPath: string | readonly string[]): string | string[] {
  return typeof keyPath === 'string' ? keyPath : [...keyPath];
}

export function createVersion1Stores(database: IDBPDatabase): void {
  for (const storeName of ALL_STORES) {
    const definition = VERSION_1_STORE_DEFINITIONS[storeName];
    const store = database.createObjectStore(storeName, { keyPath: toKeyPath(definition.keyPath) });
    for (const item of definition.indexes) {
      store.createIndex(item.name, toKeyPath(item.keyPath), {
        unique: item.unique,
        multiEntry: item.multiEntry,
      });
    }
  }
}

/** SCHEMA_UPGRADES[n - 1] 把資料庫升級到第 n 版。 */
export const SCHEMA_UPGRADES: readonly SchemaUpgrade[] = [createVersion1Stores];

export function runSchemaUpgrades(
  database: IDBPDatabase,
  transaction: UpgradeTransaction,
  oldVersion: number,
  newVersion: number,
  upgrades: readonly SchemaUpgrade[],
): void {
  for (let version = oldVersion + 1; version <= newVersion; version += 1) {
    const upgrade = upgrades[version - 1];
    if (upgrade === undefined) {
      throw new Error(`缺少第 ${String(version)} 版的資料庫升級步驟`);
    }
    upgrade(database, transaction);
  }
}
