import {
  selectCheckpointsToPrune,
  selectLaterCheckpoints,
  sortCheckpointsByCreation,
  type Checkpoint,
} from '../domain/checkpoint.ts';
import { DEFAULT_GAME_SETTINGS, type Game } from '../domain/game.ts';
import { decodeBackup } from '../storage/backup/decode.ts';
import {
  getCheckpoint,
  insertCheckpoint,
  listCheckpoints,
  readCheckpointBytes,
  setCheckpointPinned as storeCheckpointPinned,
} from '../storage/checkpoints.ts';
import { describeError } from '../storage/describe-error.ts';
import { countGameRecords, readGameSettings } from '../storage/games.ts';
import { BACKUP_COLLECTIONS } from '../storage/schema.ts';
import { replaceGameData } from '../storage/snapshot.ts';
import { encodeGameBackup, formatIssues, migrationEvent, type BackupFile } from './backup.ts';
import { trackWrite, type ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import { requireCurrentGame } from './games.ts';

async function requireCheckpoint(
  context: ServiceContext,
  gameId: string,
  checkpointId: string,
): Promise<Checkpoint> {
  const checkpoint = await getCheckpoint(context.database, gameId, checkpointId);
  if (checkpoint === undefined) {
    throw new ServiceError('checkpointNotFound', '目前遊戲局找不到這個檢查點');
  }
  return checkpoint;
}

/** 目前遊戲局的檢查點，新到舊。 */
export async function listGameCheckpoints(context: ServiceContext): Promise<Checkpoint[]> {
  const game = await requireCurrentGame(context);
  return sortCheckpointsByCreation(await listCheckpoints(context.database, game.id)).reverse();
}

export interface NewCheckpointInput {
  readonly note?: string | undefined;
}

/** 手動建立檢查點（CKPT-02）；內容就是該局的備份文件（設計決策 5.5 節）。 */
export async function createCheckpoint(
  context: ServiceContext,
  input: NewCheckpointInput = {},
): Promise<{ readonly checkpoint: Checkpoint; readonly prunedIds: readonly string[] }> {
  const game = await requireCurrentGame(context);
  const { document, file } = await encodeGameBackup(context, game.id);
  const settings = await readGameSettings(context.database, game.id);
  const retention = settings?.checkpointRetention ?? DEFAULT_GAME_SETTINGS.checkpointRetention;
  const note = input.note === undefined || input.note.trim() === '' ? undefined : input.note;
  const checkpoint: Checkpoint = {
    id: context.newId(),
    gameYear: document.game.currentYear,
    createdAt: document.exportedAt,
    ...(note === undefined ? {} : { note }),
    pinned: false,
    sha256: document.sha256,
    sizeBytes: file.bytes.length,
    counts: document.counts,
  };
  const prunedIds = await trackWrite(context, () =>
    insertCheckpoint(context.database, {
      gameId: game.id,
      checkpoint,
      bytes: file.bytes,
      selectPruned: (all) => selectCheckpointsToPrune(all, retention),
    }),
  );
  return { checkpoint, prunedIds };
}

export async function setCheckpointPinned(
  context: ServiceContext,
  checkpointId: string,
  pinned: boolean,
): Promise<void> {
  const game = await requireCurrentGame(context);
  await requireCheckpoint(context, game.id, checkpointId);
  await trackWrite(context, () =>
    storeCheckpointPinned(context.database, game.id, checkpointId, pinned),
  );
}

export interface RollbackPreview {
  readonly checkpoint: Checkpoint;
  readonly gameName: string;
  readonly currentYear: number;
  readonly targetYear: number;
  /** 目前各資料表筆數，鍵與 checkpoint.counts 相同。 */
  readonly currentCounts: Readonly<Record<string, number>>;
  readonly laterCheckpoints: readonly Checkpoint[];
}

export async function previewRollback(
  context: ServiceContext,
  checkpointId: string,
): Promise<RollbackPreview> {
  const game = await requireCurrentGame(context);
  const checkpoint = await requireCheckpoint(context, game.id, checkpointId);
  const [counts, all] = await Promise.all([
    countGameRecords(context.database, game.id),
    listCheckpoints(context.database, game.id),
  ]);
  return {
    checkpoint,
    gameName: game.name,
    currentYear: game.currentYear,
    targetYear: checkpoint.gameYear,
    currentCounts: Object.fromEntries(BACKUP_COLLECTIONS.map((name) => [name, counts[name]])),
    laterCheckpoints: selectLaterCheckpoints(all, checkpoint),
  };
}

export interface RollbackOptions {
  /** 回溯前交出目前備份，由介面下載（需求規格 12.4、CKPT-04）。失敗時停止回溯。 */
  readonly deliverBackup: (file: BackupFile) => Promise<void>;
}

export interface RollbackResult {
  readonly game: Game;
  readonly removedCheckpointIds: readonly string[];
}

/** 回溯順序：交出目前備份 → 驗證檢查點 → 單一交易還原。只影響目前遊戲局（CKPT-07）。 */
export async function rollbackToCheckpoint(
  context: ServiceContext,
  checkpointId: string,
  options: RollbackOptions,
): Promise<RollbackResult> {
  const game = await requireCurrentGame(context);
  const checkpoint = await requireCheckpoint(context, game.id, checkpointId);

  const { file } = await encodeGameBackup(context, game.id);
  try {
    await options.deliverBackup(file);
  } catch (error) {
    throw new ServiceError(
      'deliveryFailed',
      `無法下載目前備份，已停止回溯，資料未變更：${describeError(error)}`,
      { cause: error },
    );
  }

  const bytes = await readCheckpointBytes(context.database, game.id, checkpoint.id);
  if (bytes === undefined) {
    throw new ServiceError('checkpointInvalid', '檢查點內容不存在，已停止回溯，資料未變更');
  }
  const decoded = await decodeBackup(bytes, {
    schemaVersion: context.schemaVersion,
    migrations: context.migrations,
  });
  if (!decoded.ok) {
    throw new ServiceError(
      'checkpointInvalid',
      `檢查點驗證失敗，已停止回溯，資料未變更：\n${formatIssues(decoded.issues)}`,
    );
  }
  if (decoded.backup.sourceSha256 !== checkpoint.sha256) {
    throw new ServiceError(
      'checkpointInvalid',
      '檢查點內容與建立時記錄的 SHA-256 不符，已停止回溯，資料未變更',
    );
  }

  const { document, sourceSchemaVersion } = decoded.backup;
  const now = context.now().toISOString();
  const removedCheckpointIds = selectLaterCheckpoints(
    await listCheckpoints(context.database, game.id),
    checkpoint,
  ).map((item) => item.id);
  const restoredGame: Game = {
    ...game,
    currentYear: document.game.currentYear,
    updatedAt: now,
    appVersion: context.appVersion,
    lastBackup: {
      fileName: file.fileName,
      exportedAt: file.summary.exportedAt,
      sizeBytes: file.summary.sizeBytes,
      recordCount: file.summary.recordCount,
    },
  };
  const extraEvents =
    sourceSchemaVersion < context.schemaVersion
      ? [
          migrationEvent(context, {
            fromVersion: sourceSchemaVersion,
            gameYear: restoredGame.currentYear,
            occurredAt: now,
          }),
        ]
      : [];
  await trackWrite(context, () =>
    replaceGameData(context.database, {
      game: restoredGame,
      collections: document.collections,
      extraEvents,
      removeCheckpointIds: removedCheckpointIds,
    }),
  );
  return { game: restoredGame, removedCheckpointIds };
}
