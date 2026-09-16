import type { ImportType } from '../../domain/import-type.ts';
import type { PreviewOutcome } from '../../domain/import-batch.ts';

export const IMPORT_TYPE_LABELS: Readonly<Record<ImportType, string>> = {
  jan2yo: '一月二歲馬總表',
  aprFoals: '四月誕生幼駒總表',
  mayMares: '五月繁殖牝馬總表',
  julMares: '七月繁殖牝馬總表',
  candidateFile: '候選 TXT',
  mayStallions: '五月種牡馬總表',
  targetStallion: '目標種牡馬 TXT',
  octWorldMares: '十月全世界繁殖牝馬總表',
};

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
