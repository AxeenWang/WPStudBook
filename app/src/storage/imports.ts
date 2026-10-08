import {
  ANNUAL_TIMINGS,
  importProgress,
  isAnnualImport,
  type GamePoint,
  type ImportFoal,
  type ImportParentNames,
  type ImportPlan,
  type ImportPlanItem,
  type ImportRecord,
  type ImportSnapshot,
  type ImportType,
  type JanuarySnapshot,
} from '../core/imports'
import { prepareBackupTarget } from './backup-folder'
import { createCheckpoint, type CreatedCheckpoint } from './checkpoints'
import type { WPStudBookDatabase } from './database'
import { importFoalName, type FoalImportBlock } from './foal-writes'
import { gameTables } from './game-data'
import { loadGame, setCurrentYear } from './games'
import type { EventSource, HorseRow } from './records'
import { saveBackup, type SavedBackup } from './save-backup'
import { runWrite, type WriteOptions, type WriteResult } from './writes'

// CE 匯入的快照與套用（技術設計 4.4「資料流」「流程」）

/** 快照的範圍：使用者確認的類型與年份（技術設計 4.4「流程」）；ce-import 的 ImportFile 也符合這個形狀 */
export interface ImportScope {
  type: ImportType
  year: number
}

/**
 * 讀出匯入比對快照（技術設計 4.4「資料流」第 4 步）：在一個唯讀交易內讀遊戲局、這一局的匯入紀錄與檢查點的摘要；
 * 一月二歲馬總表另讀出生年為年份減 2 的自家產駒（4.4「一月」）。
 * 遊戲局不存在，或產駒連結的父母不在 horses 中時丟出錯誤
 */
export async function loadImportSnapshot(
  db: WPStudBookDatabase,
  gameId: string,
  scope: ImportScope,
): Promise<ImportSnapshot> {
  const tables = [db.games, db.imports, db.checkpoints, db.horses, db.horseNumbers]
  return db.transaction('r', tables, async () => {
    const game = await loadGame(db, gameId)
    const imports = await db.imports.where('gameId').equals(gameId).toArray()
    const checkpoints = await db.checkpoints.where('gameId').equals(gameId).toArray()
    const january =
      scope.type === 'january-two-year-olds'
        ? await loadJanuary(db, gameId, scope.year - 2)
        : undefined
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
      ...(january === undefined ? {} : { january }),
    }
  })
}

/**
 * 一月的快照（技術設計 4.4「一月」）：出生年為 birthYear 的自家產駒（有出生紀錄），帶父母名的兩種值與
 * 已記的競走馬馬番号。在 loadImportSnapshot 的交易內呼叫
 */
async function loadJanuary(
  db: WPStudBookDatabase,
  gameId: string,
  birthYear: number,
): Promise<JanuarySnapshot> {
  const rows = await db.horses
    .where('[gameId+birthYear]')
    .equals([gameId, birthYear])
    .filter((horse) => horse.birth !== undefined)
    .toArray()
  const parentIds = new Set<string>()
  for (const horse of rows) {
    if (horse.sireId !== undefined) parentIds.add(horse.sireId)
    if (horse.damId !== undefined) parentIds.add(horse.damId)
  }
  const parents = new Map<string, HorseRow>()
  for (const parent of await db.horses.bulkGet([...parentIds])) {
    if (parent) parents.set(parent.id, parent)
  }
  const numbers = await db.horseNumbers
    .where('[gameId+horseId]')
    .anyOf(rows.map((horse) => [gameId, horse.id]))
    .filter((row) => row.stage === 'racehorse')
    .toArray()
  const foals = rows.map((horse): ImportFoal => {
    const manual = horse.pedigreeSource === 'manual'
    return {
      id: horse.id,
      birthYear,
      ...(horse.abilityNumber === undefined ? {} : { abilityNumber: horse.abilityNumber }),
      ...(horse.fullName === undefined ? {} : { fullName: horse.fullName }),
      ...(horse.baseName === undefined ? {} : { baseName: horse.baseName }),
      ...(horse.nameSource === undefined ? {} : { nameSource: horse.nameSource }),
      sire: parentNames(parents, horse.sireName, horse.sireId, manual),
      dam: parentNames(parents, horse.damName, horse.damId, manual),
      racehorseNumbers: numbers.filter((row) => row.horseId === horse.id).map((row) => row.number),
    }
  })
  return { birthYear, foals }
}

/**
 * 父馬或母馬的兩種名稱（技術設計 4.4「一月」）：經匯入確認的名稱同 4.3 的既有馬匹（buildKnownHorses），
 * 保存的名稱是手動輸入時不算；任何已知的名稱是保存的名稱，沒有時用連結馬匹的基本馬名。
 * 連結的馬匹不在 parents 中時丟出錯誤
 */
function parentNames(
  parents: ReadonlyMap<string, HorseRow>,
  name: string | undefined,
  id: string | undefined,
  manual: boolean,
): ImportParentNames {
  const parent = id === undefined ? undefined : parents.get(id)
  if (id !== undefined && parent === undefined) throw new Error(`找不到馬匹：${id}`)
  const linked = parent?.nameSource === 'import' ? parent.baseName : undefined
  const confirmed = manual || name === undefined ? linked : name
  const known = name ?? parent?.baseName
  return {
    ...(confirmed === undefined ? {} : { confirmed }),
    ...(known === undefined ? {} : { known }),
  }
}

/** 計畫的項目被寫入操作阻止的原因（技術設計 4.4「流程」）：各類型寫入操作的阻止原因 */
export type ImportItemBlock = FoalImportBlock

/**
 * 套用的阻止原因（技術設計 4.4「資料流」第 7 步、「流程」），什麼都不寫：
 * - changed-since-preview：預覽之後遊戲局有變更，由畫面重新預覽
 * - item-blocked：計畫的第 index 項（從 0 起算）被寫入操作阻止，整筆回復；blocks 是寫入操作的阻止原因
 */
export type ImportApplyBlock =
  | { kind: 'changed-since-preview' }
  | { kind: 'item-blocked'; index: number; item: ImportPlanItem; blocks: ImportItemBlock[] }

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
 * 先推進年份；逐項套用計畫的項目，某一項被阻止時整筆回復並回傳 item-blocked；最後寫入匯入紀錄，
 * 遊戲局的更新時間跟著更新。
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
  const committed = await commitImport(db, plan, now).catch((error: unknown) => {
    if (error instanceof ItemStopped) return error.block
    throw error
  })
  if (committed.kind !== 'committed') return { status: 'blocked', blocks: [committed] }
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

/** 套用的交易已提交：匯入紀錄與套用後的目前進度 */
interface Committed {
  kind: 'committed'
  record: ImportRecord
  progress: GamePoint | undefined
}

/** 計畫的某一項被阻止：在交易內丟出，讓整筆回復；applyImport 在交易外接住 */
class ItemStopped extends Error {
  readonly block: ImportApplyBlock

  constructor(block: ImportApplyBlock) {
    super('計畫的項目被阻止')
    this.block = block
  }
}

/**
 * 套用的交易：更新時間不等於計畫的 expectedUpdatedAt 時回傳 changed-since-preview，什麼都不寫；
 * 否則推進年份、逐項套用計畫的項目、寫入匯入紀錄，回傳匯入紀錄與套用後的目前進度。
 * 某一項被阻止時丟出 ItemStopped 讓整筆回復，由 applyImport 接住；寫入操作回傳待確認時丟出錯誤
 * （一月沒有要確認的警告，項目的確認由之後的計畫加入）
 */
async function commitImport(
  db: WPStudBookDatabase,
  plan: ImportPlan,
  now: Date,
): Promise<Committed | ImportApplyBlock> {
  const id = crypto.randomUUID()
  const source: EventSource = { kind: 'import', importType: plan.type, importId: id }
  const write: WriteOptions = {
    now,
    source,
    ...(plan.timing === undefined ? {} : { timing: plan.timing }),
  }
  return db.transaction('rw', gameTables(db), async (): Promise<Committed | ImportApplyBlock> => {
    const game = await loadGame(db, plan.gameId)
    if (game.updatedAt !== plan.expectedUpdatedAt) return { kind: 'changed-since-preview' }
    if (plan.advanceYear !== undefined) {
      const advanced = await setCurrentYear(db, plan.gameId, plan.advanceYear, write)
      if (advanced.status !== 'done') throw new Error(`推進年份失敗：${plan.advanceYear} 年`)
    }
    for (const [index, item] of plan.items.entries()) {
      const result = await applyItem(db, plan, item, write)
      if (result.status === 'blocked') {
        throw new ItemStopped({ kind: 'item-blocked', index, item, blocks: result.blocks })
      }
      if (result.status === 'unconfirmed') throw new Error(`計畫的第 ${index} 項有待確認的警告`)
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
    return { kind: 'committed', record, progress: importProgress(records) }
  })
}

/** 依項目的種類呼叫對應的寫入操作（技術設計 4.4「流程」）；資料更正時讓寫入操作改經匯入確認的馬名 */
async function applyItem(
  db: WPStudBookDatabase,
  plan: ImportPlan,
  item: ImportPlanItem,
  write: WriteOptions,
): Promise<WriteResult<unknown, ImportItemBlock>> {
  switch (item.kind) {
    case 'foal-name':
      return importFoalName(db, plan.gameId, item, {
        ...write,
        correction: plan.mode === 'correction',
      })
  }
}

/** 交易提交後的一步：丟出例外時記下錯誤訊息，不撤銷匯入 */
async function settle<T>(step: () => Promise<T>): Promise<AfterImport<T>> {
  try {
    return { status: 'done', value: await step() }
  } catch (error) {
    return { status: 'failed', error: String(error) }
  }
}
