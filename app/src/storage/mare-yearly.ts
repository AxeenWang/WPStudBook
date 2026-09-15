import type { Game } from '../domain/game.ts';
import type { HistoryEvent } from '../domain/history-event.ts';
import type { MareYearly } from '../domain/mare-yearly.ts';
import type { AppDatabase } from './database.ts';
import { readGameForWrite, type GameTouch } from './games.ts';
import {
  completeTransaction,
  gameKeyRange,
  isPlainRecord,
  withGameId,
  withoutGameId,
} from './records.ts';

export function toMareYearly(value: unknown): MareYearly | undefined {
  // 本機資料由本程式寫入；備份匯入的年度資料由 validateCollections 驗證。
  return isPlainRecord(value) ? (withoutGameId(value) as unknown as MareYearly) : undefined;
}

export async function listMareYearly(database: AppDatabase, gameId: string): Promise<MareYearly[]> {
  const values: unknown[] = await database.getAll('mareYearly', gameKeyRange(gameId));
  return values.map(toMareYearly).filter((record) => record !== undefined);
}

export async function getMareYearly(
  database: AppDatabase,
  gameId: string,
  horseId: string,
  gameYear: number,
): Promise<MareYearly | undefined> {
  const value: unknown = await database.getFromIndex('mareYearly', 'horseId+gameYear', [
    gameId,
    horseId,
    gameYear,
  ]);
  return toMareYearly(value);
}

export interface MareYearlyWriteState {
  readonly game: Game;
  /** 交易內讀出的目前遊戲年紀錄；還沒有時為 undefined。 */
  readonly record: MareYearly | undefined;
}

export interface MareYearlyChange {
  readonly record: MareYearly;
  readonly events: readonly HistoryEvent[];
}

export interface MareYearlyWrite {
  readonly gameId: string;
  readonly horseId: string;
  readonly touch: GameTouch;
  /** 只能做同步運算；丟出錯誤時整筆交易中止。 */
  readonly apply: (current: MareYearlyWriteState) => MareYearlyChange;
}

/** 寫入目前遊戲年的年度資料：單一交易讀出遊戲局與該年紀錄，寫回紀錄、事件與遊戲局更新時間。 */
export async function writeMareYearly(
  database: AppDatabase,
  write: MareYearlyWrite,
): Promise<MareYearly> {
  const { gameId } = write;
  const transaction = database.transaction(['games', 'mareYearly', 'events'], 'readwrite');
  const games = transaction.objectStore('games');
  const yearly = transaction.objectStore('mareYearly');
  return completeTransaction(transaction, async () => {
    const game = await readGameForWrite(games, gameId);
    const stored: unknown = await yearly
      .index('horseId+gameYear')
      .get([gameId, write.horseId, game.currentYear]);
    const change = write.apply({ game, record: toMareYearly(stored) });
    await Promise.all([
      games.put({ ...game, ...write.touch }),
      yearly.put(withGameId(gameId, change.record)),
      ...change.events.map((event) =>
        transaction.objectStore('events').add(withGameId(gameId, event)),
      ),
    ]);
    return change.record;
  });
}
