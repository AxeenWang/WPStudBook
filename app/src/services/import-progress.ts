/** 匯入預覽的處理進度：已處理與全部的列數（需求規格 12.5）。 */
export interface ImportProgress {
  readonly done: number;
  readonly total: number;
}

export type ImportProgressReporter = (progress: ImportProgress) => void;

/** 每批處理的列數。數千筆的總表分成幾批，每批之後讓畫面有機會更新進度。 */
export const PROGRESS_BATCH_SIZE = 500;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * 數千筆的總表分批處理並回報進度（需求規格 12.5「分批解析並顯示進度」）：每批之後回報已處理的
 * 列數並讓出執行緒，畫面才能更新進度而不是凍結到整份處理完。
 */
export async function mapInBatches<T, R>(
  items: readonly T[],
  map: (item: T) => R,
  report: ImportProgressReporter,
  size = PROGRESS_BATCH_SIZE,
): Promise<R[]> {
  const results: R[] = [];
  report({ done: 0, total: items.length });
  for (let start = 0; start < items.length; start += size) {
    const batch = items.slice(start, start + size);
    results.push(...batch.map(map));
    report({ done: start + batch.length, total: items.length });
    await yieldToEventLoop();
  }
  return results;
}
