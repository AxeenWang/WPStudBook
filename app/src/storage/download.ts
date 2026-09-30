import type { ExportedBackup } from './backup'

/** 觸發下載後過多久才釋放網址：立刻釋放時，大檔可能還沒讀完 */
export const REVOKE_DELAY_MS = 60_000

/**
 * 下載檔案（技術設計 4.3「瀏覽器整合」）：以位元組建立 Blob（gzip 為 application/gzip，否則 application/json），
 * 取得網址，建立帶 download 屬性的 <a> 並點擊（不必掛到頁面上），1 分鐘後才釋放網址。
 * 觸發下載就算交出：頁面無法得知使用者有沒有存檔。環境沒有 document 或 URL 時丟出例外
 */
export function downloadFile(
  fileName: string,
  bytes: Uint8Array<ArrayBuffer>,
  compressed: boolean,
): void {
  const blob = new Blob([bytes], { type: compressed ? 'application/gzip' : 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
}

/**
 * 下載匯出的備份。簽章符合回溯的交付函式（RollbackOptions.deliverBackup）：只交出檔案，
 * 不記錄最近備份時間（技術設計 4.3「檢查點與回溯」）
 */
export function downloadBackup(backup: ExportedBackup): void {
  downloadFile(backup.fileName, backup.bytes, backup.summary.compressed)
}
