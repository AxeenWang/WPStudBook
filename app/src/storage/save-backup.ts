import { exportBackup, type BackupSummary, type ExportedBackup } from './backup'
import { writeBackupFile, type BackupTarget, type DownloadReason } from './backup-folder'
import type { WPStudBookDatabase } from './database'
import { downloadBackup } from './download'
import { recordBackup } from './games'
import type { GameRow } from './records'

/**
 * 實際的交付方式：寫入備份資料夾，或下載。下載的 reason 是改為下載的原因（write-failed 是寫入資料夾失敗），
 * 呼叫端自己選擇下載時沒有；error 是丟出的例外
 */
export type BackupDelivery =
  | { kind: 'folder'; folderName: string }
  | { kind: 'download'; reason?: DownloadReason | 'write-failed'; error?: string }

/** 儲存備份的結果：備份摘要（DATA-07）、記錄最近備份時間後的遊戲局與實際的交付方式 */
export interface SavedBackup {
  summary: BackupSummary
  game: GameRow
  delivery: BackupDelivery
}

/**
 * 儲存這一局的備份（需求規格 12.2、DATA-15，技術設計 4.3「瀏覽器整合」）：以 exportBackup 匯出，再交給目標：
 * 資料夾時寫入，失敗時改為下載；下載時直接下載。交出後才以 recordBackup 記錄最近備份時間（匯出時間）；
 * 下載丟出例外時照常丟出，不記錄。自動備份與手動匯出共用：目標由 prepareBackupTarget 在點擊當下取得，
 * 或由呼叫端傳 { kind: 'download' }。遊戲局不存在時丟出錯誤，什麼都不交出
 */
export async function saveBackup(
  db: WPStudBookDatabase,
  gameId: string,
  target: BackupTarget,
  now: Date = new Date(),
): Promise<SavedBackup> {
  const backup = await exportBackup(db, gameId, now)
  const delivery = await deliver(backup, target)
  const game = await recordBackup(db, gameId, backup.summary.exportedAt)
  return { summary: backup.summary, game, delivery }
}

/** 交出備份：寫入資料夾失敗時改為下載 */
async function deliver(backup: ExportedBackup, target: BackupTarget): Promise<BackupDelivery> {
  if (target.kind === 'download') {
    downloadBackup(backup)
    return target
  }
  try {
    await writeBackupFile(target.folder, backup.fileName, backup.bytes)
    return { kind: 'folder', folderName: target.folder.name }
  } catch (error) {
    downloadBackup(backup)
    return { kind: 'download', reason: 'write-failed', error: String(error) }
  }
}
