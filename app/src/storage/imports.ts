import type { Game } from '../domain/game.ts';
import type { HistoryEvent } from '../domain/history-event.ts';
import type { ImportBatch } from '../domain/import-batch.ts';
import type { ImportType } from '../domain/import-type.ts';
import type { Timing } from '../domain/timing.ts';
import type { AppDatabase } from './database.ts';
import { readGameForWrite, type GameTouch } from './games.ts';
import { withHorseNameKeys } from './horses.ts';
import {
  completeTransaction,
  gameKeyRange,
  isPlainRecord,
  withGameId,
  withoutGameId,
} from './records.ts';
import type { RecordCollection } from './schema.ts';

function toImportBatch(value: unknown): ImportBatch | undefined {
  // 本機資料由本程式寫入；備份匯入的紀錄由 validateCollections 驗證。
  return isPlainRecord(value) ? (withoutGameId(value) as unknown as ImportBatch) : undefined;
}

export async function listImports(database: AppDatabase, gameId: string): Promise<ImportBatch[]> {
  const values: unknown[] = await database.getAll('imports', gameKeyRange(gameId));
  return values.map(toImportBatch).filter((batch) => batch !== undefined);
}

/**
 * 同局、同年、同時點、同類型的既有匯入（需求規格 11.1）。
 * 不同類型即使落在同一個時點也互不相干，所以類型是索引鍵的一部分（IMP-16）。
 */
export async function listImportsInSlot(
  database: AppDatabase,
  gameId: string,
  type: ImportType,
  gameYear: number,
  timing: Timing,
): Promise<ImportBatch[]> {
  const values: unknown[] = await database.getAllFromIndex(
    'imports',
    'type+gameYear+timing.month+timing.week',
    [gameId, type, gameYear, timing.month, timing.week],
  );
  return values.map(toImportBatch).filter((batch) => batch !== undefined);
}

export interface CollectionRecord {
  readonly collection: RecordCollection;
  /** 型別用 object，讓 Horse、Mare 等沒有索引簽章的介面可以直接傳入（同 withGameId）。 */
  readonly record: object;
}

export interface ImportWrites {
  readonly batch: ImportBatch;
  readonly records: readonly CollectionRecord[];
  readonly events: readonly HistoryEvent[];
  /** 推進目前遊戲年（需求規格 11.1、IMP-14）；不推進時省略。 */
  readonly currentYear?: number | undefined;
}

export interface ImportApply {
  readonly gameId: string;
  readonly touch: GameTouch;
  /** 這次匯入會寫到的資料表，交易一次涵蓋。 */
  readonly collections: readonly RecordCollection[];
  /** 以寫入交易內讀出的遊戲局產生紀錄與事件；只能做同步運算，丟出錯誤時整筆交易中止。 */
  readonly build: (game: Game) => ImportWrites;
}

/**
 * 套用一次匯入：匯入紀錄、受影響的資料表、事件與遊戲局更新全部在同一個交易裡完成，
 * 任何一步失敗資料都不變（需求規格 11.1、IMP-06）。
 */
export async function applyImportBatch(
  database: AppDatabase,
  apply: ImportApply,
): Promise<ImportWrites> {
  const { gameId } = apply;
  const stores = [
    ...new Set<RecordCollection | 'games'>(['games', 'imports', 'events', ...apply.collections]),
  ];
  const transaction = database.transaction(stores, 'readwrite');
  const games = transaction.objectStore('games');
  return completeTransaction(transaction, async () => {
    const game = await readGameForWrite(games, gameId);
    const writes = apply.build(game);
    await Promise.all([
      games.put({
        ...game,
        ...apply.touch,
        ...(writes.currentYear === undefined ? {} : { currentYear: writes.currentYear }),
      }),
      transaction.objectStore('imports').add(withGameId(gameId, writes.batch)),
      ...writes.records.map(({ collection, record }) =>
        transaction
          .objectStore(collection)
          .put(
            collection === 'horses'
              ? withHorseNameKeys(gameId, record)
              : withGameId(gameId, record),
          ),
      ),
      ...writes.events.map((event) =>
        transaction.objectStore('events').add(withGameId(gameId, event)),
      ),
    ]);
    return writes;
  });
}
