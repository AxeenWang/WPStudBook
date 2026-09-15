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
} from './records.ts';

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
