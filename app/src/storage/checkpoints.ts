import { encodeBackup } from './backup'
import type { WPStudBookDatabase } from './database'
import { readGameData } from './game-data'
import { loadGame, loadSettings } from './games'
import type { CatchUpImport, CheckpointOrigin, CheckpointRow, GameTiming } from './records'
import { isGameTiming } from './writes'

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
 * 在交易外編成備份檔，最後以一個 rw 交易寫入中繼資料與內容，並清除超過保留個數的檢查點。
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
    const unpinned = (await listCheckpoints(db, gameId)).filter((row) => !row.pinned)
    const removed = unpinned.slice(checkpointLimit)
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
