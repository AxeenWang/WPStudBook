import { SCHEMA_VERSION, type WPStudBookDatabase } from './database'
import {
  GAME_TABLES,
  addGameData,
  countRows,
  readGameData,
  remapIds,
  totalRows,
  type GameData,
  type GameTableName,
  type RowCounts,
} from './game-data'
import type { GameRow } from './records'
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
 * - field：欄位不符；path 指出位置，例如 collections.horses[3].id（集合、資料列與欄位）
 * - duplicate-id：重複識別：同一集合的主鍵重複（複合主鍵以 + 連接），或 id 跨集合重複；
 *   collection 是重複出現的集合
 * - missing-relation：缺少關聯；path 指出引用的欄位，value 是找不到的識別
 * - count：筆數不符；collection 是筆數對不上的集合
 */
export type BackupRejection =
  | { kind: 'gzip' }
  | { kind: 'gzip-unsupported' }
  | { kind: 'not-json' }
  | { kind: 'not-backup' }
  | { kind: 'future-version'; version: number }
  | { kind: 'hash' }
  | { kind: 'field'; path: string }
  | { kind: 'duplicate-id'; collection: string; id: string }
  | { kind: 'missing-relation'; path: string; value: string }
  | { kind: 'count'; collection: string }

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
 * 再檢查集合的欄位、重複、關聯與筆數。任一步不通過就回傳拒絕與原因，不丟例外（第 5 章的資料來源異常）。
 * 開頭是 1F 8B 時當作 gzip，其他當作未壓縮的 JSON。雜湊在遷移前比對。只讀，不碰資料庫
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
  const invalid = checkCollections(file)
  if (invalid) return reject(invalid)
  return { status: 'ok', backup: { file, preview: previewOf(file, version) } }
}

/** 各表的主鍵欄位與型別，與資料庫的結構相同（database.ts） */
const PRIMARY_KEYS: Record<GameTableName, readonly (readonly [string, 'string' | 'number'])[]> = {
  games: [['id', 'string']],
  settings: [['gameId', 'string']],
  horses: [['id', 'string']],
  lines: [
    ['gameId', 'string'],
    ['line', 'number'],
  ],
  systems: [
    ['gameId', 'string'],
    ['subsystem', 'string'],
  ],
  mares: [['horseId', 'string']],
  mareYears: [
    ['gameId', 'string'],
    ['horseId', 'string'],
    ['year', 'number'],
  ],
  stallions: [['id', 'string']],
  restorations: [['id', 'string']],
  breedings: [['id', 'string']],
  matingRatings: [['id', 'string']],
  events: [['id', 'string']],
  horseNumbers: [['id', 'string']],
}

/**
 * 資料列層級的引用：集合、欄位（巢狀欄位以 . 連接）與指向的集合（技術設計 4.3）。
 * 事件內容裡的引用不查：取消預定後繼會刪除任用列，事件裡的任用識別本來就可能懸空
 */
const RELATIONS: readonly (readonly [GameTableName, string, GameTableName])[] = [
  ['horses', 'sireId', 'horses'],
  ['horses', 'damId', 'horses'],
  ['horses', 'birth.breedingId', 'breedings'],
  ['mares', 'horseId', 'horses'],
  ['mareYears', 'horseId', 'mares'],
  ['stallions', 'horseId', 'horses'],
  ['stallions', 'breedingId', 'breedings'],
  ['stallions', 'restorationId', 'restorations'],
  ['breedings', 'mareId', 'mares'],
  ['breedings', 'sireId', 'horses'],
  ['matingRatings', 'mareId', 'mares'],
  ['matingRatings', 'sireId', 'horses'],
  ['horseNumbers', 'horseId', 'horses'],
  ['events', 'horseId', 'horses'],
]

/**
 * 集合的內容檢查（技術設計 4.3「讀取與驗證」的欄位、重複、關聯與筆數），通過時回傳 undefined。
 * 不逐欄驗證型別與列舉值：檔案完整性由雜湊保證
 */
function checkCollections(file: BackupFile): BackupRejection | undefined {
  // 欄位：集合剛好是 GAME_TABLES，每一列是物件、主鍵欄位的型別正確、屬於這一局；摘要與 games 那一列一致
  const collections: unknown = file.collections
  if (!isObject(collections)) return { kind: 'field', path: 'collections' }
  for (const name of Object.keys(collections)) {
    if (!GAME_TABLES.includes(name as GameTableName)) {
      return { kind: 'field', path: `collections.${name}` }
    }
  }
  for (const name of GAME_TABLES) {
    if (!Array.isArray(collections[name])) return { kind: 'field', path: `collections.${name}` }
  }
  const tables = collections as Record<GameTableName, Record<string, unknown>[]>
  for (const name of ['games', 'settings'] as const) {
    if (tables[name].length !== 1) return { kind: 'field', path: `collections.${name}` }
  }
  const game = tables.games[0]!
  for (const name of GAME_TABLES) {
    for (const [index, row] of tables[name].entries()) {
      const path = `collections.${name}[${index}]`
      if (!isObject(row)) return { kind: 'field', path }
      for (const [field, type] of PRIMARY_KEYS[name]) {
        if (typeof row[field] !== type) return { kind: 'field', path: `${path}.${field}` }
      }
      if (name !== 'games' && row.gameId !== game.id) {
        return { kind: 'field', path: `${path}.gameId` }
      }
    }
  }
  const summary: unknown = file.game
  const fields = ['id', 'name', 'startYear', 'currentYear'] as const
  if (!isObject(summary) || fields.some((field) => summary[field] !== game[field])) {
    return { kind: 'field', path: 'game' }
  }
  // 重複：各表主鍵不重複，所有 id 跨表也不重複（還原時共用一張新舊對照表）
  const ids = new Set<unknown>()
  for (const name of GAME_TABLES) {
    const keys = new Set<string>()
    for (const row of tables[name]) {
      const key = PRIMARY_KEYS[name].map(([field]) => String(row[field])).join('+')
      if (keys.has(key)) return { kind: 'duplicate-id', collection: name, id: key }
      keys.add(key)
      if (row.id === undefined) continue
      if (ids.has(row.id)) return { kind: 'duplicate-id', collection: name, id: String(row.id) }
      ids.add(row.id)
    }
  }
  // 關聯：資料列層級的引用都找得到
  for (const [name, field, target] of RELATIONS) {
    const [keyField] = PRIMARY_KEYS[target][0]!
    const targets = new Set(tables[target].map((row) => row[keyField]))
    for (const [index, row] of tables[name].entries()) {
      const value = field
        .split('.')
        .reduce<unknown>((item, part) => (isObject(item) ? item[part] : undefined), row)
      if (value !== undefined && !targets.has(value)) {
        const path = `collections.${name}[${index}].${field}`
        return { kind: 'missing-relation', path, value: String(value) }
      }
    }
  }
  // 筆數：counts 的鍵與各集合的筆數相符
  const counts: unknown = file.counts
  const declared = isObject(counts) ? counts : {}
  for (const name of new Set([...GAME_TABLES, ...Object.keys(declared)])) {
    if (declared[name] !== (tables as Record<string, unknown[]>)[name]?.length) {
      return { kind: 'count', collection: name }
    }
  }
  return undefined
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

export interface RestoreOptions {
  /** 備份檔名，記在還原來源 */
  fileName: string
  /** 新局的局名；省略時用備份的局名 */
  name?: string
  /** 還原的時間；省略時為現在 */
  now?: Date
  /** 每張表寫完後收到已寫筆數與總筆數（需求規格 12.2「大型檔案顯示進度」） */
  onProgress?: (written: number, total: number) => void
}

/**
 * 把驗證過的備份還原成新遊戲局（需求規格 12.2）：在一個 rw 交易內寫入全部資料表，失敗時整筆回復。
 * 識別全部重新產生（remapIds），原局還在也不相撞。新局的局名用 name（去除前後空白），省略時用備份的局名，
 * 可以與既有的局重複；建立時間為還原的時間，更新時間沿用備份的；應用版本為目前版本；
 * 最近備份時間為備份的匯出時間（內容與備份檔相同）；還原來源記檔名、匯出時間、原局名、
 * 備份的應用版本與檔案原本的結構版本（DATA-05）。不切換目前遊戲局。局名空白時丟出 RangeError，什麼都不寫
 */
export async function restoreBackup(
  db: WPStudBookDatabase,
  backup: VerifiedBackup,
  options: RestoreOptions,
): Promise<GameRow> {
  const { file, preview } = backup
  const name = (options.name ?? file.game.name).trim()
  if (name === '') throw new RangeError('局名不能空白')
  const data = remapIds(file.collections)
  const game: GameRow = {
    ...data.games[0]!,
    name,
    createdAt: (options.now ?? new Date()).toISOString(),
    appVersion: APP_VERSION,
    lastBackupAt: file.exportedAt,
    restoredFrom: {
      fileName: options.fileName,
      exportedAt: file.exportedAt,
      gameName: file.game.name,
      appVersion: file.appVersion,
      schemaVersion: preview.schemaVersion,
    },
  }
  await addGameData(db, { ...data, games: [game] }, options.onProgress)
  return game
}
