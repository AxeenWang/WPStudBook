import type { PreviewOutcome } from '../../domain/import-batch.ts';

/** 預覽分類（需求規格 11.1）。 */
export const OUTCOME_LABELS: Readonly<Record<PreviewOutcome, string>> = {
  apply: '可套用',
  skip: '略過',
  review: '待核對',
  warn: '警告',
  error: '錯誤',
};

export function formatTiming(month: number, week: number): string {
  return `${String(month)} 月 ${String(week)} 週`;
}
