import type { RestoreProgress } from '../services/backup.ts';

type VerifyStage = Extract<RestoreProgress, { step: 'verify' }>['stage'];

const STAGE_LABELS: Readonly<Record<VerifyStage, string>> = {
  parse: '解壓縮並解析',
  envelope: '檢查格式與版本',
  counts: '核對筆數',
  hash: '核對 SHA-256',
  migration: '遷移舊版本',
  fields: '檢查欄位、識別與關聯',
  relations: '檢查識別與關聯',
};

/** 還原備份或封存檔時的進度文字（需求規格 12.2「大型檔案顯示進度」）。 */
export function restoreProgressText(progress: RestoreProgress): string {
  if (progress.step === 'verify') {
    return `驗證中：${STAGE_LABELS[progress.stage]}…`;
  }
  const done = progress.done.toLocaleString('en-US');
  const total = progress.total.toLocaleString('en-US');
  return `寫入新遊戲局：${done}／${total} 筆`;
}
