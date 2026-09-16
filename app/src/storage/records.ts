import type { AppDatabase } from './database.ts';
import type { RecordCollection } from './schema.ts';

export type StoredRecord = Readonly<Record<string, unknown>>;

export function isPlainRecord(value: unknown): value is StoredRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 主鍵 [gameId, id] 中屬於同一局的範圍：[gameId] < [gameId, 任何字串] < [gameId, []]。 */
export function gameKeyRange(gameId: string): IDBKeyRange {
  return IDBKeyRange.bound([gameId], [gameId, []]);
}

/** 參數型別用 object，讓 Game、HistoryEvent 等沒有索引簽章的介面也能直接傳入。 */
export function withGameId(gameId: string, record: object): StoredRecord {
  return { ...record, gameId };
}

export function withoutGameId(record: StoredRecord): StoredRecord {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'gameId'));
}

export async function putRecords(
  database: AppDatabase,
  gameId: string,
  collection: RecordCollection,
  records: readonly StoredRecord[],
): Promise<void> {
  const transaction = database.transaction(collection, 'readwrite');
  await Promise.all([
    ...records.map((record) => transaction.store.put(withGameId(gameId, record))),
    transaction.done,
  ]);
}

export async function readRecords(
  database: AppDatabase,
  gameId: string,
  collection: RecordCollection,
): Promise<StoredRecord[]> {
  const values: unknown[] = await database.getAll(collection, gameKeyRange(gameId));
  return values.filter(isPlainRecord).map(withoutGameId);
}

/** 交易內的資料表；只列出用到的請求，讓唯讀與讀寫交易都能傳入同一個讀取函式。 */
export interface ReadableIndex {
  get(query: IDBValidKey): Promise<unknown>;
  getAll(query: IDBValidKey | IDBKeyRange): Promise<unknown[]>;
}

export interface ReadableStore {
  get(key: IDBValidKey): Promise<unknown>;
  index(name: string): ReadableIndex;
}

interface CompletableTransaction {
  abort(): void;
  readonly done: Promise<void>;
}

/**
 * 在交易內依序等待多個請求時使用：等工作與交易都完成才回傳。工作失敗時中止交易，並吸收
 * transaction.done 的拒絕（idb 在建立交易時就產生 done，沒有處理會變成未處理的 Promise 拒絕），
 * 再丟出原本的錯誤。work 內只能等待 IndexedDB 請求，等待其他 Promise 會讓交易提前提交。
 * 請求可以一次排入時，直接 await Promise.all([...requests, transaction.done]) 即可。
 */
export async function completeTransaction<T>(
  transaction: CompletableTransaction,
  work: () => Promise<T>,
): Promise<T> {
  try {
    const result = await work();
    await transaction.done;
    return result;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // 交易已經結束（完成或已中止）。
    }
    await transaction.done.catch(() => undefined);
    throw error;
  }
}
