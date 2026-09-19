import type { Game, LastBackup } from '../domain/game.ts';
import type { HistoryEvent } from '../domain/history-event.ts';
import type { BackupCollections } from './backup/document.ts';
import type { AppDatabase } from './database.ts';
import { CURRENT_GAME_KEY, isGame } from './games.ts';
import { withHorseNameKeys } from './horses.ts';
import {
  completeTransaction,
  gameKeyRange,
  isPlainRecord,
  withGameId,
  withoutGameId,
  type StoredRecord,
} from './records.ts';
import {
  BACKUP_COLLECTIONS,
  CHECKPOINT_STORES,
  RECORD_COLLECTIONS,
  type BackupCollection,
  type RecordCollection,
} from './schema.ts';

/** 寫入各資料表的紀錄；horses 的備份內容不含 nameKeys，寫入時依名稱重建（設計決策 5.2 節）。 */
function toStoredRecord(
  gameId: string,
  collection: RecordCollection,
  record: object,
): StoredRecord {
  return collection === 'horses' ? withHorseNameKeys(gameId, record) : withGameId(gameId, record);
}

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

/** 寫入進度的回報次數上限；每筆都回報會讓畫面更新比寫入本身還慢。 */
const WRITE_PROGRESS_STEPS = 50;

/**
 * 以單一交易建立還原的新遊戲局並設為目前遊戲局；任何一筆失敗時整筆退回。
 * onWritten 回報已寫入的紀錄筆數（含設定），供大型檔案顯示進度（需求規格 12.2）。
 */
export async function insertRestoredGame(
  database: AppDatabase,
  restored: RestoredGame,
  onWritten?: (done: number, total: number) => void,
): Promise<void> {
  const gameId = restored.game.id;
  const transaction = database.transaction(
    ['games', 'appMeta', ...BACKUP_COLLECTIONS],
    'readwrite',
  );
  const gameRequest = transaction.objectStore('games').add(restored.game);
  const records = [
    ...restored.collections.gameSettings.map((settings) =>
      transaction.objectStore('gameSettings').add(withGameId(gameId, settings)),
    ),
    ...RECORD_COLLECTIONS.flatMap((name) =>
      restored.collections[name].map((record) =>
        transaction.objectStore(name).add(toStoredRecord(gameId, name, record)),
      ),
    ),
    ...restored.extraEvents.map((event) =>
      transaction.objectStore('events').add(withGameId(gameId, event)),
    ),
  ];
  const total = records.length;
  const step = Math.max(1, Math.ceil(total / WRITE_PROGRESS_STEPS));
  let done = 0;
  const counted =
    onWritten === undefined
      ? records
      : records.map((request) =>
          request.then((key) => {
            done += 1;
            if (done % step === 0 || done === total) {
              onWritten(done, total);
            }
            return key;
          }),
        );
  await Promise.all([
    gameRequest,
    ...counted,
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

export interface GameReplacement {
  /** 回溯後的遊戲局紀錄（目前遊戲年已改為檢查點年份）。 */
  readonly game: Game;
  readonly collections: BackupCollections;
  readonly extraEvents: readonly HistoryEvent[];
  readonly removeCheckpointIds: readonly string[];
}

/**
 * 回溯：以單一交易清除該局的備份資料表、寫入檢查點內容、更新遊戲局並移除較晚的檢查點（需求規格 12.4）。
 * IndexedDB 依排入順序執行請求，所以刪除一定在新增之前完成。
 */
export async function replaceGameData(
  database: AppDatabase,
  replacement: GameReplacement,
): Promise<void> {
  const gameId = replacement.game.id;
  const range = gameKeyRange(gameId);
  const transaction = database.transaction(
    ['games', ...BACKUP_COLLECTIONS, ...CHECKPOINT_STORES],
    'readwrite',
  );
  const requests = [
    transaction.objectStore('games').put(replacement.game),
    transaction.objectStore('gameSettings').delete(gameId),
    ...RECORD_COLLECTIONS.map((name) => transaction.objectStore(name).delete(range)),
    ...CHECKPOINT_STORES.flatMap((name) =>
      replacement.removeCheckpointIds.map((id) =>
        transaction.objectStore(name).delete([gameId, id]),
      ),
    ),
    ...replacement.collections.gameSettings.map((settings) =>
      transaction.objectStore('gameSettings').add(withGameId(gameId, settings)),
    ),
    ...RECORD_COLLECTIONS.flatMap((name) =>
      replacement.collections[name].map((record) =>
        transaction.objectStore(name).add(toStoredRecord(gameId, name, record)),
      ),
    ),
    ...replacement.extraEvents.map((event) =>
      transaction.objectStore('events').add(withGameId(gameId, event)),
    ),
  ];
  await Promise.all([...requests, transaction.done]);
}
