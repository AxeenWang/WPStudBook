import { BACKUP_MIGRATIONS, type BackupMigration } from '../storage/backup/migrations.ts';
import { openAppDatabase, type AppDatabase } from '../storage/database.ts';
import { describeError } from '../storage/describe-error.ts';
import { SCHEMA_VERSION } from '../storage/schema.ts';

export type WriteStatus =
  | { readonly state: 'none' }
  | { readonly state: 'saved'; readonly at: string }
  | { readonly state: 'failed'; readonly at: string; readonly message: string };

export type PersistenceState = 'unknown' | 'persisted' | 'notPersisted' | 'unsupported';

export interface ServiceStatus {
  write: WriteStatus;
  persistence: PersistenceState;
}

export interface ServiceContext {
  readonly database: AppDatabase;
  readonly appVersion: string;
  readonly now: () => Date;
  readonly newId: () => string;
  /** 備份與檢查點使用的結構版本；測試可注入較新版本驗證遷移。IndexedDB 本身固定使用 SCHEMA_VERSION。 */
  readonly schemaVersion: number;
  readonly migrations: readonly BackupMigration[];
  readonly status: ServiceStatus;
}

export interface OpenServiceContextOptions {
  readonly appVersion: string;
  readonly databaseName?: string | undefined;
  readonly now?: (() => Date) | undefined;
  readonly newId?: (() => string) | undefined;
  readonly schemaVersion?: number | undefined;
  readonly migrations?: readonly BackupMigration[] | undefined;
  readonly onBlocked?: (() => void) | undefined;
  readonly onConnectionLost?: (() => void) | undefined;
}

export async function openServiceContext(
  options: OpenServiceContextOptions,
): Promise<ServiceContext> {
  const database = await openAppDatabase({
    name: options.databaseName,
    onBlocked: options.onBlocked,
    onConnectionLost: options.onConnectionLost,
  });
  return {
    database,
    appVersion: options.appVersion,
    now: options.now ?? (() => new Date()),
    newId: options.newId ?? (() => crypto.randomUUID()),
    schemaVersion: options.schemaVersion ?? SCHEMA_VERSION,
    migrations: options.migrations ?? BACKUP_MIGRATIONS,
    status: { write: { state: 'none' }, persistence: 'unknown' },
  };
}

export function closeServiceContext(context: ServiceContext): void {
  context.database.close();
}

/** 執行一次寫入並記錄結果，供頂部保存狀態顯示；錯誤照樣往外丟。 */
export async function trackWrite<T>(context: ServiceContext, write: () => Promise<T>): Promise<T> {
  try {
    const result = await write();
    context.status.write = { state: 'saved', at: context.now().toISOString() };
    return result;
  } catch (error) {
    context.status.write = {
      state: 'failed',
      at: context.now().toISOString(),
      message: describeError(error),
    };
    throw error;
  }
}

interface PersistenceManager {
  persisted(): Promise<boolean>;
  persist(): Promise<boolean>;
}

function findPersistenceManager(): PersistenceManager | undefined {
  const navigatorValue: unknown = Reflect.get(globalThis, 'navigator');
  if (typeof navigatorValue !== 'object' || navigatorValue === null) {
    return undefined;
  }
  const storage: unknown = Reflect.get(navigatorValue, 'storage');
  if (
    typeof storage === 'object' &&
    storage !== null &&
    typeof Reflect.get(storage, 'persisted') === 'function' &&
    typeof Reflect.get(storage, 'persist') === 'function'
  ) {
    return storage as PersistenceManager;
  }
  return undefined;
}

/** 已取得持久保存時直接回報；否則向瀏覽器申請一次（Chromium 不會跳出提示）。 */
export async function requestPersistentStorage(context: ServiceContext): Promise<PersistenceState> {
  const manager = findPersistenceManager();
  let state: PersistenceState = 'unsupported';
  if (manager !== undefined) {
    try {
      state =
        (await manager.persisted()) || (await manager.persist()) ? 'persisted' : 'notPersisted';
    } catch {
      state = 'unsupported';
    }
  }
  context.status.persistence = state;
  return state;
}
