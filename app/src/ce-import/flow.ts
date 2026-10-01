import {
  ANNUAL_TIMINGS,
  compareGamePoints,
  importCategory,
  importProgress,
  isAnnualImport,
  type GamePoint,
  type GameTiming,
  type ImportCheckpoint,
  type ImportMode,
  type ImportPlan,
  type ImportPlanItem,
  type ImportRecord,
  type ImportSnapshot,
  type ImportSummary,
  type ImportType,
  type ImportWarning,
} from '../core/imports'

// 匯入的判斷與套用計畫（需求規格 11.1，技術設計 4.4「流程」）：重複、資料更正、直接補匯、回溯與推進年份

/** 檔案原始位元組的 SHA-256（小寫十六進位）：判斷同一份檔案用（需求規格 11.1） */
export async function hashImportFile(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** 要判斷的檔案：檔名、雜湊、使用者確認的類型與年份，以及檔名解析出的時點（解析不了時留空） */
export interface ImportFile {
  fileName: string
  sha256: string
  type: ImportType
  year: number
  fileTiming?: GameTiming
}

/** 可選的做法（需求規格 11.1）：一般套用、資料更正、直接補匯，或回溯到檢查點後再套用 */
export type ImportOption = ImportMode | 'rollback'

/** 只提示的說明：年度匯入的檔名時點與類型固定的時點不同（需求規格 11.1「提示、不阻止」） */
export interface ImportHint {
  kind: 'timing-mismatch'
  fileTiming: GameTiming
  timing: GameTiming
}

/** 可以產生計畫的判斷結果 */
export interface ReadyImport {
  kind: 'ready'
  gameId: string
  /** 快照當下遊戲局的更新時間 */
  expectedUpdatedAt: string
  file: ImportFile
  /** 記在匯入紀錄的時點：年度匯入依類型固定，其他照檔名 */
  timing?: GameTiming
  options: ImportOption[]
  /** 可選資料更正時，被更正的那一筆 */
  corrects?: string
  /** 可選回溯時推薦的檢查點；找不到時留空，由使用者從清單選 */
  recommendedCheckpoint?: string
  /** 檔案年份晚於目前遊戲年時要推進到的年份；使用者確認才能產生計畫 */
  advanceYear?: number
  /** 確認推進時一併確認的警告 */
  warnings: ImportWarning[]
  hints: ImportHint[]
}

/**
 * 判斷的結果：
 * - duplicate：重複，不產生計畫；record 是重複的那一筆
 * - ready：可以產生計畫，列出可選的做法
 */
export type ImportJudgment = { kind: 'duplicate'; record: ImportRecord } | ReadyImport

/**
 * 判斷重複、資料更正、直接補匯、回溯與推進年份（需求規格 11.1，技術設計 4.4「流程」）。
 * 「同一組」是同類型、同年、同時點中套用時間最新的一筆，年度與選用匯入的重複只和它比；
 * 累加匯入和這一局同類型的每一筆比雜湊。只有年度匯入看目前進度。年份不是整數時丟出 RangeError
 */
export function judgeImport(file: ImportFile, snapshot: ImportSnapshot): ImportJudgment {
  const { type, year } = file
  if (!Number.isInteger(year)) throw new RangeError(`年份不是整數：${year}`)
  const timing = isAnnualImport(type) ? ANNUAL_TIMINGS[type] : file.fileTiming
  const sameType = snapshot.imports.filter((record) => record.type === type)
  let options: ImportOption[] = []
  let corrects: string | undefined
  let recommended: string | undefined
  if (importCategory(type) === 'accumulative') {
    const duplicate = latest(sameType.filter((record) => record.sha256 === file.sha256))
    if (duplicate) return { kind: 'duplicate', record: duplicate }
    options = ['normal']
  } else {
    const group = latest(
      sameType.filter((record) => record.year === year && sameTiming(record.timing, timing)),
    )
    if (group?.sha256 === file.sha256) return { kind: 'duplicate', record: group }
    const point = isAnnualImport(type) ? { year, timing: ANNUAL_TIMINGS[type] } : undefined
    const progress = importProgress(snapshot.imports)
    const earlier =
      point !== undefined && progress !== undefined && compareGamePoints(point, progress) < 0
    if (group) {
      corrects = group.id
      options = earlier ? ['rollback', 'correction'] : ['correction']
    } else {
      options = earlier ? ['rollback', 'catch-up'] : ['normal']
    }
    if (point !== undefined && earlier)
      recommended = recommendCheckpoint(snapshot.checkpoints, point)
  }
  const ahead = year - snapshot.currentYear
  // 累加與選用匯入的時點就是檔名的時點，只有年度匯入會不同
  const hints: ImportHint[] =
    file.fileTiming !== undefined && timing !== undefined && !sameTiming(file.fileTiming, timing)
      ? [{ kind: 'timing-mismatch', fileTiming: file.fileTiming, timing }]
      : []
  return {
    kind: 'ready',
    gameId: snapshot.gameId,
    expectedUpdatedAt: snapshot.updatedAt,
    file,
    ...(timing === undefined ? {} : { timing }),
    options,
    ...(corrects === undefined ? {} : { corrects }),
    ...(recommended === undefined ? {} : { recommendedCheckpoint: recommended }),
    ...(ahead > 0 ? { advanceYear: year } : {}),
    warnings: ahead >= 2 ? [{ kind: 'year-far-ahead', from: snapshot.currentYear, to: year }] : [],
    hints,
  }
}

/** 使用者的選擇：套用方式，以及是否確認推進年份（連同晚兩年以上的警告） */
export interface ImportChoice {
  mode: ImportMode
  advanceConfirmed?: boolean
}

/** 各類型的預覽產生的內容：結果摘要與套用的項目 */
export interface ImportContent {
  summary: ImportSummary
  items: ImportPlanItem[]
}

/**
 * 產生套用計畫（技術設計 4.4「流程」）。選了判斷沒有提供的做法，或需要推進年份而沒有確認時丟出 RangeError：
 * 畫面不會送出這兩種情況。回溯不是計畫的一種：回溯後重新組快照、重新判斷
 */
export function buildImportPlan(
  judgment: ReadyImport,
  choice: ImportChoice,
  content: ImportContent,
): ImportPlan {
  const { file, timing, corrects, advanceYear, warnings } = judgment
  if (!judgment.options.includes(choice.mode)) {
    throw new RangeError(`這份檔案不能選這種套用方式：${choice.mode}`)
  }
  if (advanceYear !== undefined && choice.advanceConfirmed !== true) {
    throw new RangeError(`要先確認推進到 ${advanceYear} 年`)
  }
  return {
    gameId: judgment.gameId,
    expectedUpdatedAt: judgment.expectedUpdatedAt,
    type: file.type,
    year: file.year,
    ...(timing === undefined ? {} : { timing }),
    fileName: file.fileName,
    sha256: file.sha256,
    mode: choice.mode,
    ...(corrects === undefined ? {} : { corrects }),
    ...(advanceYear === undefined ? {} : { advanceYear }),
    ...(warnings.length > 0 ? { confirmedWarnings: [...warnings] } : {}),
    summary: content.summary,
    items: content.items,
  }
}

/** 套用時間最新的一筆 */
function latest(records: readonly ImportRecord[]): ImportRecord | undefined {
  let result: ImportRecord | undefined
  for (const record of records) {
    if (result === undefined || record.appliedAt >= result.appliedAt) result = record
  }
  return result
}

/** 兩個時點相同；都沒有時點也算相同 */
function sameTiming(a: GameTiming | undefined, b: GameTiming | undefined): boolean {
  return a === undefined || b === undefined ? a === b : a.month === b.month && a.week === b.week
}

/**
 * 回溯的推薦（技術設計 4.4「流程」）：有時點、而且年與時點早於這份檔案的檢查點中，
 * 年與時點最晚的一個，一樣時取建立時間最新的；沒有時回傳 undefined
 */
function recommendCheckpoint(
  checkpoints: readonly ImportCheckpoint[],
  point: GamePoint,
): string | undefined {
  const candidates: { id: string; at: GamePoint; createdAt: string }[] = []
  for (const { id, year, timing, createdAt } of checkpoints) {
    if (timing === undefined) continue
    const at = { year, timing }
    if (compareGamePoints(at, point) < 0) candidates.push({ id, at, createdAt })
  }
  candidates.sort((a, b) => compareGamePoints(b.at, a.at) || b.createdAt.localeCompare(a.createdAt))
  return candidates[0]?.id
}
