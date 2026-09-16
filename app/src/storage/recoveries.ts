import type { HistoryEvent } from '../domain/history-event.ts';
import type { Recovery } from '../domain/recovery.ts';
import type { AppDatabase } from './database.ts';
import { readGameForWrite, type GameTouch } from './games.ts';
import {
  completeTransaction,
  gameKeyRange,
  isPlainRecord,
  withGameId,
  withoutGameId,
} from './records.ts';

export async function listRecoveries(database: AppDatabase, gameId: string): Promise<Recovery[]> {
  const values: unknown[] = await database.getAll('recoveries', gameKeyRange(gameId));
  // 本機資料由本程式寫入；備份匯入的補系紀錄由 validateCollections 驗證。
  return values.filter(isPlainRecord).map((value) => withoutGameId(value) as unknown as Recovery);
}

export async function getRecovery(
  database: AppDatabase,
  gameId: string,
  id: string,
): Promise<Recovery | undefined> {
  const value: unknown = await database.get('recoveries', [gameId, id]);
  return isPlainRecord(value) ? (withoutGameId(value) as unknown as Recovery) : undefined;
}

export interface RecoveryWriteState {
  readonly gameYear: number;
  /** 這一局目前的全部補系紀錄，供服務層檢查是否已有進行中的補系。 */
  readonly recoveries: readonly Recovery[];
}

export interface RecoveryChange {
  readonly recovery: Recovery;
  readonly events: readonly HistoryEvent[];
}

export interface RecoveryWrite {
  readonly gameId: string;
  readonly touch: GameTouch;
  /** 在交易內讀出遊戲年與既有補系後產生要寫入的紀錄（設計決策 5.1）。 */
  readonly build: (state: RecoveryWriteState) => RecoveryChange;
}

/** 寫入一筆斷血補系紀錄（需求規格 7.6）：單一交易內更新補系、事件與遊戲局更新時間。 */
export async function writeRecovery(
  database: AppDatabase,
  write: RecoveryWrite,
): Promise<Recovery> {
  const { gameId } = write;
  const transaction = database.transaction(['games', 'recoveries', 'events'], 'readwrite');
  const games = transaction.objectStore('games');
  const recoveries = transaction.objectStore('recoveries');
  return completeTransaction(transaction, async () => {
    const game = await readGameForWrite(games, gameId);
    const stored: unknown[] = await recoveries.getAll(gameKeyRange(gameId));
    const change = write.build({
      gameYear: game.currentYear,
      recoveries: stored
        .filter(isPlainRecord)
        .map((value) => withoutGameId(value) as unknown as Recovery),
    });
    await Promise.all([
      games.put({ ...game, ...write.touch }),
      recoveries.put(withGameId(gameId, change.recovery)),
      ...change.events.map((event) =>
        transaction.objectStore('events').add(withGameId(gameId, event)),
      ),
    ]);
    return change.recovery;
  });
}
