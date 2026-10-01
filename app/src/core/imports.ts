// ce-import 與 storage 共用的匯入型別與規則（技術設計 4.2、4.4）

/** 遊戲內的時點（需求規格 4.1、11.1）：month 月 week 週，每月 4 週 */
export interface GameTiming {
  month: number
  week: number
}

/** 遊戲內的時點：1～12 月、每月 1～4 週 */
export function isGameTiming(timing: GameTiming): boolean {
  const { month, week } = timing
  const inRange = (value: number, max: number) =>
    Number.isInteger(value) && value >= 1 && value <= max
  return inRange(month, 12) && inRange(week, 4)
}

/**
 * 匯入的種類（需求規格 11.1）：一月二歲馬總表、四月誕生幼駒名單、五月繁殖圈名單、七月受胎名單、
 * 候選 TXT、目標種牡馬 TXT、十月全世界繁殖牝馬總表、種牡馬總表
 */
export type ImportType =
  | 'january-two-year-olds'
  | 'april-foals'
  | 'may-herd'
  | 'july-conception'
  | 'candidates'
  | 'target-stallion'
  | 'october-mares'
  | 'stallion-list'

/** 年度匯入（需求規格 11.1）：每年在固定時點各匯入一次，列入年度工作清單 */
export type AnnualImportType = Extract<
  ImportType,
  'january-two-year-olds' | 'april-foals' | 'may-herd' | 'july-conception'
>

/** 年度匯入的固定時點（需求規格 4.1、11.1）：檔名的時點只用來預選類型 */
export const ANNUAL_TIMINGS: Readonly<Record<AnnualImportType, GameTiming>> = {
  'january-two-year-olds': { month: 1, week: 1 },
  'april-foals': { month: 4, week: 1 },
  'may-herd': { month: 5, week: 1 },
  'july-conception': { month: 7, week: 1 },
}

/** 匯入的分類（需求規格 11.1）：年度；累加（候選 TXT、目標種牡馬 TXT）；選用（十月總表、種牡馬總表） */
export type ImportCategory = 'annual' | 'accumulative' | 'optional'

/** 是不是年度匯入 */
export function isAnnualImport(type: ImportType): type is AnnualImportType {
  return Object.hasOwn(ANNUAL_TIMINGS, type)
}

/** 匯入的分類（需求規格 11.1） */
export function importCategory(type: ImportType): ImportCategory {
  if (isAnnualImport(type)) return 'annual'
  return type === 'candidates' || type === 'target-stallion' ? 'accumulative' : 'optional'
}

/** 遊戲內的一個時間點：年與時點；目前進度、匯入檔與檢查點的先後都用它比較 */
export interface GamePoint {
  year: number
  timing: GameTiming
}

/** 時間點的先後：先比年，再比月，最後比週；a 較早時為負數，相同時為 0 */
export function compareGamePoints(a: GamePoint, b: GamePoint): number {
  return a.year - b.year || a.timing.month - b.timing.month || a.timing.week - b.timing.week
}

/** 套用方式（需求規格 11.1）：一般、資料更正、直接補匯 */
export type ImportMode = 'normal' | 'correction' | 'catch-up'

/** 結果摘要（需求規格 11.1）：檔案的筆數、套用與略過的筆數；之後各類型的計畫再加自己的欄位 */
export interface ImportSummary {
  total: number
  applied: number
  skipped: number
}

/** 匯入層級的警告：檔案年份比目前遊戲年晚兩年以上（需求規格 11.1、IMP-15）；from 是推進前的目前遊戲年 */
export type ImportWarning = { kind: 'year-far-ahead'; from: number; to: number }

/** 匯入紀錄（需求規格 11.1，技術設計 4.4「流程」）：一列是一次套用，不存原始檔 */
export interface ImportRecord {
  id: string
  gameId: string
  type: ImportType
  /** 使用者確認的年份 */
  year: number
  /** 年度匯入依類型固定（ANNUAL_TIMINGS）；累加與選用照檔名，解析不了時留空 */
  timing?: GameTiming
  fileName: string
  /** 檔案原始位元組的 SHA-256（小寫十六進位） */
  sha256: string
  /** 套用時間（ISO 8601） */
  appliedAt: string
  mode: ImportMode
  /** 資料更正時，被更正的那一筆：同類型、同年、同時點最新的一筆 */
  corrects?: string
  summary: ImportSummary
  /** 使用者確認過的匯入層級警告；沒有時留空 */
  confirmedWarnings?: ImportWarning[]
}

/**
 * 目前進度（需求規格 11.1）：年度匯入紀錄中最晚的年與時點，時點取類型固定的時點；沒有年度匯入時沒有進度。
 * 不分套用方式：補匯的那一筆一定早於進度，資料更正的那一筆不晚於進度
 */
export function importProgress(records: readonly ImportRecord[]): GamePoint | undefined {
  let progress: GamePoint | undefined
  for (const record of records) {
    if (!isAnnualImport(record.type)) continue
    const point = { year: record.year, timing: ANNUAL_TIMINGS[record.type] }
    if (progress === undefined || compareGamePoints(point, progress) > 0) progress = point
  }
  return progress
}

/** 檢查點的摘要（技術設計 4.4「流程」）：推薦回溯的檢查點用；年是建立當下的目前遊戲年，手動建立的可能沒有時點 */
export interface ImportCheckpoint {
  id: string
  year: number
  timing?: GameTiming
  /** 建立時間（ISO 8601） */
  createdAt: string
}

/**
 * 匯入比對快照（技術設計 4.4「資料流」第 4 步）的通用部分：遊戲局、這一局的匯入紀錄與檢查點的摘要。
 * 各類型比對要用的資料由之後的計畫加入
 */
export interface ImportSnapshot {
  gameId: string
  currentYear: number
  /** 遊戲局的更新時間；套用時核對，不同時回傳 changed-since-preview */
  updatedAt: string
  imports: ImportRecord[]
  checkpoints: ImportCheckpoint[]
}
