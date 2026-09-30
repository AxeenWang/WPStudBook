import {
  exportBackup,
  readBackup,
  type BackupRejection,
  type ExportedBackup,
  type ReadBackupOptions,
  type VerifiedBackup,
} from './backup'
import type { WPStudBookDatabase } from './database'
import { gameTables, type RowCounts } from './game-data'
import { deleteGame, loadGame, type DeleteGameBlock } from './games'
import type { ArchiveRow } from './records'
import type { WriteResult } from './writes'

// 封存舊遊戲局與封存索引（需求規格 12.3，技術設計 4.3「封存」）

/**
 * 準備封存的拒絕原因：讀回驗證的拒絕原因（BackupRejection），另加
 * - compression-unsupported：瀏覽器沒有 CompressionStream；封存檔一律是 .json.gz，不改存 .json
 */
export type ArchiveRejection = BackupRejection | { kind: 'compression-unsupported' }

/** 準備好的封存：由 prepareArchive 在驗證通過後產生 */
export interface PreparedArchive {
  /** 封存檔：畫面以 downloadBackup 下載，重新下載也用它 */
  backup: ExportedBackup
  /** 封存後寫入的索引 */
  index: ArchiveRow
  /** 快照當下遊戲局的更新時間；封存時核對 */
  updatedAt: string
}

export type ArchivePrepareResult =
  { status: 'ok'; archive: PreparedArchive } | { status: 'rejected'; reason: ArchiveRejection }

/**
 * 準備封存（需求規格 12.3、DATA-09、DATA-22）：沒有 CompressionStream 時拒絕，什麼都不讀。
 * 以 exportBackup 匯出，再以 readBackup 在記憶體讀回同一份位元組（解壓、雜湊與內容的驗證），
 * 不通過時原樣回傳拒絕原因。索引的欄位取自驗證過的檔案；更新時間取自檔案裡 games 那一列，與快照同一個時間點。
 * 只讀，不觸發下載：畫面下載、取得使用者確認後，再以 archiveGame 移除本機明細。遊戲局不存在時丟出錯誤
 */
export async function prepareArchive(
  db: WPStudBookDatabase,
  gameId: string,
  now: Date = new Date(),
): Promise<ArchivePrepareResult> {
  if (typeof CompressionStream !== 'function') {
    return { status: 'rejected', reason: { kind: 'compression-unsupported' } }
  }
  const backup = await exportBackup(db, gameId, now)
  const read = await readBackup(backup.bytes)
  if (read.status === 'rejected') return read
  const { file } = read.backup
  const index: ArchiveRow = {
    id: file.game.id,
    name: file.game.name,
    appVersion: file.appVersion,
    schemaVersion: file.schemaVersion,
    startYear: file.game.startYear,
    currentYear: file.game.currentYear,
    exportedAt: file.exportedAt,
    fileName: backup.fileName,
    counts: file.counts,
    sha256: file.sha256,
  }
  const { updatedAt } = file.collections.games[0]!
  return { status: 'ok', archive: { backup, index, updatedAt } }
}

/**
 * 封存的阻止原因：
 * - changed-since-archive：準備之後這一局有變更，封存檔不含這些變更，要重新產生（DATA-20）
 * - name-mismatch：輸入的局名不符（同永久刪除此局）
 */
export type ArchiveBlock = { kind: 'changed-since-archive' } | DeleteGameBlock

/** 封存的結果：寫入的索引與刪除的各表筆數 */
export interface ArchivedGame {
  archive: ArchiveRow
  counts: RowCounts
}

/**
 * 封存（需求規格 12.3、DATA-09、DATA-20）：畫面下載封存檔、使用者確認已下載並輸入局名後呼叫。
 * 在一個 rw 交易內：遊戲局的更新時間要等於準備時的值，否則阻止，什麼都不刪；接著以 deleteGame
 * 核對局名（不符時阻止）並刪除整局、這一局的檢查點與目前遊戲局的指向；最後寫入索引。不寫事件。
 * 遊戲局不存在時丟出錯誤（例如同一份封存送出兩次）
 */
export async function archiveGame(
  db: WPStudBookDatabase,
  prepared: PreparedArchive,
  typedName: string,
): Promise<WriteResult<ArchivedGame, ArchiveBlock>> {
  const { index } = prepared
  const tables = [...gameTables(db), db.meta, db.checkpoints, db.checkpointContents, db.archives]
  return db.transaction('rw', tables, async () => {
    const game = await loadGame(db, index.id)
    if (game.updatedAt !== prepared.updatedAt) {
      return { status: 'blocked', blocks: [{ kind: 'changed-since-archive' }] }
    }
    const deleted = await deleteGame(db, index.id, typedName)
    if (deleted.status !== 'done') return deleted
    await db.archives.add(index)
    return { status: 'done', value: { archive: index, counts: deleted.value }, warnings: [] }
  })
}

/** 全部封存索引，依匯出時間由新到舊 */
export async function listArchives(db: WPStudBookDatabase): Promise<ArchiveRow[]> {
  const rows = await db.archives.toArray()
  return rows.sort((a, b) => b.exportedAt.localeCompare(a.exportedAt))
}

/**
 * 從封存還原前讀取檔案的拒絕原因：備份的拒絕原因（BackupRejection），另加
 * - archive-mismatch：檔案的 sha256 與索引的驗證摘要不同，選錯檔案（DATA-21）
 */
export type ArchiveReadRejection = BackupRejection | { kind: 'archive-mismatch' }

export type ArchiveReadResult =
  { status: 'ok'; backup: VerifiedBackup } | { status: 'rejected'; reason: ArchiveReadRejection }

/**
 * 讀取使用者為這一筆封存索引選的檔案（需求規格 12.3、DATA-21）：以 readBackup 驗證（可傳進度回呼），
 * 拒絕原因原樣回傳；檔案的 sha256 與索引不同時拒絕。通過時回傳驗證過的備份，由畫面以 restoreBackup
 * 還原成新遊戲局；索引保留，封存檔可以重複還原。只讀；找不到索引時丟出錯誤
 */
export async function readArchive(
  db: WPStudBookDatabase,
  archiveId: string,
  bytes: Uint8Array<ArrayBuffer>,
  options: ReadBackupOptions = {},
): Promise<ArchiveReadResult> {
  const index = await loadArchive(db, archiveId)
  const read = await readBackup(bytes, options)
  if (read.status === 'rejected') return read
  if (read.backup.file.sha256 !== index.sha256) {
    return { status: 'rejected', reason: { kind: 'archive-mismatch' } }
  }
  return read
}

/**
 * 移除封存索引（需求規格 12.3、DATA-21）：只刪這一筆索引，封存檔不受影響；要不要先確認由畫面決定。
 * 找不到索引時丟出錯誤
 */
export async function removeArchive(db: WPStudBookDatabase, archiveId: string): Promise<void> {
  await db.transaction('rw', db.archives, async () => {
    await loadArchive(db, archiveId)
    await db.archives.delete(archiveId)
  })
}

/** 讀取封存索引；找不到時丟出錯誤 */
async function loadArchive(db: WPStudBookDatabase, archiveId: string): Promise<ArchiveRow> {
  const index = await db.archives.get(archiveId)
  if (!index) throw new Error(`找不到封存索引：${archiveId}`)
  return index
}
