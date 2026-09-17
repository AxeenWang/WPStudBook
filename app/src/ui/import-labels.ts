import type { ImportType } from '../domain/import-type.ts';

/** 匯入類型的顯示名稱；年度工作清單（總覽）與匯入頁共用，不跨功能互相引用。 */
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
