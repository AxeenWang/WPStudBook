import {
  encodeBackup,
  exportBackup,
  readBackup,
  type BackupRejection,
  type ExportedBackup,
} from './backup'
import type { WPStudBookDatabase } from './database'
import {
  addGameData,
  countRows,
  deleteGameData,
  gameTables,
  readGameData,
  type GameData,
  type RowCounts,
} from './game-data'
import { loadGame, loadSettings } from './games'
import type {
  CatchUpImport,
  CheckpointOrigin,
  CheckpointRow,
  EventRow,
  GameRow,
  GameTiming,
} from './records'
import { APP_VERSION } from './version'
import { isGameTiming, type WriteResult } from './writes'

// 檢查點與回溯（需求規格 11.1、12.4，技術設計 4.3「檢查點與回溯」）

export interface NewCheckpoint {
  /** 年度匯入後自動建立，或手動建立 */
  origin: CheckpointOrigin
  /** 遊戲內的時點：年度匯入後是目前進度的時點；手動建立時可以省略 */
  timing?: GameTiming
  /** 直接補匯時，補匯的年與時點（CKPT-08） */
  catchUp?: CatchUpImport
  /** 註記；去除前後空白，空白時不存 */
  note?: string
  /** 建立時間；省略時為現在 */
  now?: Date
}

/** 建立的檢查點，與因此被清除的檢查點 */
export interface CreatedCheckpoint {
  checkpoint: CheckpointRow
  removed: CheckpointRow[]
}

/**
 * 建立檢查點（需求規格 12.4、CKPT-01、CKPT-02、CKPT-08）：先取 now 作為建立時間，再以唯讀交易讀出整局（一致快照），
 * 在交易外編成備份檔，最後以一個 rw 交易寫入中繼資料與內容，並清除超過保留個數的檢查點（剛建立的一定留著）。
 * 在呼叫端的 Dexie 交易外呼叫：編碼用到瀏覽器的非同步 API，放進交易會讓交易提前提交；年度匯入提交後再建立。
 * 年是建立當下這一局的目前遊戲年。不改遊戲局的更新時間與應用版本：建立檢查點不是資料變更。
 * 時點不是 1～12 月、1～4 週，或補匯的年不是整數時丟出 RangeError，什麼都不寫；遊戲局不存在時丟出錯誤
 */
export async function createCheckpoint(
  db: WPStudBookDatabase,
  gameId: string,
  input: NewCheckpoint,
): Promise<CreatedCheckpoint> {
  const { origin, timing, catchUp } = input
  if (timing !== undefined && !isGameTiming(timing)) {
    throw new RangeError(`遊戲內的時點不符：${timing.month} 月 ${timing.week} 週`)
  }
  if (catchUp !== undefined && !(Number.isInteger(catchUp.year) && isGameTiming(catchUp.timing))) {
    const { year, timing: at } = catchUp
    throw new RangeError(`補匯的年與時點不符：${year} 年 ${at.month} 月 ${at.week} 週`)
  }
  const createdAt = (input.now ?? new Date()).toISOString()
  const data = await readGameData(db, gameId)
  const { bytes, sha256 } = await encodeBackup(data, createdAt)
  const note = input.note?.trim()
  const checkpoint: CheckpointRow = {
    id: crypto.randomUUID(),
    gameId,
    origin,
    year: data.games[0]!.currentYear,
    ...(timing === undefined ? {} : { timing }),
    ...(catchUp === undefined ? {} : { catchUp }),
    createdAt,
    sha256,
    ...(note ? { note } : {}),
    pinned: false,
  }
  const tables = [db.games, db.settings, db.checkpoints, db.checkpointContents]
  return db.transaction('rw', tables, async () => {
    const { checkpointLimit } = await loadSettings(db, gameId)
    await db.checkpoints.add(checkpoint)
    await db.checkpointContents.add({ checkpointId: checkpoint.id, gameId, bytes })
    // 剛建立的一定留著：系統時鐘往回調時，它的建立時間可能不是最新的
    const others = (await listCheckpoints(db, gameId)).filter(
      (row) => !row.pinned && row.id !== checkpoint.id,
    )
    const removed = others.slice(checkpointLimit - 1)
    await deleteCheckpoints(db, removed)
    return { checkpoint, removed }
  })
}

/** 一局的檢查點（只讀中繼資料），依建立時間由新到舊。遊戲局不存在時丟出錯誤 */
export async function listCheckpoints(
  db: WPStudBookDatabase,
  gameId: string,
): Promise<CheckpointRow[]> {
  return db.transaction('r', [db.games, db.checkpoints], async () => {
    await loadGame(db, gameId)
    const rows = await db.checkpoints.where('gameId').equals(gameId).toArray()
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  })
}

/**
 * 釘選或取消釘選（需求規格 12.4）：釘選的不計入保留個數，也不自動清除。不觸發清除：
 * 取消釘選後超過保留個數的，等下一次建立檢查點時才清除。不改遊戲局的更新時間。
 * 找不到遊戲局、檢查點，或檢查點屬於其他局時丟出錯誤
 */
export async function setCheckpointPinned(
  db: WPStudBookDatabase,
  gameId: string,
  checkpointId: string,
  pinned: boolean,
): Promise<CheckpointRow> {
  return db.transaction('rw', [db.games, db.checkpoints], async () => {
    const checkpoint = await loadCheckpoint(db, gameId, checkpointId)
    await db.checkpoints.update(checkpointId, { pinned })
    return { ...checkpoint, pinned }
  })
}

/**
 * 修改註記（需求規格 12.4）：去除前後空白，空白時移除註記。不改遊戲局的更新時間。
 * 找不到遊戲局、檢查點，或檢查點屬於其他局時丟出錯誤
 */
export async function updateCheckpointNote(
  db: WPStudBookDatabase,
  gameId: string,
  checkpointId: string,
  note: string,
): Promise<CheckpointRow> {
  return db.transaction('rw', [db.games, db.checkpoints], async () => {
    const checkpoint = { ...(await loadCheckpoint(db, gameId, checkpointId)) }
    const trimmed = note.trim()
    if (trimmed === '') delete checkpoint.note
    else checkpoint.note = trimmed
    await db.checkpoints.put(checkpoint)
    return checkpoint
  })
}

/**
 * 讀取檢查點的拒絕原因（CKPT-05）：備份的拒絕原因（BackupRejection），另加
 * - content-missing：內容不見了
 * - content-mismatch：內容檔案的 sha256 或遊戲局識別與檢查點不符
 */
export type CheckpointRejection =
  BackupRejection | { kind: 'content-missing' } | { kind: 'content-mismatch' }

/** 回溯的預覽（CKPT-04） */
export interface RollbackPreview {
  checkpoint: CheckpointRow
  /** 目前遊戲年：目前的值與回溯後的值 */
  currentYear: { from: number; to: number }
  /** 各表的筆數：目前與檢查點 */
  counts: { current: RowCounts; checkpoint: RowCounts }
  /** 將捨棄的事件：目前有而檢查點沒有的，依寫入時間排序 */
  discardedEvents: EventRow[]
  /** 將移除的較晚檢查點（建立時間晚於這個檢查點，含釘選的），由新到舊 */
  removedCheckpoints: CheckpointRow[]
  /** 預覽當下遊戲局的更新時間；回溯時核對 */
  updatedAt: string
}

/** 驗證過的檢查點：data 已遷移到目前的結構 */
export interface VerifiedCheckpoint {
  data: GameData
  preview: RollbackPreview
}

export type CheckpointReadResult =
  | { status: 'ok'; verified: VerifiedCheckpoint }
  | { status: 'rejected'; reason: CheckpointRejection }

/**
 * 驗證檢查點並預覽回溯（需求規格 12.4、CKPT-04、CKPT-05）：以一個唯讀交易讀出遊戲局、檢查點、內容、
 * 目前整局資料與較晚的檢查點；交易外以 readBackup 驗證內容，再核對檔案的 sha256 與遊戲局識別。
 * 不通過時回傳拒絕原因，不丟例外，資料不變；通過時回傳遷移到目前結構的資料與預覽。
 * 找不到遊戲局、檢查點，或檢查點屬於其他局時丟出錯誤
 */
export async function readCheckpoint(
  db: WPStudBookDatabase,
  gameId: string,
  checkpointId: string,
): Promise<CheckpointReadResult> {
  const tables = [...gameTables(db), db.checkpoints, db.checkpointContents]
  const { checkpoint, content, current, later } = await db.transaction('r', tables, async () => {
    const checkpoint = await loadCheckpoint(db, gameId, checkpointId)
    return {
      checkpoint,
      content: await db.checkpointContents.get(checkpointId),
      current: await readGameData(db, gameId),
      later: await laterCheckpoints(db, checkpoint),
    }
  })
  if (!content) return { status: 'rejected', reason: { kind: 'content-missing' } }
  const read = await readBackup(content.bytes)
  if (read.status === 'rejected') return read
  const { file } = read.backup
  if (file.sha256 !== checkpoint.sha256 || file.game.id !== gameId) {
    return { status: 'rejected', reason: { kind: 'content-mismatch' } }
  }
  const data = file.collections
  const kept = new Set(data.events.map((event) => event.id))
  const discardedEvents = current.events
    .filter((event) => !kept.has(event.id))
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
  const preview: RollbackPreview = {
    checkpoint,
    currentYear: { from: current.games[0]!.currentYear, to: data.games[0]!.currentYear },
    counts: { current: countRows(current), checkpoint: countRows(data) },
    discardedEvents,
    removedCheckpoints: later,
    updatedAt: current.games[0]!.updatedAt,
  }
  return { status: 'ok', verified: { data, preview } }
}

/** 回溯的阻止原因：預覽之後遊戲局有變更，交付的備份不一定含有將捨棄的全部資料 */
export interface RollbackBlock {
  kind: 'changed-since-preview'
}

export interface RollbackOptions {
  /**
   * 交出目前這一局的備份（下載由 3-3 的輔助函式負責）；丟出錯誤時回溯停止，資料不變。
   * 只交出檔案，不要記錄最近備份時間（recordBackup）：交出的是回溯前的狀態（技術設計 4.3）
   */
  deliverBackup: (backup: ExportedBackup) => Promise<void> | void
  /** 回溯的時間：備份的匯出時間與回溯後的更新時間；省略時為現在 */
  now?: Date
}

/** 回溯的結果：回溯後的遊戲局與被移除的較晚檢查點 */
export interface RolledBack {
  game: GameRow
  removed: CheckpointRow[]
}

/**
 * 回溯到驗證過的檢查點（需求規格 12.4、CKPT-04、CKPT-06、CKPT-07）：先以 exportBackup 匯出目前這一局，
 * 交給 deliverBackup；它丟出錯誤時回溯停止，資料不變。接著在一個 rw 交易內：遊戲局的更新時間要等於預覽時的值，
 * 否則阻止，什麼都不寫；以 deleteGameData 刪除整局，再以 addGameData 寫回檢查點的資料（識別不變）；
 * 刪除較晚的檢查點與內容，含釘選的。games 那一列：目前遊戲年取檢查點，應用版本為目前版本，更新時間為 now，
 * 其他欄位（局名、起始年、建立時間、最近備份時間、還原來源）沿用目前的列；settings 沿用目前的列。
 * 不記錄最近備份時間：交付的備份是回溯前的狀態。不寫事件。找不到遊戲局，或檢查點已不在時丟出錯誤
 */
export async function rollbackToCheckpoint(
  db: WPStudBookDatabase,
  verified: VerifiedCheckpoint,
  options: RollbackOptions,
): Promise<WriteResult<RolledBack, RollbackBlock>> {
  const { data, preview } = verified
  const { checkpoint } = preview
  const { gameId } = checkpoint
  const now = options.now ?? new Date()
  await options.deliverBackup(await exportBackup(db, gameId, now))
  const tables = [...gameTables(db), db.checkpoints, db.checkpointContents]
  return db.transaction('rw', tables, async () => {
    const current = await loadGame(db, gameId)
    if (current.updatedAt !== preview.updatedAt) {
      return { status: 'blocked', blocks: [{ kind: 'changed-since-preview' }] }
    }
    await loadCheckpoint(db, gameId, checkpoint.id)
    const settings = await loadSettings(db, gameId)
    const game: GameRow = {
      ...current,
      currentYear: data.games[0]!.currentYear,
      appVersion: APP_VERSION,
      updatedAt: now.toISOString(),
    }
    await deleteGameData(db, gameId)
    await addGameData(db, { ...data, games: [game], settings: [settings] })
    const removed = await laterCheckpoints(db, checkpoint)
    await deleteCheckpoints(db, removed)
    return { status: 'done', value: { game, removed }, warnings: [] }
  })
}

/** 這一局建立時間晚於這個檢查點的檢查點（含釘選的），由新到舊 */
async function laterCheckpoints(
  db: WPStudBookDatabase,
  checkpoint: CheckpointRow,
): Promise<CheckpointRow[]> {
  const rows = await listCheckpoints(db, checkpoint.gameId)
  return rows.filter((row) => row.createdAt > checkpoint.createdAt)
}

/** 讀取這一局的檢查點；找不到遊戲局、檢查點，或檢查點屬於其他局時丟出錯誤 */
async function loadCheckpoint(
  db: WPStudBookDatabase,
  gameId: string,
  checkpointId: string,
): Promise<CheckpointRow> {
  await loadGame(db, gameId)
  const checkpoint = await db.checkpoints.get(checkpointId)
  if (!checkpoint || checkpoint.gameId !== gameId) {
    throw new Error(`找不到這一局的檢查點：${checkpointId}`)
  }
  return checkpoint
}

/** 刪除檢查點的中繼資料與內容 */
async function deleteCheckpoints(
  db: WPStudBookDatabase,
  rows: readonly CheckpointRow[],
): Promise<void> {
  const ids = rows.map((row) => row.id)
  await db.checkpoints.bulkDelete(ids)
  await db.checkpointContents.bulkDelete(ids)
}
