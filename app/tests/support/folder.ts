import { vi } from 'vitest'
import type { WPStudBookDatabase } from '../../src/storage/database'
import type { BackupFolderHandle } from '../../src/storage/records'

export interface FakeFolderOptions {
  /** queryPermission 的結果，Error 時丟出；預設 granted */
  query?: PermissionState | Error
  /** requestPermission 的結果，Error 時丟出；預設 granted */
  request?: PermissionState | Error
  /** 寫入時丟出的錯誤 */
  writeError?: Error
  /** abort 時丟出的錯誤 */
  abortError?: Error
}

/**
 * 假的備份資料夾：記錄寫完（close）的檔案、被 abort 的檔名與權限的呼叫。
 * 它有方法，存不進 fake-indexeddb；要讓 loadBackupFolder 讀到它時用 storeFakeFolder
 */
export function fakeFolder(name = '備份', options: FakeFolderOptions = {}) {
  const files = new Map<string, Uint8Array<ArrayBuffer>>()
  const aborted: string[] = []
  const queryPermission = vi.fn(async () => {
    if (options.query instanceof Error) throw options.query
    return options.query ?? 'granted'
  })
  const requestPermission = vi.fn(async () => {
    if (options.request instanceof Error) throw options.request
    return options.request ?? 'granted'
  })
  const folder: BackupFolderHandle = {
    name,
    queryPermission,
    requestPermission,
    async getFileHandle(fileName) {
      return {
        async createWritable() {
          let written: Uint8Array<ArrayBuffer> | undefined
          return {
            async write(data) {
              if (options.writeError) throw options.writeError
              written = data
            },
            async close() {
              files.set(fileName, written!)
            },
            async abort() {
              aborted.push(fileName)
              if (options.abortError) throw options.abortError
            },
          }
        },
      }
    },
  }
  return { folder, files, aborted, queryPermission, requestPermission }
}

/**
 * 讓 loadBackupFolder 讀到假的資料夾：fake-indexeddb 存物件時會丟掉方法，所以換掉 db.meta.get，
 * 不經過資料庫（meta 的其他鍵也會讀到這一列）。測試結束時要呼叫 vi.restoreAllMocks()
 */
export function storeFakeFolder(db: WPStudBookDatabase, folder: BackupFolderHandle): void {
  vi.spyOn(db.meta, 'get').mockResolvedValue({ key: 'backupFolder', value: folder })
}
