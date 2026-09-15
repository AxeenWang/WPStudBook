import type { HistoryEvent, HistoryEventType } from '../domain/history-event.ts';
import type { AppDatabase } from './database.ts';
import { isPlainRecord, withoutGameId } from './records.ts';

/** 以 [gameId, type, gameYear] 索引讀取同一型別的事件（遊戲年由小到大）。 */
export async function listEventsOfType(
  database: AppDatabase,
  gameId: string,
  type: HistoryEventType,
): Promise<HistoryEvent[]> {
  const values: unknown[] = await database.getAllFromIndex(
    'events',
    'type+gameYear',
    IDBKeyRange.bound(
      [gameId, type, Number.NEGATIVE_INFINITY],
      [gameId, type, Number.POSITIVE_INFINITY],
    ),
  );
  // 本機資料由本程式寫入，只確認是物件；備份匯入的事件由 validateCollections 驗證。
  return values
    .filter(isPlainRecord)
    .map((value) => withoutGameId(value) as unknown as HistoryEvent);
}
