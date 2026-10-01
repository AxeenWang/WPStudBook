import {
  ANNUAL_TIMINGS,
  importProgress,
  isAnnualImport,
  type GamePoint,
  type ImportPlan,
  type ImportRecord,
  type ImportSnapshot,
} from '../core/imports'
import { prepareBackupTarget } from './backup-folder'
import { createCheckpoint, type CreatedCheckpoint } from './checkpoints'
import type { WPStudBookDatabase } from './database'
import { gameTables } from './game-data'
import { loadGame, setCurrentYear } from './games'
import type { EventSource } from './records'
import { saveBackup, type SavedBackup } from './save-backup'
import { runWrite, type WriteOptions, type WriteResult } from './writes'

// CE 匯入的快照與套用（技術設計 4.4「資料流」「流程」）

/**
 * 讀出匯入比對快照（技術設計 4.4「資料流」第 4 步）：在一個唯讀交易內讀遊戲局、這一局的匯入紀錄與檢查點的摘要。
 * 遊戲局不存在時丟出錯誤
 */
export async function loadImportSnapshot(
  db: WPStudBookDatabase,
  gameId: string,
): Promise<ImportSnapshot> {
  return db.transaction('r', [db.games, db.imports, db.checkpoints], async () => {
    const game = await loadGame(db, gameId)
    const imports = await db.imports.where('gameId').equals(gameId).toArray()
    const checkpoints = await db.checkpoints.where('gameId').equals(gameId).toArray()
    return {
      gameId,
      currentYear: game.currentYear,
      updatedAt: game.updatedAt,
      imports,
      checkpoints: checkpoints.map(({ id, year, timing, createdAt }) => ({
        id,
        year,
        ...(timing === undefined ? {} : { timing }),
        createdAt,
      })),
    }
  })
}

/** 套用的阻止原因：預覽之後遊戲局有變更，由畫面重新預覽（技術設計 4.4「資料流」第 7 步） */
export interface ImportApplyBlock {
  kind: 'changed-since-preview'
}

/** 交易提交後的一步：完成時附結果，失敗時附錯誤訊息；失敗不撤銷匯入 */
export type AfterImport<T> = { status: 'done'; value: T } | { status: 'failed'; error: string }

/** 套用的結果：匯入紀錄；年度匯入另附檢查點與自動備份的結果 */
export interface AppliedImport {
  record: ImportRecord
  checkpoint?: AfterImport<CreatedCheckpoint>
  backup?: AfterImport<SavedBackup>
}

export interface ApplyImportOptions {
  /** 套用時間：匯入紀錄的套用時間、遊戲局的更新時間、檢查點的建立時間與備份的匯出時間；省略時為現在 */
  now?: Date
}

/**
 * 套用匯入（需求規格 11.1、12.2、12.4，技術設計 4.4「流程」）：畫面在「套用」的點擊處理裡直接呼叫。
 * 年度匯入的第一個 await 是 prepareBackupTarget：瀏覽器只在使用者剛操作後的短時間內允許申請權限
 * （技術設計第 7 節）；累加與選用匯入不備份，不呼叫。接著在一個 rw 交易內（GAME_TABLES）：遊戲局的
 * 更新時間不等於計畫的 expectedUpdatedAt 時阻止（changed-since-preview），什麼都不寫；有 advanceYear 時
 * 先推進年份；套用計畫的項目（4-3 起加入）；最後寫入匯入紀錄，遊戲局的更新時間跟著更新。
 * 交易提交後，年度匯入先建立檢查點（auto，時點是套用後的目前進度，直接補匯另記補匯的年與時點），
 * 再以取得的目標儲存備份；兩步各自失敗時不撤銷匯入，結果附上錯誤訊息。遊戲局不存在時丟出錯誤
 */
export async function applyImport(
  db: WPStudBookDatabase,
  plan: ImportPlan,
  options: ApplyImportOptions = {},
): Promise<WriteResult<AppliedImport, ImportApplyBlock>> {
  const target = isAnnualImport(plan.type) ? await prepareBackupTarget(db) : undefined
  const now = options.now ?? new Date()
  const committed = await commitImport(db, plan, now)
  if (committed === undefined) {
    return { status: 'blocked', blocks: [{ kind: 'changed-since-preview' }] }
  }
  const { record, progress } = committed
  // target 只在年度匯入時取得；累加與選用匯入不建立檢查點、不備份（需求規格 11.1、IMP-12）
  if (target === undefined || !isAnnualImport(plan.type)) {
    return { status: 'done', value: { record }, warnings: [] }
  }
  const catchUp = { year: plan.year, timing: ANNUAL_TIMINGS[plan.type] }
  const checkpoint = await settle(() =>
    createCheckpoint(db, plan.gameId, {
      origin: 'auto',
      timing: progress?.timing,
      ...(plan.mode === 'catch-up' ? { catchUp } : {}),
      now,
    }),
  )
  const backup = await settle(() => saveBackup(db, plan.gameId, target, now))
  return { status: 'done', value: { record, checkpoint, backup }, warnings: [] }
}

/**
 * 套用的交易：更新時間不等於計畫的 expectedUpdatedAt 時回傳 undefined，什麼都不寫；
 * 否則推進年份、寫入匯入紀錄，回傳匯入紀錄與套用後的目前進度。計畫的項目從 4-3 起在這裡逐項套用
 */
async function commitImport(
  db: WPStudBookDatabase,
  plan: ImportPlan,
  now: Date,
): Promise<{ record: ImportRecord; progress: GamePoint | undefined } | undefined> {
  const id = crypto.randomUUID()
  const source: EventSource = { kind: 'import', importType: plan.type, importId: id }
  const write: WriteOptions = {
    now,
    source,
    ...(plan.timing === undefined ? {} : { timing: plan.timing }),
  }
  return db.transaction('rw', gameTables(db), async () => {
    const game = await loadGame(db, plan.gameId)
    if (game.updatedAt !== plan.expectedUpdatedAt) return undefined
    if (plan.advanceYear !== undefined) {
      const advanced = await setCurrentYear(db, plan.gameId, plan.advanceYear, write)
      if (advanced.status !== 'done') throw new Error(`推進年份失敗：${plan.advanceYear} 年`)
    }
    const record: ImportRecord = {
      id,
      gameId: plan.gameId,
      type: plan.type,
      year: plan.year,
      ...(plan.timing === undefined ? {} : { timing: plan.timing }),
      fileName: plan.fileName,
      sha256: plan.sha256,
      appliedAt: now.toISOString(),
      mode: plan.mode,
      ...(plan.corrects === undefined ? {} : { corrects: plan.corrects }),
      summary: plan.summary,
      ...(plan.confirmedWarnings === undefined
        ? {}
        : { confirmedWarnings: plan.confirmedWarnings }),
    }
    await runWrite(db, plan.gameId, [db.imports], write, async (context) => {
      await db.imports.add(record)
      return context.done(record)
    })
    const records = await db.imports.where('gameId').equals(plan.gameId).toArray()
    return { record, progress: importProgress(records) }
  })
}

/** 交易提交後的一步：丟出例外時記下錯誤訊息，不撤銷匯入 */
async function settle<T>(step: () => Promise<T>): Promise<AfterImport<T>> {
  try {
    return { status: 'done', value: await step() }
  } catch (error) {
    return { status: 'failed', error: String(error) }
  }
}
