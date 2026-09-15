import type { Game, GameSettings } from '../domain/game.ts';
import type { HistoryEvent } from '../domain/history-event.ts';
import type { AppDatabase } from './database.ts';
import {
  completeTransaction,
  gameKeyRange,
  isPlainRecord,
  withGameId,
  withoutGameId,
  type StoredRecord,
} from './records.ts';
import { ALL_STORES, GAME_DATA_STORES, RECORD_COLLECTIONS, type GameDataStore } from './schema.ts';

export const CURRENT_GAME_KEY = 'currentGameId';

export type GameRecordCounts = Readonly<Record<GameDataStore, number>>;

export function isGame(value: unknown): value is Game {
  return (
    isPlainRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.startYear === 'number' &&
    typeof value.currentYear === 'number'
  );
}

export async function listGames(database: AppDatabase): Promise<Game[]> {
  const values: unknown[] = await database.getAll('games');
  return values.filter(isGame);
}

export async function getGame(database: AppDatabase, gameId: string): Promise<Game | undefined> {
  const value: unknown = await database.get('games', gameId);
  return isGame(value) ? value : undefined;
}

/** 寫入遊戲局資料時一併更新的遊戲局欄位：更新時間與最後寫入的程式版本（需求規格 12.1）。 */
export interface GameTouch {
  readonly updatedAt: string;
  readonly appVersion: string;
}

/** 寫入交易內的 games 資料表；只列出用到的請求，讓不同資料表組合的交易都能傳入。 */
interface GameStore {
  get(key: string): Promise<unknown>;
}

/**
 * 在寫入交易內讀出遊戲局紀錄，呼叫端合併要更新的欄位後在同一交易寫回，
 * 不以操作開始時讀到的舊紀錄覆蓋期間其他寫入（例如最近備份、目前遊戲年）。
 * 找不到時丟出錯誤；呼叫端以 completeTransaction 中止整筆交易。
 */
export async function readGameForWrite(store: GameStore, gameId: string): Promise<Game> {
  const value: unknown = await store.get(gameId);
  if (!isGame(value)) {
    throw new Error(`找不到遊戲局 ${gameId}`);
  }
  return value;
}

export async function getCurrentGameId(database: AppDatabase): Promise<string | undefined> {
  const value: unknown = await database.get('appMeta', CURRENT_GAME_KEY);
  return isPlainRecord(value) && typeof value.value === 'string' ? value.value : undefined;
}

export async function setCurrentGameId(database: AppDatabase, gameId: string): Promise<void> {
  await database.put('appMeta', { key: CURRENT_GAME_KEY, value: gameId });
}

export async function readGameSettings(
  database: AppDatabase,
  gameId: string,
): Promise<GameSettings | undefined> {
  const value: unknown = await database.get('gameSettings', gameId);
  // 本機資料由本程式寫入，只確認是物件；備份匯入的設定由 validateCollections 驗證。
  return isPlainRecord(value) ? (withoutGameId(value) as unknown as GameSettings) : undefined;
}

export interface NewGameRecords {
  readonly game: Game;
  readonly settings: GameSettings;
  readonly systemMap: readonly StoredRecord[];
}

/** 建立遊戲局與設定、複製的系統對照表，並設為目前遊戲局；單一交易。 */
export async function insertGame(database: AppDatabase, records: NewGameRecords): Promise<void> {
  const gameId = records.game.id;
  const transaction = database.transaction(
    ['games', 'gameSettings', 'systemMap', 'appMeta'],
    'readwrite',
  );
  await Promise.all([
    transaction.objectStore('games').add(records.game),
    transaction.objectStore('gameSettings').add(withGameId(gameId, records.settings)),
    ...records.systemMap.map((record) =>
      transaction.objectStore('systemMap').add(withGameId(gameId, record)),
    ),
    transaction.objectStore('appMeta').put({ key: CURRENT_GAME_KEY, value: gameId }),
    transaction.done,
  ]);
}

export interface CurrentYearUpdate {
  readonly gameId: string;
  readonly currentYear: number;
  readonly touch: GameTouch;
  readonly event: HistoryEvent;
}

/** 以單一交易更新目前遊戲年與遊戲局更新時間並寫入事件；回傳寫入後的遊戲局紀錄。 */
export async function updateCurrentYear(
  database: AppDatabase,
  update: CurrentYearUpdate,
): Promise<Game> {
  const transaction = database.transaction(['games', 'events'], 'readwrite');
  const games = transaction.objectStore('games');
  return completeTransaction(transaction, async () => {
    const stored = await readGameForWrite(games, update.gameId);
    const game: Game = { ...stored, currentYear: update.currentYear, ...update.touch };
    await Promise.all([
      games.put(game),
      transaction.objectStore('events').add(withGameId(update.gameId, update.event)),
    ]);
    return game;
  });
}

export async function countGameRecords(
  database: AppDatabase,
  gameId: string,
): Promise<GameRecordCounts> {
  const transaction = database.transaction([...GAME_DATA_STORES], 'readonly');
  const countRequests = GAME_DATA_STORES.map((name) =>
    transaction.objectStore(name).count(name === 'gameSettings' ? gameId : gameKeyRange(gameId)),
  );
  const [counts] = await Promise.all([Promise.all(countRequests), transaction.done]);
  return Object.fromEntries(
    GAME_DATA_STORES.map((name, index) => [name, counts[index] ?? 0]),
  ) as GameRecordCounts;
}

/** 狀態列與備份摘要的「筆數」：只加總各資料表的紀錄，不含設定與檢查點。 */
export function sumRecordCounts(counts: Readonly<Partial<Record<GameDataStore, number>>>): number {
  return RECORD_COLLECTIONS.reduce((total, name) => total + (counts[name] ?? 0), 0);
}

export async function countCheckpointsAfterYear(
  database: AppDatabase,
  gameId: string,
  year: number,
): Promise<number> {
  return database.countFromIndex(
    'checkpoints',
    'gameYear',
    IDBKeyRange.bound([gameId, year], [gameId, Number.POSITIVE_INFINITY], true, false),
  );
}

/** 刪除一局的全部資料；nextCurrentGameId 為 undefined 時清除目前遊戲局。單一交易。 */
export async function deleteGame(
  database: AppDatabase,
  gameId: string,
  nextCurrentGameId: string | undefined,
): Promise<void> {
  const transaction = database.transaction(['games', 'appMeta', ...GAME_DATA_STORES], 'readwrite');
  const range = gameKeyRange(gameId);
  const appMeta = transaction.objectStore('appMeta');
  await Promise.all([
    transaction.objectStore('games').delete(gameId),
    ...GAME_DATA_STORES.map((name) =>
      transaction.objectStore(name).delete(name === 'gameSettings' ? gameId : range),
    ),
    nextCurrentGameId === undefined
      ? appMeta.delete(CURRENT_GAME_KEY)
      : appMeta.put({ key: CURRENT_GAME_KEY, value: nextCurrentGameId }),
    transaction.done,
  ]);
}

export async function clearAllData(database: AppDatabase): Promise<void> {
  const transaction = database.transaction([...ALL_STORES], 'readwrite');
  await Promise.all([
    ...ALL_STORES.map((name) => transaction.objectStore(name).clear()),
    transaction.done,
  ]);
}
