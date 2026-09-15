import type { Game, LastBackup } from '../domain/game.ts';
import type { HistoryEvent } from '../domain/history-event.ts';
import type { BackupCollections } from './backup/document.ts';
import type { AppDatabase } from './database.ts';
import { CURRENT_GAME_KEY, isGame } from './games.ts';
import {
  completeTransaction,
  gameKeyRange,
  isPlainRecord,
  withGameId,
  withoutGameId,
  type StoredRecord,
} from './records.ts';
import { BACKUP_COLLECTIONS, RECORD_COLLECTIONS, type BackupCollection } from './schema.ts';

export type SnapshotCollections = Readonly<Record<BackupCollection, readonly StoredRecord[]>>;

export interface GameSnapshot {
  readonly game: Game;
  readonly collections: SnapshotCollections;
}

/** 在同一個唯讀交易內讀取遊戲局紀錄與全部備份資料表，得到一致快照（需求規格 12.2）。 */
export async function readGameSnapshot(
  database: AppDatabase,
  gameId: string,
): Promise<GameSnapshot | undefined> {
  const transaction = database.transaction(['games', ...BACKUP_COLLECTIONS], 'readonly');
  const range = gameKeyRange(gameId);
  return completeTransaction(transaction, async () => {
    const gameValue: unknown = await transaction.objectStore('games').get(gameId);
    const settingsValue: unknown = await transaction.objectStore('gameSettings').get(gameId);
    const recordLists = await Promise.all(
      RECORD_COLLECTIONS.map(async (name): Promise<[BackupCollection, readonly StoredRecord[]]> => {
        const values: unknown[] = await transaction.objectStore(name).getAll(range);
        return [name, values.filter(isPlainRecord).map(withoutGameId)];
      }),
    );
    if (!isGame(gameValue)) {
      return undefined;
    }
    // Object.fromEntries 的回傳型別只有索引簽章；併入陣列後一次呼叫，避免展開到物件字面值時
    // 索引簽章被 TypeScript 捨棄（TS 6 對 { ...indexSignatureType, key: value } 的已知限制）。
    const settingsEntry: [BackupCollection, readonly StoredRecord[]] = [
      'gameSettings',
      isPlainRecord(settingsValue) ? [withoutGameId(settingsValue)] : [],
    ];
    const collections = Object.fromEntries([...recordLists, settingsEntry]) as SnapshotCollections;
    return { game: gameValue, collections };
  });
}

export interface RestoredGame {
  readonly game: Game;
  readonly collections: BackupCollections;
  readonly extraEvents: readonly HistoryEvent[];
}

/** 以單一交易建立還原的新遊戲局並設為目前遊戲局；任何一筆失敗時整筆退回。 */
export async function insertRestoredGame(
  database: AppDatabase,
  restored: RestoredGame,
): Promise<void> {
  const gameId = restored.game.id;
  const transaction = database.transaction(
    ['games', 'appMeta', ...BACKUP_COLLECTIONS],
    'readwrite',
  );
  await Promise.all([
    transaction.objectStore('games').add(restored.game),
    ...restored.collections.gameSettings.map((settings) =>
      transaction.objectStore('gameSettings').add(withGameId(gameId, settings)),
    ),
    ...RECORD_COLLECTIONS.flatMap((name) =>
      restored.collections[name].map((record) =>
        transaction.objectStore(name).add(withGameId(gameId, record)),
      ),
    ),
    ...restored.extraEvents.map((event) =>
      transaction.objectStore('events').add(withGameId(gameId, event)),
    ),
    transaction.objectStore('appMeta').put({ key: CURRENT_GAME_KEY, value: gameId }),
    transaction.done,
  ]);
}

export async function updateLastBackup(
  database: AppDatabase,
  gameId: string,
  lastBackup: LastBackup,
): Promise<void> {
  const transaction = database.transaction('games', 'readwrite');
  await completeTransaction(transaction, async () => {
    const value: unknown = await transaction.store.get(gameId);
    if (!isGame(value)) {
      throw new Error(`找不到遊戲局 ${gameId}，無法記錄最近備份`);
    }
    await transaction.store.put({ ...value, lastBackup });
  });
}
