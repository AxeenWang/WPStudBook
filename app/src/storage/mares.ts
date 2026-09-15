import type { Game } from '../domain/game.ts';
import type { HistoryEvent } from '../domain/history-event.ts';
import type { Horse } from '../domain/horse.ts';
import type { Mare } from '../domain/mare.ts';
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

export function toMare(value: unknown): Mare | undefined {
  // 本機資料由本程式寫入；備份匯入的母馬由 validateCollections 驗證。
  return isPlainRecord(value) ? (withoutGameId(value) as unknown as Mare) : undefined;
}

export async function listMares(database: AppDatabase, gameId: string): Promise<Mare[]> {
  const values: unknown[] = await database.getAll('mares', gameKeyRange(gameId));
  return values.map(toMare).filter((mare) => mare !== undefined);
}

export async function getMare(
  database: AppDatabase,
  gameId: string,
  mareId: string,
): Promise<Mare | undefined> {
  const value: unknown = await database.get('mares', [gameId, mareId]);
  return toMare(value);
}

export interface NewMareRecords {
  readonly horse: Horse;
  readonly mare: Mare;
  readonly events: readonly HistoryEvent[];
}

export interface MareInsert {
  readonly gameId: string;
  readonly touch: GameTouch;
  /** 以寫入交易內讀出的遊戲局產生紀錄與事件；只能做同步運算，丟出錯誤時整筆交易中止。 */
  readonly build: (game: Game) => NewMareRecords;
}

/** 新增繁殖牝馬：以單一交易寫入馬匹、母馬、事件與遊戲局更新時間。 */
export async function insertMare(
  database: AppDatabase,
  insert: MareInsert,
): Promise<NewMareRecords> {
  const { gameId } = insert;
  const transaction = database.transaction(['games', 'horses', 'mares', 'events'], 'readwrite');
  const games = transaction.objectStore('games');
  return completeTransaction(transaction, async () => {
    const game = await readGameForWrite(games, gameId);
    const records = insert.build(game);
    await Promise.all([
      games.put({ ...game, ...insert.touch }),
      transaction.objectStore('horses').add(withHorseNameKeys(gameId, records.horse)),
      transaction.objectStore('mares').add(withGameId(gameId, records.mare)),
      ...records.events.map((event) =>
        transaction.objectStore('events').add(withGameId(gameId, event)),
      ),
    ]);
    return records;
  });
}

export interface MareWriteState {
  readonly game: Game;
  readonly mare: Mare;
}

export interface MareChange {
  readonly mare: Mare;
  readonly events: readonly HistoryEvent[];
}

export interface MareModification {
  readonly gameId: string;
  readonly mareId: string;
  readonly touch: GameTouch;
  /** 以寫入交易內讀出的遊戲局與母馬產生新紀錄與事件；只能做同步運算，丟出錯誤時整筆交易中止。 */
  readonly apply: (current: MareWriteState) => MareChange;
}

/** 修改一匹母馬：單一交易讀出遊戲局與母馬，寫回母馬、事件與遊戲局更新時間。 */
export async function modifyMare(
  database: AppDatabase,
  modification: MareModification,
): Promise<Mare> {
  const { gameId, mareId } = modification;
  const transaction = database.transaction(['games', 'mares', 'events'], 'readwrite');
  const games = transaction.objectStore('games');
  const mares = transaction.objectStore('mares');
  return completeTransaction(transaction, async () => {
    const storedRequest: Promise<unknown> = mares.get([gameId, mareId]);
    const [game, stored] = await Promise.all([readGameForWrite(games, gameId), storedRequest]);
    const mare = toMare(stored);
    if (mare === undefined) {
      throw new Error(`找不到繁殖牝馬 ${mareId}`);
    }
    const change = modification.apply({ game, mare });
    await Promise.all([
      games.put({ ...game, ...modification.touch }),
      mares.put(withGameId(gameId, change.mare)),
      ...change.events.map((event) =>
        transaction.objectStore('events').add(withGameId(gameId, event)),
      ),
    ]);
    return change.mare;
  });
}
