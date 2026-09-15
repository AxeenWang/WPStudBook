import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openAppDatabase, type AppDatabase } from '../../src/storage/database.ts';
import {
  completeTransaction,
  gameKeyRange,
  putRecords,
  readRecords,
} from '../../src/storage/records.ts';
import {
  ALL_STORES,
  SCHEMA_VERSION,
  STORE_DEFINITIONS,
  createVersion1Stores,
} from '../../src/storage/schema.ts';

describe('IndexedDB 結構第 1 版', () => {
  let database: AppDatabase | undefined;

  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
  });

  afterEach(() => {
    database?.close();
    database = undefined;
    vi.unstubAllGlobals();
  });

  async function open(): Promise<AppDatabase> {
    database = await openAppDatabase();
    return database;
  }

  it('建立設計決策 5.2 節的全部資料表、主鍵與索引', async () => {
    const opened = await open();
    expect(opened.version).toBe(SCHEMA_VERSION);
    expect(Array.from(opened.objectStoreNames).sort()).toEqual([...ALL_STORES].sort());
    const transaction = opened.transaction([...ALL_STORES], 'readonly');
    for (const storeName of ALL_STORES) {
      const store = transaction.objectStore(storeName);
      const definition = STORE_DEFINITIONS[storeName];
      expect(store.keyPath, storeName).toEqual(definition.keyPath);
      expect(Array.from(store.indexNames).sort(), storeName).toEqual(
        definition.indexes.map((item) => item.name).sort(),
      );
      for (const item of definition.indexes) {
        const created = store.index(item.name);
        expect(created.keyPath, `${storeName}.${item.name}`).toEqual(item.keyPath);
        expect(created.unique, `${storeName}.${item.name}`).toBe(item.unique);
        expect(created.multiEntry, `${storeName}.${item.name}`).toBe(item.multiEntry);
      }
    }
    await transaction.done;
  });

  it('唯一索引衝突時整筆交易退回，同一交易內的其他寫入也不保存', async () => {
    const opened = await open();
    await putRecords(opened, 'g1', 'horses', [{ id: 'h1', abilityNo: 0, birthYear: 1965 }]);
    const transaction = opened.transaction(['foals', 'horses'], 'readwrite');
    const results = await Promise.allSettled([
      transaction
        .objectStore('foals')
        .put({ gameId: 'g1', id: 'f1', damId: 'h1', birthYear: 1969 }),
      transaction
        .objectStore('horses')
        .put({ gameId: 'g1', id: 'h2', abilityNo: 0, birthYear: 1965 }),
      transaction.done,
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'rejected']);
    expect(await readRecords(opened, 'g1', 'foals')).toEqual([]);
    expect(await readRecords(opened, 'g1', 'horses')).toEqual([
      { id: 'h1', abilityNo: 0, birthYear: 1965 },
    ]);
  });

  it('completeTransaction：工作失敗時中止交易、已排入的寫入不保存，並丟出原本的錯誤', async () => {
    const opened = await open();
    const transaction = opened.transaction('horses', 'readwrite');
    await expect(
      completeTransaction(transaction, async () => {
        await transaction.store.put({ gameId: 'g1', id: 'h1' });
        throw new Error('中途失敗');
      }),
    ).rejects.toThrow('中途失敗');
    expect(await readRecords(opened, 'g1', 'horses')).toEqual([]);
  });

  it('沒有能力番号的紀錄不受「能力番号＋出生年」唯一索引限制（設計決策 5.1 節）', async () => {
    const opened = await open();
    await putRecords(opened, 'g1', 'horses', [
      { id: 'h1', birthYear: 1969 },
      { id: 'h2', birthYear: 1969 },
    ]);
    expect(await readRecords(opened, 'g1', 'horses')).toHaveLength(2);
  });

  it('局範圍只取得同一局的紀錄，不同局可以有相同 id 與相同唯一鍵', async () => {
    const opened = await open();
    await putRecords(opened, 'g1', 'horses', [{ id: 'h1', abilityNo: 0, birthYear: 1965 }]);
    await putRecords(opened, 'g10', 'horses', [{ id: 'h9' }]);
    await putRecords(opened, 'g2', 'horses', [
      { id: 'h1', abilityNo: 0, birthYear: 1965 },
      { id: 'h2' },
    ]);
    expect(await readRecords(opened, 'g1', 'horses')).toEqual([
      { id: 'h1', abilityNo: 0, birthYear: 1965 },
    ]);
    expect(await opened.count('horses', gameKeyRange('g2'))).toBe(2);
  });

  it('本機資料庫版本比程式新時回報 versionTooNew', async () => {
    const newer = await openAppDatabase({
      version: 2,
      upgrades: [
        createVersion1Stores,
        () => {
          // 模擬未來版本的升級步驟
        },
      ],
    });
    newer.close();
    await expect(openAppDatabase()).rejects.toMatchObject({
      name: 'DatabaseOpenError',
      reason: 'versionTooNew',
    });
  });

  it('升級只執行舊版本之後的步驟', async () => {
    const calls: number[] = [];
    const steps = [1, 2, 3].map((step) => () => {
      calls.push(step);
    });
    const first = await openAppDatabase({ name: 'upgrade-probe', version: 1, upgrades: steps });
    first.close();
    const second = await openAppDatabase({ name: 'upgrade-probe', version: 3, upgrades: steps });
    second.close();
    expect(calls).toEqual([1, 2, 3]);
  });
});
