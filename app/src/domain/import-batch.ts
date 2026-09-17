import type { ImportType } from './import-type.ts';
import type { Timing } from './timing.ts';

/** 預覽分類（需求規格 11.1、設計決策 6.3）。 */
export const PREVIEW_OUTCOMES = ['apply', 'skip', 'review', 'warn', 'error'] as const;

export type PreviewOutcome = (typeof PREVIEW_OUTCOMES)[number];

/** 需求規格 5.2 的三種處理：阻止、警告並確認、停止套用。 */
export type ProblemHandling = 'block' | 'confirm' | 'halt';

export interface PreviewIssue {
  /** 穩定的代號，供確認紀錄與測試比對；訊息文字可以改。 */
  readonly code: string;
  readonly message: string;
  readonly handling: ProblemHandling;
}

/**
 * 預覽的一列；各匯入類型再加上自己的欄位。
 *
 * 不是每一列都來自檔案：五月繁殖牝馬總表要把「上年在圈、今年缺席」的母馬也列進預覽並計入
 * 摘要（需求規格 11.5、MAY-02），那些列沒有行號。所以識別用 `key`，行號只是顯示資訊。
 */
export interface PreviewRow {
  /** 這次預覽內唯一；檔案列用行號，其他列用自己的識別（例如母馬的內部 id）。 */
  readonly key: string;
  /** 檔案行號；不是來自檔案的列沒有行號。 */
  readonly lineNumber?: number;
  /** 顯示用的標題，通常是馬名。 */
  readonly label: string;
  readonly outcome: PreviewOutcome;
  readonly issues: readonly PreviewIssue[];
}

export type ImportSummary = Readonly<Record<PreviewOutcome, number>>;

export function summarise(rows: readonly PreviewRow[]): ImportSummary {
  const summary: Record<PreviewOutcome, number> = {
    apply: 0,
    skip: 0,
    review: 0,
    warn: 0,
    error: 0,
  };
  for (const row of rows) {
    summary[row.outcome] += 1;
  }
  return summary;
}

/** 有阻擋錯誤時資料不變（需求規格 11.1、IMP-06）。 */
export function hasBlockingError(rows: readonly PreviewRow[]): boolean {
  return rows.some((row) => row.outcome === 'error');
}

/**
 * 設計決策 5.2 節 `imports`：只存檔名、雜湊、遊戲局、年、時點、類型與結果摘要，
 * 不存原始檔（需求規格 11.1、IMP-11）。
 */
export interface ImportBatch {
  readonly id: string;
  readonly type: ImportType;
  readonly gameYear: number;
  readonly timing: Timing;
  readonly fileName: string;
  readonly sha256: string;
  readonly summary: ImportSummary;
  readonly appliedAt: string;
  /** 資料更正時指回被取代的那次匯入，兩份來源檔因此都留著（需求規格 11.1、IMP-08）。 */
  readonly correctionOf?: string;
}

/**
 * 年度總表（需求規格 11.1）：套用後自動建立檢查點並標記年度工作。
 * 候選 TXT、目標種牡馬 TXT 與十月全世界繁殖牝馬總表不算。
 */
const YEARLY_TOTAL_TYPES: Readonly<Record<ImportType, boolean>> = {
  jan2yo: true,
  aprFoals: true,
  mayMares: true,
  julMares: true,
  mayStallions: true,
  candidateFile: false,
  targetStallion: false,
  octWorldMares: false,
};

export function isYearlyTotal(type: ImportType): boolean {
  return YEARLY_TOTAL_TYPES[type];
}

export function compareTiming(a: Timing, b: Timing): number {
  return a.month === b.month ? a.week - b.week : a.month - b.month;
}

export interface Progress {
  readonly gameYear: number;
  readonly timing: Timing;
}

export function compareProgress(a: Progress, b: Progress): number {
  return a.gameYear === b.gameYear ? compareTiming(a.timing, b.timing) : a.gameYear - b.gameYear;
}

export type RepeatCheck =
  | { readonly kind: 'new' }
  | { readonly kind: 'duplicate'; readonly previous: ImportBatch }
  | { readonly kind: 'correction'; readonly previous: ImportBatch };

/**
 * 重複與更正（需求規格 11.1、IMP-07、IMP-08）：同局、同年、同時點、同類型的既有匯入中，
 * 內容雜湊相同為重複，不同為資料更正。不同類型即使同一個時點也互不相干（IMP-16）。
 *
 * `manyPerSlot` 給同一個年與時點本來就會有多份不同檔案的類型（目標種牡馬 TXT：同一層的
 * 每一條建立新系分支各自匯入自己的檔案，STL-05）。那時候「內容不同」不代表資料更正，
 * 只有同雜湊的重複仍然要擋。
 */
export function checkRepeat(
  sameSlot: readonly ImportBatch[],
  sha256: string,
  manyPerSlot = false,
): RepeatCheck {
  const duplicate = sameSlot.find((batch) => batch.sha256 === sha256);
  if (duplicate !== undefined) {
    return { kind: 'duplicate', previous: duplicate };
  }
  if (manyPerSlot) {
    return { kind: 'new' };
  }
  const latest = [...sameSlot].sort((a, b) => a.appliedAt.localeCompare(b.appliedAt)).at(-1);
  return latest === undefined ? { kind: 'new' } : { kind: 'correction', previous: latest };
}

/** 檔案年份比目前晚幾年就另外警告（需求規格 11.1、IMP-15）。 */
export const FAR_FUTURE_YEARS = 2;

export type YearDecision =
  | { readonly kind: 'current' }
  | { readonly kind: 'advance'; readonly to: number; readonly farFuture: boolean }
  | { readonly kind: 'behind'; readonly progress: Progress };

/**
 * 年份與進度（需求規格 11.1、IMP-09、IMP-14、IMP-15）。
 *
 * 遊戲局只保存目前遊戲年，沒有目前時點，所以「早於目前進度」由已套用的年度總表推導：
 * 取已套用年度總表中最晚的年與時點當作進度，檔案早於它就提示回溯到對應檢查點。
 */
export function decideYear(
  fileYear: number,
  fileTiming: Timing,
  currentYear: number,
  appliedYearlyTotals: readonly ImportBatch[],
): YearDecision {
  if (fileYear > currentYear) {
    return { kind: 'advance', to: fileYear, farFuture: fileYear - currentYear >= FAR_FUTURE_YEARS };
  }
  const latest = appliedYearlyTotals
    .map((batch): Progress => ({ gameYear: batch.gameYear, timing: batch.timing }))
    .sort(compareProgress)
    .at(-1);
  // 還沒有任何年度總表時，進度就是目前遊戲年的年初。
  const progress = latest ?? { gameYear: currentYear, timing: { month: 1, week: 1 } };
  const file: Progress = { gameYear: fileYear, timing: fileTiming };
  return compareProgress(file, progress) < 0 ? { kind: 'behind', progress } : { kind: 'current' };
}
