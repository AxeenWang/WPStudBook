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

/**
 * 讀取備份檔的拒絕原因（DATA-04）：
 * - gzip：錯誤或截斷的 gzip
 * - gzip-unsupported：檔案是 gzip，但瀏覽器不支援 DecompressionStream
 * - not-json：截斷或不是 JSON（UTF-8 嚴格解碼或 JSON.parse 失敗）
 * - not-backup：格式識別不符，或結構版本不是 1 以上的整數
 * - future-version：結構版本比目前新；version 是檔案的結構版本
 * - hash：雜湊不符
 */
export type BackupRejection =
  | { kind: 'gzip' }
  | { kind: 'gzip-unsupported' }
  | { kind: 'not-json' }
  | { kind: 'not-backup' }
  | { kind: 'future-version'; version: number }
  | { kind: 'hash' }

/** 還原前的預覽（需求規格 12.2）；schemaVersion 是檔案原本的結構版本 */
export interface BackupPreview {
  gameName: string
  startYear: number
  currentYear: number
  exportedAt: string
  schemaVersion: number
  appVersion: string
  counts: RowCounts
  total: number
}

/** 驗證過的備份：內容已遷移到目前的結構版本 */
export interface VerifiedBackup {
  file: BackupFile
  preview: BackupPreview
}

export type BackupReadResult =
  { status: 'ok'; backup: VerifiedBackup } | { status: 'rejected'; reason: BackupRejection }

/** 讀取備份的步驟：解壓、解析、驗證 */
export type BackupReadStep = 'decompress' | 'parse' | 'verify'

/** 把某一版的備份內容遷移到下一版 */
export type BackupMigration = (file: BackupFile) => BackupFile

/** 逐版遷移，鍵是遷移前的結構版本。結構版本 1 是第一版，目前沒有遷移（技術設計 4.3） */
export const BACKUP_MIGRATIONS: Readonly<Record<number, BackupMigration>> = {}

export interface ReadBackupOptions {
  /** 遷移表；省略時為 BACKUP_MIGRATIONS */
  migrations?: Readonly<Record<number, BackupMigration>>
  /** 目前的結構版本；省略時為 SCHEMA_VERSION */
  currentVersion?: number
  /** 每一步開始時收到步驟（需求規格 12.2「大型檔案顯示進度」） */
  onProgress?: (step: BackupReadStep) => void
}

/**
 * 讀取並驗證備份檔（需求規格 12.2、DATA-04、DATA-05）：依序解壓、解析、格式、版本、雜湊、遷移，
 * 任一步不通過就回傳拒絕與原因，不丟例外（第 5 章的資料來源異常）。開頭是 1F 8B 時當作 gzip，
 * 其他當作未壓縮的 JSON。雜湊在遷移前比對。只讀，不碰資料庫
 */
export async function readBackup(
  bytes: Uint8Array<ArrayBuffer>,
  options: ReadBackupOptions = {},
): Promise<BackupReadResult> {
  const { migrations = BACKUP_MIGRATIONS, currentVersion = SCHEMA_VERSION, onProgress } = options
  const reject = (reason: BackupRejection): BackupReadResult => ({ status: 'rejected', reason })
  let plain = bytes
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    onProgress?.('decompress')
    if (typeof DecompressionStream !== 'function') return reject({ kind: 'gzip-unsupported' })
    try {
      plain = await gunzip(bytes)
    } catch {
      return reject({ kind: 'gzip' })
    }
  }
  onProgress?.('parse')
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain))
  } catch {
    return reject({ kind: 'not-json' })
  }
  onProgress?.('verify')
  if (!isObject(parsed) || parsed.format !== BACKUP_FORMAT) return reject({ kind: 'not-backup' })
  const version = parsed.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return reject({ kind: 'not-backup' })
  }
  if (version > currentVersion) return reject({ kind: 'future-version', version })
  const { sha256, ...body } = parsed
  if (sha256 !== (await sha256Hex(JSON.stringify(body)))) return reject({ kind: 'hash' })
  let file = parsed as unknown as BackupFile
  for (let from = version; from < currentVersion; from++) {
    const migrate = migrations[from]
    if (!migrate) throw new Error(`缺少結構版本 ${from} 的遷移`)
    file = migrate(file)
  }
  return { status: 'ok', backup: { file, preview: previewOf(file, version) } }
}

/** 預覽：局名、起始年與目前遊戲年、匯出時間、檔案原本的結構版本、應用版本、各集合筆數與總筆數 */
function previewOf(file: BackupFile, schemaVersion: number): BackupPreview {
  return {
    gameName: file.game.name,
    startYear: file.game.startYear,
    currentYear: file.game.currentYear,
    exportedAt: file.exportedAt,
    schemaVersion,
    appVersion: file.appVersion,
    counts: file.counts,
    total: totalRows(file.counts),
  }
}

/** 以 DecompressionStream 解開 gzip；錯誤或截斷時丟出例外 */
async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** 是不是 null 以外的物件；陣列也算，缺少的欄位由之後的檢查擋下 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
