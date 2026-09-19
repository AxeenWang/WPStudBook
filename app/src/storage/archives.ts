import type { ArchiveEntry } from '../domain/archive.ts';
import type { Game } from '../domain/game.ts';
import type { AppDatabase } from './database.ts';
import { CURRENT_GAME_KEY, readGameForWrite } from './games.ts';
import { completeTransaction, gameKeyRange, isPlainRecord } from './records.ts';
import { GAME_DATA_STORES } from './schema.ts';

function isArchiveEntry(value: unknown): value is ArchiveEntry {
  return (
    isPlainRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.gameName === 'string' &&
    typeof value.startYear === 'number' &&
    typeof value.endYear === 'number' &&
    typeof value.archivedAt === 'string' &&
    typeof value.fileName === 'string' &&
    typeof value.sha256 === 'string' &&
    isPlainRecord(value.counts)
  );
}

export async function listArchives(database: AppDatabase): Promise<ArchiveEntry[]> {
  const values: unknown[] = await database.getAll('archives');
  return values.filter(isArchiveEntry);
}

export async function getArchive(
  database: AppDatabase,
  archiveId: string,
): Promise<ArchiveEntry | undefined> {
  const value: unknown = await database.get('archives', archiveId);
  return isArchiveEntry(value) ? value : undefined;
}

export async function deleteArchive(database: AppDatabase, archiveId: string): Promise<void> {
  await database.delete('archives', archiveId);
}

export interface GameArchival {
  readonly gameId: string;
  readonly entry: ArchiveEntry;
  /** nextCurrentGameId 為 undefined 時清除目前遊戲局。 */
  readonly nextCurrentGameId: string | undefined;
  /**
   * 以寫入交易內讀出的遊戲局確認核對後沒有異動；只能做同步檢查，丟出錯誤時整筆交易中止。
   */
  readonly check: (stored: Game) => void;
}

/**
 * 封存（需求規格 12.3）：以單一交易移除一局的本機明細（含檢查點），並寫入封存索引。
 * 遊戲局在交易內不存在或 check 丟出錯誤時整筆退回，資料不變。
 */
export async function archiveGameData(
  database: AppDatabase,
  archival: GameArchival,
): Promise<void> {
  const { gameId } = archival;
  const transaction = database.transaction(
    ['games', 'appMeta', 'archives', ...GAME_DATA_STORES],
    'readwrite',
  );
  const games = transaction.objectStore('games');
  await completeTransaction(transaction, async () => {
    archival.check(await readGameForWrite(games, gameId));
    const range = gameKeyRange(gameId);
    const appMeta = transaction.objectStore('appMeta');
    await Promise.all([
      games.delete(gameId),
      ...GAME_DATA_STORES.map((name) =>
        transaction.objectStore(name).delete(name === 'gameSettings' ? gameId : range),
      ),
      archival.nextCurrentGameId === undefined
        ? appMeta.delete(CURRENT_GAME_KEY)
        : appMeta.put({ key: CURRENT_GAME_KEY, value: archival.nextCurrentGameId }),
      transaction.objectStore('archives').add(archival.entry),
    ]);
  });
}
