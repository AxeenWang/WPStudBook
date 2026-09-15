import type { HistoryEvent } from '../domain/history-event.ts';
import type { SystemMapEntry } from '../domain/system-map.ts';
import type { AppDatabase } from './database.ts';
import { readGameForWrite, type GameTouch } from './games.ts';
import {
  completeTransaction,
  gameKeyRange,
  isPlainRecord,
  withGameId,
  withoutGameId,
} from './records.ts';

function toEntry(value: unknown): SystemMapEntry | undefined {
  // 本機資料由本程式寫入；備份匯入的對照由 validateCollections 驗證。
  return isPlainRecord(value) ? (withoutGameId(value) as unknown as SystemMapEntry) : undefined;
}

export async function listSystemMapEntries(
  database: AppDatabase,
  gameId: string,
): Promise<SystemMapEntry[]> {
  const values: unknown[] = await database.getAll('systemMap', gameKeyRange(gameId));
  return values.map(toEntry).filter((entry) => entry !== undefined);
}

export async function getSystemMapEntry(
  database: AppDatabase,
  gameId: string,
  entryId: string,
): Promise<SystemMapEntry | undefined> {
  const value: unknown = await database.get('systemMap', [gameId, entryId]);
  return toEntry(value);
}

export async function findSystemMapEntry(
  database: AppDatabase,
  gameId: string,
  subsystem: string,
): Promise<SystemMapEntry | undefined> {
  const value: unknown = await database.getFromIndex('systemMap', 'subsystem', [gameId, subsystem]);
  return toEntry(value);
}

export interface SystemMapWrite {
  readonly gameId: string;
  readonly touch: GameTouch;
  readonly put?: SystemMapEntry | undefined;
  readonly deleteId?: string | undefined;
  readonly event: HistoryEvent;
}

/** 以單一交易寫入對照表變更、事件與遊戲局更新時間。 */
export async function writeSystemMapChange(
  database: AppDatabase,
  write: SystemMapWrite,
): Promise<void> {
  const { gameId } = write;
  const transaction = database.transaction(['games', 'systemMap', 'events'], 'readwrite');
  const games = transaction.objectStore('games');
  const systemMap = transaction.objectStore('systemMap');
  await completeTransaction(transaction, async () => {
    const game = await readGameForWrite(games, gameId);
    await Promise.all([
      games.put({ ...game, ...write.touch }),
      ...(write.deleteId === undefined ? [] : [systemMap.delete([gameId, write.deleteId])]),
      ...(write.put === undefined ? [] : [systemMap.put(withGameId(gameId, write.put))]),
      transaction.objectStore('events').add(withGameId(gameId, write.event)),
    ]);
  });
}
