import { openDB, type IDBPDatabase } from 'idb';
import { describeError } from './describe-error.ts';
import {
  DATABASE_NAME,
  SCHEMA_UPGRADES,
  SCHEMA_VERSION,
  runSchemaUpgrades,
  type SchemaUpgrade,
} from './schema.ts';

export type AppDatabase = IDBPDatabase;

export type DatabaseOpenFailure = 'unavailable' | 'versionTooNew';

export class DatabaseOpenError extends Error {
  readonly reason: DatabaseOpenFailure;

  constructor(reason: DatabaseOpenFailure, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DatabaseOpenError';
    this.reason = reason;
  }
}

export interface OpenDatabaseOptions {
  readonly name?: string | undefined;
  readonly version?: number | undefined;
  readonly upgrades?: readonly SchemaUpgrade[] | undefined;
  /** 其他分頁仍開著舊版本、升級被擋住時呼叫。 */
  readonly onBlocked?: (() => void) | undefined;
  /** 其他分頁要求升級或瀏覽器中斷連線時呼叫；此時連線已關閉，需要重新整理。 */
  readonly onConnectionLost?: (() => void) | undefined;
}

export async function openAppDatabase(options: OpenDatabaseOptions = {}): Promise<AppDatabase> {
  if (typeof indexedDB === 'undefined') {
    throw new DatabaseOpenError('unavailable', '此瀏覽器無法使用 IndexedDB');
  }
  const version = options.version ?? SCHEMA_VERSION;
  const upgrades = options.upgrades ?? SCHEMA_UPGRADES;
  try {
    const database = await openDB(options.name ?? DATABASE_NAME, version, {
      upgrade(upgradeDatabase, oldVersion, newVersion, transaction) {
        runSchemaUpgrades(
          upgradeDatabase,
          transaction,
          oldVersion,
          newVersion ?? version,
          upgrades,
        );
      },
      blocked() {
        options.onBlocked?.();
      },
      blocking() {
        database.close();
        options.onConnectionLost?.();
      },
      terminated() {
        options.onConnectionLost?.();
      },
    });
    return database;
  } catch (error) {
    if (error instanceof Error && error.name === 'VersionError') {
      throw new DatabaseOpenError(
        'versionTooNew',
        '本機資料庫的結構版本比這個 WPStudBook.html 新，請改用較新版本的 HTML 開啟',
        { cause: error },
      );
    }
    throw new DatabaseOpenError('unavailable', `無法開啟資料庫：${describeError(error)}`, {
      cause: error,
    });
  }
}
