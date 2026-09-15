import { checkGameName, type Game, type LastBackup } from '../domain/game.ts';
import { GAME_SUBJECT_ID, type HistoryEvent } from '../domain/history-event.ts';
import { validateCollections, type BackupIssue } from '../storage/backup/collections.ts';
import { decodeBackup, type DecodeStage } from '../storage/backup/decode.ts';
import {
  buildBackupDocument,
  encodeBackupDocument,
  type BackupCounts,
  type BackupDocument,
  type BackupGameSummary,
} from '../storage/backup/document.ts';
import { sumRecordCounts } from '../storage/games.ts';
import { insertRestoredGame, readGameSnapshot, updateLastBackup } from '../storage/snapshot.ts';
import { trackWrite, type ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import { backupFileName } from './file-names.ts';
import { requireCurrentGame } from './games.ts';

export interface BackupSummary {
  readonly fileName: string;
  readonly gameName: string;
  readonly counts: BackupCounts;
  readonly recordCount: number;
  readonly sizeBytes: number;
  readonly appVersion: string;
  readonly schemaVersion: number;
  readonly exportedAt: string;
  readonly compressed: boolean;
}

export interface BackupFile {
  readonly fileName: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly summary: BackupSummary;
  /** 產生此備份的遊戲局。 */
  readonly gameId: string;
}

export function formatIssues(issues: readonly BackupIssue[]): string {
  return issues.map((item) => item.message).join('\n');
}

/** 產生一局的備份內容。匯出與檢查點共用；本機資料不符合資料契約時拒絕，確保產生的檔案可以還原。 */
export async function encodeGameBackup(
  context: ServiceContext,
  gameId: string,
): Promise<{ readonly document: BackupDocument; readonly file: BackupFile }> {
  const snapshot = await readGameSnapshot(context.database, gameId);
  if (snapshot === undefined) {
    throw new ServiceError('gameNotFound', '找不到這個遊戲局');
  }
  const validation = validateCollections(snapshot.collections);
  if (!validation.ok) {
    throw new ServiceError(
      'backupRejected',
      `本機資料不符合資料契約，無法產生備份：\n${formatIssues(validation.issues)}`,
    );
  }
  const { game } = snapshot;
  const exportedAt = context.now().toISOString();
  const document = await buildBackupDocument({
    schemaVersion: context.schemaVersion,
    appVersion: context.appVersion,
    exportedAt,
    game: { name: game.name, startYear: game.startYear, currentYear: game.currentYear },
    collections: validation.collections,
  });
  const encoded = await encodeBackupDocument(document);
  const fileName = backupFileName({
    gameName: game.name,
    currentYear: game.currentYear,
    exportedAt,
    compressed: encoded.compressed,
  });
  return {
    document,
    file: {
      fileName,
      mediaType: encoded.compressed ? 'application/gzip' : 'application/json',
      bytes: encoded.bytes,
      gameId,
      summary: {
        fileName,
        gameName: game.name,
        counts: document.counts,
        recordCount: sumRecordCounts(document.counts),
        sizeBytes: encoded.bytes.length,
        appVersion: document.appVersion,
        schemaVersion: document.schemaVersion,
        exportedAt,
        compressed: encoded.compressed,
      },
    },
  };
}

/** 只產生備份檔，不寫入資料庫；下載失敗時使用者仍拿得到檔案（先交出檔案，再記錄最近備份）。 */
export async function exportBackup(context: ServiceContext): Promise<BackupFile> {
  const game = await requireCurrentGame(context);
  const { file } = await encodeGameBackup(context, game.id);
  return file;
}

/** 交出備份檔後記錄「最近備份」；失敗時錯誤往外丟，但已交出的檔案不受影響。 */
export async function recordDeliveredBackup(
  context: ServiceContext,
  file: BackupFile,
): Promise<void> {
  const lastBackup: LastBackup = {
    fileName: file.fileName,
    exportedAt: file.summary.exportedAt,
    sizeBytes: file.summary.sizeBytes,
    recordCount: file.summary.recordCount,
  };
  await trackWrite(context, () => updateLastBackup(context.database, file.gameId, lastBackup));
}

export type BackupPreview =
  | {
      readonly ok: true;
      readonly summary: BackupSummary;
      readonly game: BackupGameSummary;
      readonly sourceSchemaVersion: number;
      readonly migrated: boolean;
    }
  | { readonly ok: false; readonly stage: DecodeStage; readonly issues: readonly BackupIssue[] };

export async function previewBackupFile(
  context: ServiceContext,
  fileName: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<BackupPreview> {
  const result = await decodeBackup(bytes, {
    schemaVersion: context.schemaVersion,
    migrations: context.migrations,
  });
  if (!result.ok) {
    return { ok: false, stage: result.stage, issues: result.issues };
  }
  const { backup } = result;
  return {
    ok: true,
    game: backup.document.game,
    sourceSchemaVersion: backup.sourceSchemaVersion,
    migrated: backup.sourceSchemaVersion < context.schemaVersion,
    summary: {
      fileName,
      gameName: backup.document.game.name,
      counts: backup.document.counts,
      recordCount: sumRecordCounts(backup.document.counts),
      sizeBytes: backup.sizeBytes,
      appVersion: backup.sourceAppVersion,
      schemaVersion: backup.sourceSchemaVersion,
      exportedAt: backup.document.exportedAt,
      compressed: backup.compressed,
    },
  };
}

export function migrationEvent(
  context: ServiceContext,
  input: { readonly fromVersion: number; readonly gameYear: number; readonly occurredAt: string },
): HistoryEvent {
  return {
    id: context.newId(),
    subjectId: GAME_SUBJECT_ID,
    type: 'schemaMigrated',
    gameYear: input.gameYear,
    before: { schemaVersion: input.fromVersion },
    after: { schemaVersion: context.schemaVersion },
    source: 'migration',
    occurredAt: input.occurredAt,
  };
}

export interface RestoreInput {
  readonly bytes: Uint8Array<ArrayBuffer>;
  /** 新遊戲局名稱，省略時沿用備份內的局名。 */
  readonly name?: string | undefined;
}

/** 還原為新遊戲局並切換過去（需求規格 12.2）。寫入前重新驗證，不沿用預覽結果。 */
export async function restoreBackupAsNewGame(
  context: ServiceContext,
  input: RestoreInput,
): Promise<Game> {
  const result = await decodeBackup(input.bytes, {
    schemaVersion: context.schemaVersion,
    migrations: context.migrations,
  });
  if (!result.ok) {
    throw new ServiceError('backupRejected', formatIssues(result.issues));
  }
  const { document, sourceSchemaVersion } = result.backup;
  const name = input.name ?? document.game.name;
  if (checkGameName(name) !== undefined) {
    throw new ServiceError('invalidInput', '請輸入遊戲局名稱');
  }
  const now = context.now().toISOString();
  const game: Game = {
    id: context.newId(),
    name,
    startYear: document.game.startYear,
    currentYear: document.game.currentYear,
    createdAt: now,
    updatedAt: now,
    appVersion: context.appVersion,
  };
  const extraEvents =
    sourceSchemaVersion < context.schemaVersion
      ? [
          migrationEvent(context, {
            fromVersion: sourceSchemaVersion,
            gameYear: game.currentYear,
            occurredAt: now,
          }),
        ]
      : [];
  await trackWrite(context, () =>
    insertRestoredGame(context.database, { game, collections: document.collections, extraEvents }),
  );
  return game;
}
