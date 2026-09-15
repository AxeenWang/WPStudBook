import type { Timing } from './timing.ts';

export interface Checkpoint {
  readonly id: string;
  readonly gameYear: number;
  /** 年度總表自動建立時才有（階段 4）；手動建立不記錄時點。 */
  readonly timing?: Timing;
  readonly createdAt: string;
  readonly note?: string;
  readonly pinned: boolean;
  /** 檢查點內容（備份文件）的 SHA-256。 */
  readonly sha256: string;
  readonly sizeBytes: number;
  /** 各資料表筆數，鍵為備份 collections 的資料表名稱。 */
  readonly counts: Readonly<Record<string, number>>;
}

// 與 storage/backup/canonical-json.ts 的 compareCodeUnits 刻意重複：domain 不能引用 storage
// （設計決策第 4 節），兩處各自維護同一條字典序比較規則。
function compareText(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

function compareCreation(a: Checkpoint, b: Checkpoint): number {
  return compareText(a.createdAt, b.createdAt) || compareText(a.id, b.id);
}

export function sortCheckpointsByCreation(checkpoints: readonly Checkpoint[]): Checkpoint[] {
  return [...checkpoints].sort(compareCreation);
}

/**
 * 需求規格 12.4：總數超過保留數時，由舊到新刪除未釘選者，直到不超過保留數或沒有候選為止。
 * 剛建立的檢查點（keepId）不清除；其餘都已釘選時總數可以超過保留數。
 */
export function selectCheckpointsToPrune(
  checkpoints: readonly Checkpoint[],
  retention: number,
  keepId?: string,
): string[] {
  let excess = checkpoints.length - retention;
  const pruned: string[] = [];
  for (const item of sortCheckpointsByCreation(checkpoints)) {
    if (excess <= 0) {
      break;
    }
    if (!item.pinned && item.id !== keepId) {
      pruned.push(item.id);
      excess -= 1;
    }
  }
  return pruned;
}

/** 建立時間晚於回溯目標的檢查點，回溯後移除（CKPT-06）。 */
export function selectLaterCheckpoints(
  checkpoints: readonly Checkpoint[],
  target: Checkpoint,
): Checkpoint[] {
  return sortCheckpointsByCreation(checkpoints).filter((item) => compareCreation(item, target) > 0);
}
