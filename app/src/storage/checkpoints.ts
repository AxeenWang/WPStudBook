import type { Checkpoint } from '../domain/checkpoint.ts';
import type { AppDatabase } from './database.ts';
import {
  completeTransaction,
  gameKeyRange,
  isPlainRecord,
  withGameId,
  withoutGameId,
  type StoredRecord,
} from './records.ts';

function isCheckpoint(value: StoredRecord): value is StoredRecord & Checkpoint {
  return (
    typeof value.id === 'string' &&
    typeof value.gameYear === 'number' &&
    typeof value.createdAt === 'string' &&
    typeof value.pinned === 'boolean' &&
    typeof value.sha256 === 'string' &&
    typeof value.sizeBytes === 'number' &&
    isPlainRecord(value.counts)
  );
}

function toCheckpoints(values: readonly unknown[]): Checkpoint[] {
  return values.filter(isPlainRecord).map(withoutGameId).filter(isCheckpoint);
}

export async function listCheckpoints(
  database: AppDatabase,
  gameId: string,
): Promise<Checkpoint[]> {
  const values: unknown[] = await database.getAll('checkpoints', gameKeyRange(gameId));
  return toCheckpoints(values);
}

export async function getCheckpoint(
  database: AppDatabase,
  gameId: string,
  checkpointId: string,
): Promise<Checkpoint | undefined> {
  const value: unknown = await database.get('checkpoints', [gameId, checkpointId]);
  return toCheckpoints([value])[0];
}

export async function readCheckpointBytes(
  database: AppDatabase,
  gameId: string,
  checkpointId: string,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const value: unknown = await database.get('checkpointData', [gameId, checkpointId]);
  if (!isPlainRecord(value) || !(value.bytes instanceof Uint8Array)) {
    return undefined;
  }
  return new Uint8Array(value.bytes);
}

export interface NewCheckpointRecords {
  readonly gameId: string;
  readonly checkpoint: Checkpoint;
  readonly bytes: Uint8Array<ArrayBuffer>;
  /** 同步選出要清除的檢查點 id；在交易內呼叫，不可等待其他 Promise。 */
  readonly selectPruned: (checkpoints: readonly Checkpoint[]) => readonly string[];
}

/** 以單一交易新增檢查點與內容，並清除 selectPruned 選出的檢查點；回傳清除的 id。 */
export async function insertCheckpoint(
  database: AppDatabase,
  records: NewCheckpointRecords,
): Promise<readonly string[]> {
  const { gameId, checkpoint } = records;
  const transaction = database.transaction(['checkpoints', 'checkpointData'], 'readwrite');
  const checkpoints = transaction.objectStore('checkpoints');
  const data = transaction.objectStore('checkpointData');
  return completeTransaction(transaction, async () => {
    await checkpoints.add(withGameId(gameId, checkpoint));
    await data.add({ gameId, id: checkpoint.id, bytes: records.bytes });
    const values: unknown[] = await checkpoints.getAll(gameKeyRange(gameId));
    const pruned = records.selectPruned(toCheckpoints(values));
    await Promise.all(
      pruned.flatMap((id) => [checkpoints.delete([gameId, id]), data.delete([gameId, id])]),
    );
    return pruned;
  });
}

export async function setCheckpointPinned(
  database: AppDatabase,
  gameId: string,
  checkpointId: string,
  pinned: boolean,
): Promise<void> {
  const transaction = database.transaction('checkpoints', 'readwrite');
  await completeTransaction(transaction, async () => {
    const value: unknown = await transaction.store.get([gameId, checkpointId]);
    if (!isPlainRecord(value)) {
      throw new Error(`找不到檢查點 ${checkpointId}`);
    }
    await transaction.store.put({ ...value, pinned });
  });
}
