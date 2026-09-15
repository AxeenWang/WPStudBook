import type { Breeding, Conception } from '../domain/breeding.ts';
import type { Game } from '../domain/game.ts';
import type { HistoryEvent } from '../domain/history-event.ts';
import type { Mare } from '../domain/mare.ts';
import type { AppDatabase } from './database.ts';
import { readGameForWrite, type GameTouch } from './games.ts';
import { toMare } from './mares.ts';
import {
  completeTransaction,
  gameKeyRange,
  isPlainRecord,
  withGameId,
  withoutGameId,
} from './records.ts';

export function toBreeding(value: unknown): Breeding | undefined {
  // 本機資料由本程式寫入；備份匯入的配種紀錄由 validateCollections 驗證。
  return isPlainRecord(value) ? (withoutGameId(value) as unknown as Breeding) : undefined;
}

/** 指定遊戲年各母馬的受胎狀態（鍵為母馬 id）；沒有受胎狀態的紀錄是未登記，不列入。 */
export async function listConceptionsInYear(
  database: AppDatabase,
  gameId: string,
  gameYear: number,
): Promise<Map<string, Conception>> {
  const breedings = await listBreedings(database, gameId);
  const conceptions = new Map<string, Conception>();
  for (const breeding of breedings) {
    if (breeding.gameYear === gameYear && breeding.conception !== undefined) {
      conceptions.set(breeding.mareId, breeding.conception);
    }
  }
  return conceptions;
}

export async function listBreedings(database: AppDatabase, gameId: string): Promise<Breeding[]> {
  const values: unknown[] = await database.getAll('breedings', gameKeyRange(gameId));
  return values.map(toBreeding).filter((breeding) => breeding !== undefined);
}

/** 以 [gameId, mareId, gameYear] 唯一索引讀取一匹母馬某年的紀錄。 */
export async function getBreeding(
  database: AppDatabase,
  gameId: string,
  mareId: string,
  gameYear: number,
): Promise<Breeding | undefined> {
  const value: unknown = await database.getFromIndex('breedings', 'mareId+gameYear', [
    gameId,
    mareId,
    gameYear,
  ]);
  return toBreeding(value);
}

/** 以唯一索引讀取一匹母馬某年的受胎狀態；未登記時為 undefined。 */
export async function getConception(
  database: AppDatabase,
  gameId: string,
  mareId: string,
  gameYear: number,
): Promise<Conception | undefined> {
  return (await getBreeding(database, gameId, mareId, gameYear))?.conception;
}

/** 一匹母馬全部年度的繁殖紀錄（遊戲年由小到大）。 */
export async function listBreedingsForMare(
  database: AppDatabase,
  gameId: string,
  mareId: string,
): Promise<Breeding[]> {
  const values: unknown[] = await database.getAllFromIndex(
    'breedings',
    'mareId+gameYear',
    IDBKeyRange.bound(
      [gameId, mareId, Number.NEGATIVE_INFINITY],
      [gameId, mareId, Number.POSITIVE_INFINITY],
    ),
  );
  return values.map(toBreeding).filter((breeding) => breeding !== undefined);
}

export interface BreedingWriteState {
  readonly game: Game;
  readonly mare: Mare | undefined;
  /** 交易內讀出的該年紀錄；還沒有時為 undefined。 */
  readonly record: Breeding | undefined;
}

export interface BreedingChange {
  readonly record: Breeding;
  readonly events: readonly HistoryEvent[];
}

export interface BreedingWrite {
  readonly gameId: string;
  readonly mareId: string;
  readonly gameYear: number;
  readonly touch: GameTouch;
  /** 只能做同步運算；丟出錯誤時整筆交易中止。 */
  readonly apply: (current: BreedingWriteState) => BreedingChange;
}

/** 寫入一匹母馬某年的繁殖紀錄：單一交易讀出遊戲局、母馬與該年紀錄，寫回紀錄、事件與遊戲局更新時間。 */
export async function writeBreeding(
  database: AppDatabase,
  write: BreedingWrite,
): Promise<Breeding> {
  const { gameId, mareId } = write;
  const transaction = database.transaction(['games', 'mares', 'breedings', 'events'], 'readwrite');
  const games = transaction.objectStore('games');
  const breedings = transaction.objectStore('breedings');
  return completeTransaction(transaction, async () => {
    const mareRequest: Promise<unknown> = transaction.objectStore('mares').get([gameId, mareId]);
    const recordRequest: Promise<unknown> = breedings
      .index('mareId+gameYear')
      .get([gameId, mareId, write.gameYear]);
    const [game, mare, record] = await Promise.all([
      readGameForWrite(games, gameId),
      mareRequest,
      recordRequest,
    ]);
    const change = write.apply({ game, mare: toMare(mare), record: toBreeding(record) });
    await Promise.all([
      games.put({ ...game, ...write.touch }),
      breedings.put(withGameId(gameId, change.record)),
      ...change.events.map((event) =>
        transaction.objectStore('events').add(withGameId(gameId, event)),
      ),
    ]);
    return change.record;
  });
}
