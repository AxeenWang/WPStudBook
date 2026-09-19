import { sortArchivesNewestFirst, type ArchiveEntry } from '../domain/archive.ts';
import type { Game } from '../domain/game.ts';
import { archiveGameData, deleteArchive, getArchive, listArchives } from '../storage/archives.ts';
import { decodeBackup, type DecodedBackup } from '../storage/backup/decode.ts';
import { canCompress } from '../storage/backup/gzip.ts';
import { countGameRecords, getGame, sumRecordCounts } from '../storage/games.ts';
import {
  computeGameHash,
  encodeGameBackup,
  formatIssues,
  restoreBackupAsNewGame,
  summarizeDecodedBackup,
  type BackupFile,
  type BackupSummary,
} from './backup.ts';
import { trackWrite, type ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import { archiveFileName } from './file-names.ts';
import { nextCurrentGameAfterRemoving } from './games.ts';

export interface ArchiveFile extends BackupFile {
  /** 封存檔內容的 SHA-256。 */
  readonly sha256: string;
}

/** 使用者選取的檔案。 */
export interface ChosenFile {
  readonly fileName: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

async function requireGame(context: ServiceContext, gameId: string): Promise<Game> {
  const game = await getGame(context.database, gameId);
  if (game === undefined) {
    throw new ServiceError('gameNotFound', '找不到這個遊戲局');
  }
  return game;
}

async function decode(context: ServiceContext, bytes: Uint8Array<ArrayBuffer>) {
  return decodeBackup(bytes, {
    schemaVersion: context.schemaVersion,
    migrations: context.migrations,
  });
}

/**
 * 產生封存檔（需求規格 12.3）：與備份相同格式的 `.json.gz`，交出前先在記憶體解壓驗證。
 * 不寫入資料庫；本機明細要等使用者選回下載的檔案核對通過、輸入局名後才移除（completeArchive）。
 */
export async function prepareArchive(
  context: ServiceContext,
  gameId: string,
): Promise<ArchiveFile> {
  await requireGame(context, gameId);
  if (!canCompress()) {
    throw new ServiceError(
      'archiveRejected',
      '這個瀏覽器不支援 gzip 壓縮，無法產生 .json.gz 封存檔；本機資料未變更',
    );
  }
  const { document, file } = await encodeGameBackup(context, gameId, archiveFileName);
  const result = await decode(context, file.bytes);
  if (!result.ok || !result.backup.compressed || result.backup.sourceSha256 !== document.sha256) {
    const details = result.ok ? '' : `\n${formatIssues(result.issues)}`;
    throw new ServiceError(
      'archiveRejected',
      `封存檔在記憶體解壓驗證失敗，本機資料未變更${details}`,
    );
  }
  return { ...file, sha256: document.sha256 };
}

export interface ArchiveVerification {
  /** 核對時讀到的遊戲局；移除明細的交易以它的更新時間確認期間沒有異動。 */
  readonly game: Game;
  readonly summary: BackupSummary;
  readonly sha256: string;
  /** 將移除的本機資料筆數與檢查點數（檢查點不收錄於封存檔）。 */
  readonly recordCount: number;
  readonly checkpointCount: number;
}

/**
 * 核對使用者選回的封存檔（需求規格 12.3「確認已下載」、DATA-09）：在記憶體解壓驗證，且內容雜湊
 * 必須等於這一局目前資料的雜湊。檔案損壞、選錯檔案，或產生封存檔之後這一局有異動時拒絕。不寫入資料庫。
 */
export async function verifyArchiveFile(
  context: ServiceContext,
  gameId: string,
  file: ChosenFile,
): Promise<ArchiveVerification> {
  await requireGame(context, gameId);
  const result = await decode(context, file.bytes);
  if (!result.ok) {
    throw new ServiceError(
      'archiveRejected',
      `「${file.fileName}」驗證失敗，本機資料未變更：\n${formatIssues(result.issues)}`,
    );
  }
  const { backup } = result;
  if (!backup.compressed) {
    throw new ServiceError(
      'archiveRejected',
      `「${file.fileName}」不是 .json.gz 封存檔，本機資料未變更`,
    );
  }
  const current = await computeGameHash(context, gameId);
  if (
    backup.sourceSchemaVersion !== context.schemaVersion ||
    backup.sourceSha256 !== current.sha256
  ) {
    throw new ServiceError(
      'archiveRejected',
      `「${file.fileName}」與「${current.game.name}」目前的資料不一致，本機資料未變更。` +
        '可能選錯檔案，或產生封存檔之後這一局又有異動；請重新產生封存檔。',
    );
  }
  const counts = await countGameRecords(context.database, gameId);
  return {
    game: current.game,
    summary: summarizeDecodedBackup(file.fileName, backup),
    sha256: backup.sourceSha256,
    recordCount: sumRecordCounts(counts),
    checkpointCount: counts.checkpoints,
  };
}

export interface CompleteArchiveInput {
  readonly gameId: string;
  /** 使用者選回核對的封存檔；未選回（未確認已下載）時不移除任何資料。 */
  readonly file: ChosenFile | undefined;
  readonly typedName: string;
}

/**
 * 移除本機明細並保留封存索引（需求規格 12.3、DATA-09）。寫入前重新核對封存檔，不沿用先前的核對結果；
 * 核對後遊戲局有異動時整筆退回。
 */
export async function completeArchive(
  context: ServiceContext,
  input: CompleteArchiveInput,
): Promise<ArchiveEntry> {
  if (input.file === undefined) {
    throw new ServiceError('archiveRejected', '尚未選回下載的封存檔確認已下載，本機資料未變更');
  }
  const verification = await verifyArchiveFile(context, input.gameId, input.file);
  const { game, summary } = verification;
  if (input.typedName !== game.name) {
    throw new ServiceError('confirmationMismatch', '輸入的局名不符，本機資料未變更');
  }
  const nextCurrentGameId = await nextCurrentGameAfterRemoving(context, game.id);
  const entry: ArchiveEntry = {
    id: context.newId(),
    gameName: game.name,
    startYear: game.startYear,
    endYear: game.currentYear,
    appVersion: summary.appVersion,
    schemaVersion: summary.schemaVersion,
    exportedAt: summary.exportedAt,
    archivedAt: context.now().toISOString(),
    fileName: summary.fileName,
    sizeBytes: summary.sizeBytes,
    counts: summary.counts,
    recordCount: summary.recordCount,
    sha256: verification.sha256,
  };
  await trackWrite(context, () =>
    archiveGameData(context.database, {
      gameId: game.id,
      entry,
      nextCurrentGameId,
      check: (stored) => {
        if (stored.updatedAt !== game.updatedAt) {
          throw new ServiceError(
            'archiveRejected',
            `核對封存檔之後「${game.name}」又有異動，本機資料未變更；請重新產生封存檔。`,
          );
        }
      },
    }),
  );
  return entry;
}

/** 封存索引，新到舊。 */
export async function listArchiveEntries(context: ServiceContext): Promise<ArchiveEntry[]> {
  return sortArchivesNewestFirst(await listArchives(context.database));
}

async function requireArchive(context: ServiceContext, archiveId: string): Promise<ArchiveEntry> {
  const entry = await getArchive(context.database, archiveId);
  if (entry === undefined) {
    throw new ServiceError('archiveNotFound', '找不到這筆封存索引');
  }
  return entry;
}

/** 解碼選到的檔案，並以驗證摘要確認它就是這筆索引的封存檔。 */
async function decodeMatchingArchive(
  context: ServiceContext,
  entry: ArchiveEntry,
  file: ChosenFile,
): Promise<DecodedBackup> {
  const result = await decode(context, file.bytes);
  if (!result.ok) {
    throw new ServiceError(
      'archiveRejected',
      `「${file.fileName}」無法使用，資料未變更：\n${formatIssues(result.issues)}`,
    );
  }
  if (result.backup.sourceSha256 !== entry.sha256) {
    throw new ServiceError(
      'archiveRejected',
      `「${file.fileName}」不是「${entry.gameName}」的封存檔（驗證摘要不符），資料未變更`,
    );
  }
  return result.backup;
}

export interface ArchiveRestorePreview {
  readonly entry: ArchiveEntry;
  readonly summary: BackupSummary;
  readonly sourceSchemaVersion: number;
  readonly migrated: boolean;
}

export async function previewArchiveRestore(
  context: ServiceContext,
  archiveId: string,
  file: ChosenFile,
): Promise<ArchiveRestorePreview> {
  const entry = await requireArchive(context, archiveId);
  const backup = await decodeMatchingArchive(context, entry, file);
  return {
    entry,
    summary: summarizeDecodedBackup(file.fileName, backup),
    sourceSchemaVersion: backup.sourceSchemaVersion,
    migrated: backup.sourceSchemaVersion < context.schemaVersion,
  };
}

export interface ArchiveRestoreInput {
  readonly archiveId: string;
  readonly file: ChosenFile;
  /** 新遊戲局名稱，省略時沿用封存檔內的局名。 */
  readonly name?: string | undefined;
}

/** 從封存檔還原為獨立的新遊戲局並切換過去（需求規格 12.3）；索引保留，同一份封存檔可以再還原。 */
export async function restoreArchive(
  context: ServiceContext,
  input: ArchiveRestoreInput,
): Promise<Game> {
  const entry = await requireArchive(context, input.archiveId);
  await decodeMatchingArchive(context, entry, input.file);
  return restoreBackupAsNewGame(context, { bytes: input.file.bytes, name: input.name });
}

/** 只移除索引；封存檔在瀏覽器外，不受影響，仍可從「備份與還原」選擇它還原。 */
export async function removeArchiveEntry(
  context: ServiceContext,
  archiveId: string,
): Promise<void> {
  await requireArchive(context, archiveId);
  await trackWrite(context, () => deleteArchive(context.database, archiveId));
}
