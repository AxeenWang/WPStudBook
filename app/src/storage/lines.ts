import type { HistoryEvent } from '../domain/history-event.ts';
import type { Horse } from '../domain/horse.ts';
import type { Line } from '../domain/line.ts';
import type { StallionDuty } from '../domain/stallion-duty.ts';
import type { SystemMapEntry } from '../domain/system-map.ts';
import type { AppDatabase } from './database.ts';
import { readGameForWrite, type GameTouch } from './games.ts';
import { withHorseNameKeys } from './horses.ts';
import {
  completeTransaction,
  gameKeyRange,
  isPlainRecord,
  withGameId,
  withoutGameId,
  type ReadableStore,
} from './records.ts';

/** 交易內讀取指定系位置；尚未開啟時為 undefined。 */
export async function readLineAt(
  objectStore: (name: 'lines') => ReadableStore,
  gameId: string,
  position: number,
): Promise<Line | undefined> {
  const value: unknown = await objectStore('lines').index('position').get([gameId, position]);
  // 本機資料由本程式寫入；備份匯入的系位置由 validateCollections 驗證。
  return isPlainRecord(value) ? (withoutGameId(value) as unknown as Line) : undefined;
}

export async function listLines(database: AppDatabase, gameId: string): Promise<Line[]> {
  const values: unknown[] = await database.getAll('lines', gameKeyRange(gameId));
  // 本機資料由本程式寫入；備份匯入的系位置由 validateCollections 驗證。
  return values.filter(isPlainRecord).map((value) => withoutGameId(value) as unknown as Line);
}

export interface OpenedLineRecords {
  readonly gameId: string;
  readonly touch: GameTouch;
  readonly line: Line;
  readonly founder: Horse;
  readonly duty: StallionDuty;
  /** 需要新增或更新對照時才有。 */
  readonly systemMapEntry?: SystemMapEntry | undefined;
  readonly events: readonly HistoryEvent[];
}

/** 開啟系位置：以單一交易寫入系位置、零代種牡馬、任期、對照表、事件與遊戲局更新時間。 */
export async function insertOpenedLine(
  database: AppDatabase,
  records: OpenedLineRecords,
): Promise<void> {
  const { gameId, systemMapEntry } = records;
  const transaction = database.transaction(
    ['games', 'lines', 'horses', 'stallionDuties', 'systemMap', 'events'],
    'readwrite',
  );
  const games = transaction.objectStore('games');
  await completeTransaction(transaction, async () => {
    const game = await readGameForWrite(games, gameId);
    await Promise.all([
      games.put({ ...game, ...records.touch }),
      transaction.objectStore('lines').add(withGameId(gameId, records.line)),
      transaction.objectStore('horses').add(withHorseNameKeys(gameId, records.founder)),
      transaction.objectStore('stallionDuties').add(withGameId(gameId, records.duty)),
      ...(systemMapEntry === undefined
        ? []
        : [transaction.objectStore('systemMap').put(withGameId(gameId, systemMapEntry))]),
      ...records.events.map((event) =>
        transaction.objectStore('events').add(withGameId(gameId, event)),
      ),
    ]);
  });
}

export interface LineSystemsUpdate {
  readonly gameId: string;
  readonly touch: GameTouch;
  readonly position: number;
  readonly subsystem: string;
  readonly parentSystem: string;
  /** 需要新增或更新對照時才有。 */
  readonly systemMapEntry?: SystemMapEntry | undefined;
  /** 以交易內讀到的系位置建立事件；回傳 undefined 表示沒有變更。 */
  readonly buildEvents: (line: Line) => readonly HistoryEvent[] | undefined;
}

/**
 * 更新系位置目前的子系統與親系統（需求規格 7.1、LINE-06）：只改名稱，位置、分支、已成立世代、
 * 種牡馬任期與配種紀錄都不動。
 */
export async function writeLineSystems(
  database: AppDatabase,
  update: LineSystemsUpdate,
): Promise<Line> {
  const { gameId, systemMapEntry } = update;
  const transaction = database.transaction(['games', 'lines', 'systemMap', 'events'], 'readwrite');
  const games = transaction.objectStore('games');
  const lines = transaction.objectStore('lines');
  let saved: Line | undefined;
  await completeTransaction(transaction, async () => {
    const current = await readLineAt(
      (name) => transaction.objectStore(name),
      gameId,
      update.position,
    );
    if (current === undefined) {
      throw new Error(`第 ${String(update.position)} 系尚未開啟`);
    }
    const events = update.buildEvents(current);
    if (events === undefined) {
      saved = current;
      return;
    }
    const next: Line = {
      ...current,
      subsystem: update.subsystem,
      parentSystem: update.parentSystem,
    };
    saved = next;
    const game = await readGameForWrite(games, gameId);
    await Promise.all([
      games.put({ ...game, ...update.touch }),
      lines.put(withGameId(gameId, next)),
      ...(systemMapEntry === undefined
        ? []
        : [transaction.objectStore('systemMap').put(withGameId(gameId, systemMapEntry))]),
      ...events.map((event) => transaction.objectStore('events').add(withGameId(gameId, event))),
    ]);
  });
  if (saved === undefined) {
    throw new Error('系位置更新失敗');
  }
  return saved;
}
