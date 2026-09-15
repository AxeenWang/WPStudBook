import type { Game } from '../domain/game.ts';
import type { HistoryEvent } from '../domain/history-event.ts';
import type { Horse } from '../domain/horse.ts';
import type { Mare } from '../domain/mare.ts';
import type { MatingRating } from '../domain/mating-rating.ts';
import type { AppDatabase } from './database.ts';
import { readGameForWrite, type GameTouch } from './games.ts';
import { toHorse } from './horses.ts';
import { toMare } from './mares.ts';
import {
  completeTransaction,
  gameKeyRange,
  isPlainRecord,
  withGameId,
  withoutGameId,
} from './records.ts';

export function toMatingRating(value: unknown): MatingRating | undefined {
  // 本機資料由本程式寫入；備份匯入的配種評價由 validateCollections 驗證。
  return isPlainRecord(value) ? (withoutGameId(value) as unknown as MatingRating) : undefined;
}

/** 一匹母馬的全部配種評價；唯一索引以種牡馬開頭，所以讀出整局後篩選。 */
export async function listMatingRatingsForMare(
  database: AppDatabase,
  gameId: string,
  mareId: string,
): Promise<MatingRating[]> {
  const values: unknown[] = await database.getAll('matingRatings', gameKeyRange(gameId));
  return values
    .map(toMatingRating)
    .filter((rating): rating is MatingRating => rating?.mareId === mareId);
}

export interface MatingRatingWriteState {
  readonly game: Game;
  readonly mare: Mare | undefined;
  readonly stallion: Horse | undefined;
  /** 同一組合在目前遊戲年已有的評價。 */
  readonly existing: MatingRating | undefined;
}

export interface MatingRatingChange {
  readonly rating: MatingRating;
  readonly events: readonly HistoryEvent[];
}

export interface MatingRatingWrite {
  readonly gameId: string;
  readonly mareId: string;
  readonly stallionId: string;
  readonly touch: GameTouch;
  /** 只能做同步運算；丟出錯誤時整筆交易中止。 */
  readonly apply: (current: MatingRatingWriteState) => MatingRatingChange;
}

/**
 * 寫入配種評價：單一交易讀出遊戲局、母馬、種牡馬與同一組合在目前遊戲年的評價，
 * 寫回評價、事件與遊戲局更新時間。
 */
export async function writeMatingRating(
  database: AppDatabase,
  write: MatingRatingWrite,
): Promise<MatingRating> {
  const { gameId, mareId, stallionId } = write;
  const transaction = database.transaction(
    ['games', 'mares', 'horses', 'matingRatings', 'events'],
    'readwrite',
  );
  const games = transaction.objectStore('games');
  const ratings = transaction.objectStore('matingRatings');
  return completeTransaction(transaction, async () => {
    const mareRequest: Promise<unknown> = transaction.objectStore('mares').get([gameId, mareId]);
    const stallionRequest: Promise<unknown> = transaction
      .objectStore('horses')
      .get([gameId, stallionId]);
    const [game, mare, stallion] = await Promise.all([
      readGameForWrite(games, gameId),
      mareRequest,
      stallionRequest,
    ]);
    const existing: unknown = await ratings
      .index('stallionId+mareId+gameYear')
      .get([gameId, stallionId, mareId, game.currentYear]);
    const change = write.apply({
      game,
      mare: toMare(mare),
      stallion: toHorse(stallion),
      existing: toMatingRating(existing),
    });
    await Promise.all([
      games.put({ ...game, ...write.touch }),
      ratings.put(withGameId(gameId, change.rating)),
      ...change.events.map((event) =>
        transaction.objectStore('events').add(withGameId(gameId, event)),
      ),
    ]);
    return change.rating;
  });
}
