import { SCHEMA_VERSION, type WPStudBookDatabase } from './database'
import { countRows, readGameData, totalRows, type GameData, type RowCounts } from './game-data'
import { APP_VERSION } from './version'

// 備份檔的編碼、解碼與驗證（需求規格 12.2、技術設計 4.3「備份與還原」）

/** 備份檔的格式識別 */
export const BACKUP_FORMAT = 'wpstudbook-backup'

/** 備份檔裡的遊戲局摘要 */
export interface BackupGameSummary {
  id: string
  name: string
  startYear: number
  currentYear: number
}

/** 備份檔的內容：欄位順序就是 JSON 的順序，sha256 是其他欄位的雜湊 */
export interface BackupFile {
  format: typeof BACKUP_FORMAT
  schemaVersion: number
  appVersion: string
  exportedAt: string
  game: BackupGameSummary
  counts: RowCounts
  collections: GameData
  sha256: string
}

/** 匯出完成時顯示的摘要（DATA-07） */
export interface BackupSummary {
  fileName: string
  gameName: string
  counts: RowCounts
  total: number
  /** 檔案大小（位元組） */
  size: number
  schemaVersion: number
  appVersion: string
  exportedAt: string
  /** 是否 gzip 壓縮；瀏覽器不支援 CompressionStream 時為 false，輸出 .json（DATA-06） */
  compressed: boolean
}

/** 匯出的備份：檔名、檔案內容與摘要 */
export interface ExportedBackup {
  fileName: string
  bytes: Uint8Array<ArrayBuffer>
  summary: BackupSummary
}

/**
 * 匯出一局的完整備份（需求規格 12.2、DATA-07）：先取 now 作為匯出時間，再以唯讀交易讀出整局（一致快照），
 * 序列化、雜湊與壓縮在交易外進行。有 CompressionStream 時 gzip 成 .json.gz，否則輸出 .json（DATA-06）。
 * 只讀：不觸發下載，也不記錄最近備份時間，呼叫端交出檔案後以 recordBackup 記錄。遊戲局不存在時丟出錯誤
 */
export async function exportBackup(
  db: WPStudBookDatabase,
  gameId: string,
  now: Date = new Date(),
): Promise<ExportedBackup> {
  const exportedAt = now.toISOString()
  const data = await readGameData(db, gameId)
  const game = data.games[0]!
  const counts = countRows(data)
  const body: Omit<BackupFile, 'sha256'> = {
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt,
    game: {
      id: game.id,
      name: game.name,
      startYear: game.startYear,
      currentYear: game.currentYear,
    },
    counts,
    collections: data,
  }
  const text = JSON.stringify({ ...body, sha256: await sha256Hex(JSON.stringify(body)) })
  const compressed = typeof CompressionStream === 'function'
  const plain = new TextEncoder().encode(text)
  const bytes = compressed ? await gzip(plain) : plain
  const fileName = backupFileName(game.name, game.currentYear, now, compressed)
  return {
    fileName,
    bytes,
    summary: {
      fileName,
      gameName: game.name,
      counts,
      total: totalRows(counts),
      size: bytes.length,
      schemaVersion: SCHEMA_VERSION,
      appVersion: APP_VERSION,
      exportedAt,
      compressed,
    },
  }
}

/** Windows 檔名不允許的字元（另外還有控制字元） */
const UNSAFE_FILE_CHARS = '\\/:*?"<>|'

/**
 * 備份檔名（技術設計 4.3）：WPStudBook_<局名>_<目前遊戲年>年_<YYYYMMDD-HHmmss>，加 .json.gz 或 .json；
 * 時間用本機時間，局名裡 Windows 檔名不允許的字元與控制字元換成 _
 */
export function backupFileName(
  gameName: string,
  currentYear: number,
  at: Date,
  compressed: boolean,
): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const date = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`
  const time = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
  const name = Array.from(gameName, (char) =>
    char < ' ' || UNSAFE_FILE_CHARS.includes(char) ? '_' : char,
  ).join('')
  return `WPStudBook_${name}_${currentYear}年_${date}-${time}${compressed ? '.json.gz' : '.json'}`
}

/** 文字的 UTF-8 位元組的 SHA-256，小寫十六進位 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** 以 CompressionStream 壓縮成 gzip */
async function gzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
