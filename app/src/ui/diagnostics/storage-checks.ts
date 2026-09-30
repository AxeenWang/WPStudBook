import { exportBackup } from '../../storage/backup'
import {
  chooseBackupFolder,
  clearBackupFolder,
  prepareBackupTarget,
} from '../../storage/backup-folder'
import { createDatabase, type WPStudBookDatabase } from '../../storage/database'
import { downloadBackup } from '../../storage/download'
import { createGame, listGames } from '../../storage/games'
import type { GameRow } from '../../storage/records'
import { saveBackup, type BackupDelivery } from '../../storage/save-backup'

// 儲存整合驗證（技術設計第 7 節「儲存整合的驗證」）：直接呼叫儲存層的正式函式，
// 使用另一個資料庫名稱，不碰正式資料。每個函式回傳顯示在診斷頁的訊息

/** 驗證用的資料庫名稱 */
export const CHECK_DATABASE = 'wpstudbook-storage-check'

/** 模擬耗時處理的等待時間：超過瀏覽器約 5 秒的使用者操作有效期 */
export const SIMULATED_WORK_MS = 6000

/** 等待 ms 毫秒；測試時換成不等待的函式 */
export type Wait = (ms: number) => Promise<void>

const sleep: Wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 驗證用的資料庫 */
export function checkDatabase(): WPStudBookDatabase {
  return createDatabase(CHECK_DATABASE)
}

/** 驗證用的遊戲局：第一次使用時建立 */
export async function checkGame(db: WPStudBookDatabase): Promise<GameRow> {
  return (await listGames(db))[0] ?? createGame(db, { name: '驗證用', startYear: 2026 })
}

/** 選擇備份資料夾（要由點擊觸發） */
export async function chooseFolderMessage(db: WPStudBookDatabase): Promise<string> {
  const result = await chooseBackupFolder(db)
  if (result.status === 'chosen') return `已選擇資料夾「${result.folderName}」`
  return result.status === 'cancelled' ? '已取消選擇' : '此瀏覽器不支援選擇資料夾'
}

/** 清除資料夾設定 */
export async function clearFolderMessage(db: WPStudBookDatabase): Promise<string> {
  await clearBackupFolder(db)
  return '已清除資料夾設定'
}

/**
 * 模擬年度匯入的自動備份：點擊當下先取得交付目標（申請權限），等待 SIMULATED_WORK_MS 模擬匯入的交易與檢查點，
 * 再儲存備份
 */
export async function simulateAutoBackup(
  db: WPStudBookDatabase,
  wait: Wait = sleep,
): Promise<string> {
  const target = await prepareBackupTarget(db)
  const game = await checkGame(db)
  await wait(SIMULATED_WORK_MS)
  const saved = await saveBackup(db, game.id, target)
  return describeDelivery(saved.delivery, saved.summary.fileName)
}

/** 延遲下載：點擊後等待 SIMULATED_WORK_MS 才下載，模擬回溯在確認後匯出、再交付的下載 */
export async function delayedDownload(db: WPStudBookDatabase, wait: Wait = sleep): Promise<string> {
  const game = await checkGame(db)
  await wait(SIMULATED_WORK_MS)
  const backup = await exportBackup(db, game.id)
  downloadBackup(backup)
  return `已下載：${backup.fileName}`
}

/** 交付方式的說明：寫入的資料夾，或改為下載的原因與錯誤訊息 */
export function describeDelivery(delivery: BackupDelivery, fileName: string): string {
  if (delivery.kind === 'folder') return `已寫入資料夾「${delivery.folderName}」：${fileName}`
  if (delivery.reason === undefined) return `已下載：${fileName}`
  const error = delivery.error === undefined ? '' : `，${delivery.error}`
  return `已改為下載（原因：${delivery.reason}${error}）：${fileName}`
}
