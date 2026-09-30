import type { WPStudBookDatabase } from './database'
import type { BackupFolderHandle } from './records'

// 備份資料夾（需求規格 12.2「自動備份」，技術設計 4.3「瀏覽器整合」）：全部遊戲局共用一個，存在全域的 meta

/** meta 表中記錄備份資料夾的鍵 */
export const BACKUP_FOLDER_KEY = 'backupFolder'

/** 申請與查詢的權限：讀寫 */
const READWRITE = { mode: 'readwrite' } as const

/** 瀏覽器的 showDirectoryPicker（TypeScript 的 DOM 型別還沒有它） */
type DirectoryPicker = (options: { mode: 'readwrite' }) => Promise<BackupFolderHandle>

function directoryPicker(): DirectoryPicker | undefined {
  return (globalThis as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker
}

/** 瀏覽器能不能選擇備份資料夾；不能時自動備份改為下載 */
export function supportsBackupFolder(): boolean {
  return typeof directoryPicker() === 'function'
}

/** 選擇備份資料夾的結果：選好（附資料夾名稱）、使用者取消、瀏覽器不支援 */
export type ChooseFolderResult =
  { status: 'chosen'; folderName: string } | { status: 'cancelled' } | { status: 'unsupported' }

/**
 * 選擇備份資料夾：要由使用者的點擊觸發。選好後存進 meta，取代原本的資料夾。
 * 使用者取消（AbortError）時什麼都不改；其他錯誤照常丟出
 */
export async function chooseBackupFolder(db: WPStudBookDatabase): Promise<ChooseFolderResult> {
  const pick = directoryPicker()
  if (!pick) return { status: 'unsupported' }
  let folder: BackupFolderHandle
  try {
    folder = await pick(READWRITE)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return { status: 'cancelled' }
    throw error
  }
  await db.meta.put({ key: BACKUP_FOLDER_KEY, value: folder })
  return { status: 'chosen', folderName: folder.name }
}

/** 目前的備份資料夾，供畫面顯示名稱；沒有時為 undefined */
export async function loadBackupFolder(
  db: WPStudBookDatabase,
): Promise<BackupFolderHandle | undefined> {
  const row = await db.meta.get(BACKUP_FOLDER_KEY)
  return row?.key === BACKUP_FOLDER_KEY ? row.value : undefined
}

/** 清除備份資料夾的設定；之後的自動備份改為下載 */
export async function clearBackupFolder(db: WPStudBookDatabase): Promise<void> {
  await db.meta.delete(BACKUP_FOLDER_KEY)
}

/** 改為下載的原因：瀏覽器不支援、沒有選資料夾、未授權 */
export type DownloadReason = 'unsupported' | 'not-set' | 'denied'

/**
 * 交付目標：寫入備份資料夾，或下載。下載的 reason 是改為下載的原因，呼叫端自己選擇下載時沒有；
 * error 是申請權限時丟出的例外
 */
export type BackupTarget =
  | { kind: 'folder'; folder: BackupFolderHandle }
  | { kind: 'download'; reason?: DownloadReason; error?: string }

/**
 * 取得交付目標：要在點擊處理的最前面呼叫，因為瀏覽器只在使用者剛操作後的短時間內允許 requestPermission
 * （技術設計第 7 節）。依序判斷：不支援、沒有資料夾時改為下載；已授權時寫入資料夾；否則申請權限，
 * 允許時寫入資料夾，拒絕或申請時丟出例外都改為下載（denied，例外時附訊息）。權限的例外不丟出，最壞是改為下載
 */
export async function prepareBackupTarget(db: WPStudBookDatabase): Promise<BackupTarget> {
  if (!supportsBackupFolder()) return { kind: 'download', reason: 'unsupported' }
  const folder = await loadBackupFolder(db)
  if (!folder) return { kind: 'download', reason: 'not-set' }
  try {
    if ((await folder.queryPermission(READWRITE)) === 'granted') return { kind: 'folder', folder }
    if ((await folder.requestPermission(READWRITE)) === 'granted') return { kind: 'folder', folder }
    return { kind: 'download', reason: 'denied' }
  } catch (error) {
    return { kind: 'download', reason: 'denied', error: String(error) }
  }
}

/**
 * 把檔案寫入備份資料夾：已有同名檔案時覆寫。中途失敗時 abort，瀏覽器丟掉暫存，不留下寫一半的檔案，
 * 再把錯誤丟出；資料夾被刪除、改名或磁碟已滿都在這裡失敗
 */
export async function writeBackupFile(
  folder: BackupFolderHandle,
  fileName: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<void> {
  const file = await folder.getFileHandle(fileName, { create: true })
  const writable = await file.createWritable()
  try {
    await writable.write(bytes)
    await writable.close()
  } catch (error) {
    await writable.abort().catch(() => undefined)
    throw error
  }
}
