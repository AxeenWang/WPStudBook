import {
  buildImportPlan,
  judgeImport,
  type ImportChoice,
  type ImportContent,
  type ImportFile,
  type ImportJudgment,
} from '../../src/ce-import/flow'
import type { ImportType } from '../../src/core/imports'
import type { WPStudBookDatabase } from '../../src/storage/database'
import { applyImport, loadImportSnapshot, type AppliedImport } from '../../src/storage/imports'
import { GAME } from './rows'

/** 計畫的內容：摘要都是 0，沒有項目（CE 匯入子計畫 4-2 還沒有項目） */
export const EMPTY_CONTENT: ImportContent = {
  summary: { total: 0, applied: 0, skipped: 0 },
  items: [],
}

/** 要匯入的檔案：檔名依年份與類型，雜湊預設是 `類型-年份`；其他欄位依需要覆寫 */
export function importFile(
  type: ImportType,
  year: number,
  fields: Partial<ImportFile> = {},
): ImportFile {
  return { fileName: `${year}_${type}.txt`, sha256: `${type}-${year}`, type, year, ...fields }
}

/** 畫面串接的前半（技術設計 4.4「流程」）：組出這一局的快照再判斷 */
export async function judgeFile(db: WPStudBookDatabase, file: ImportFile): Promise<ImportJudgment> {
  return judgeImport(file, await loadImportSnapshot(db, GAME))
}

/**
 * 照畫面的串接匯入一份檔案：組快照、判斷、以 EMPTY_CONTENT 產生計畫、套用。
 * 判斷是重複或套用被阻止時讓測試失敗
 */
export async function applyFile(
  db: WPStudBookDatabase,
  file: ImportFile,
  choice: ImportChoice = { mode: 'normal' },
  now?: Date,
): Promise<AppliedImport> {
  const judgment = await judgeFile(db, file)
  if (judgment.kind !== 'ready') throw new Error(judgment.kind)
  const plan = buildImportPlan(judgment, choice, EMPTY_CONTENT)
  const result = await applyImport(db, plan, now === undefined ? {} : { now })
  if (result.status !== 'done') throw new Error(result.status)
  return result.value
}
