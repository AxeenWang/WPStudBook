import {
  buildImportPlan,
  hashImportFile,
  judgeImport,
  type ImportChoice,
  type ImportContent,
  type ImportFile,
  type ImportJudgment,
  type ReadyImport,
} from '../../src/ce-import/flow'
import { januaryContent, previewJanuary, type JanuaryPreview } from '../../src/ce-import/january'
import { parseImportFile, readImportFile } from '../../src/ce-import/parse'
import { splitHorseName } from '../../src/core/identity'
import type { ImportMode, ImportType } from '../../src/core/imports'
import type { WPStudBookDatabase } from '../../src/storage/database'
import { applyImport, loadImportSnapshot, type AppliedImport } from '../../src/storage/imports'
import type { GameRow, HorseRow } from '../../src/storage/records'
import { cp932 } from './ce-bytes'
import { SAMPLES, exportText, type ExportValues } from './ce-files'
import { addTestGame, testDatabase } from './database'
import { GAME, horseRow } from './rows'

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
  return judgeImport(file, await loadImportSnapshot(db, GAME, file))
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

/** 一月二歲馬總表一列要換掉的值；基本馬名省略時取完整馬名去掉前綴 */
export interface JanuaryRowValues {
  fullName: string
  baseName?: string
  sire: string
  dam: string
  abilityNumber: string
  horseNumber: string
}

/** 一月二歲馬總表的一列：照 SAMPLES 的虛構值（2 歲），換掉第 1、51、52、74、75、77 欄（附錄 A.1） */
export function januaryRow(values: JanuaryRowValues): ExportValues {
  return {
    ...SAMPLES['two-year-old'],
    1: values.fullName,
    51: values.sire,
    52: values.dam,
    74: values.abilityNumber,
    75: values.horseNumber,
    77: values.baseName ?? splitHorseName(values.fullName)?.baseName ?? '',
  }
}

/**
 * 一月的測試局：目前遊戲年預設 1990，種牡馬チチ（S1）與母馬ハハ（M1）的馬名都經匯入確認，
 * 再加上 foals；遊戲局的欄位依需要覆寫
 */
export async function januaryGame(
  foals: readonly HorseRow[],
  fields: Partial<GameRow> = {},
): Promise<WPStudBookDatabase> {
  const db = testDatabase()
  await addTestGame(db, fields)
  await db.horses.bulkAdd([
    horseRow('S1', { fullName: 'チチ', baseName: 'チチ', nameSource: 'import', sex: 'male' }),
    horseRow('M1', { fullName: 'ハハ', baseName: 'ハハ', nameSource: 'import', sex: 'female' }),
    ...foals,
  ])
  return db
}

/** 1988 年生的自家產駒，父母連到チチ（S1）與ハハ（M1）、處置為保留；其他欄位依需要覆寫 */
export function ownFoal(id: string, fields: Partial<HorseRow> = {}): HorseRow {
  return horseRow(id, {
    birthYear: 1988,
    sex: 'male',
    sireId: 'S1',
    damId: 'M1',
    birth: {},
    disposition: 'keep',
    ...fields,
  })
}

/**
 * 一月的預覽選項：年份預設 1990；mode 省略時取判斷提供的第一個不是回溯的做法；picks 是使用者指定的列
 */
export interface JanuaryOptions {
  year?: number
  mode?: ImportMode
  picks?: ReadonlyMap<string, number>
}

/** 一月的預覽：判斷結果、選的套用方式與預覽 */
export interface JanuaryFlow {
  judgment: ReadyImport
  mode: ImportMode
  preview: JanuaryPreview
}

/**
 * 照畫面的串接預覽一月二歲馬總表（技術設計 4.4「流程」「一月」）：組出 CP932 的檔案、讀檔、解析、算雜湊、
 * 組快照、判斷，再以 previewJanuary 預覽。讀不出來、解析失敗或判斷是重複時讓測試失敗
 */
export async function previewJanuaryFile(
  db: WPStudBookDatabase,
  rows: readonly ExportValues[],
  options: JanuaryOptions = {},
): Promise<JanuaryFlow> {
  const year = options.year ?? 1990
  const fileName = `${year}年 1月1週._二歲新馬.txt`
  const bytes = cp932(exportText('two-year-old', rows))
  const read = readImportFile(bytes, fileName)
  if (read.status !== 'ok') throw new Error(read.reason)
  const parsed = parseImportFile(read.text, 'january-two-year-olds', year)
  if (parsed.status !== 'ok' || parsed.format !== 'two-year-old') throw new Error('解析失敗')
  const file: ImportFile = {
    fileName,
    sha256: await hashImportFile(bytes),
    type: 'january-two-year-olds',
    year,
    fileTiming: { month: 1, week: 1 },
  }
  const snapshot = await loadImportSnapshot(db, GAME, file)
  const judgment = judgeImport(file, snapshot)
  if (judgment.kind !== 'ready') throw new Error(judgment.kind)
  const mode =
    options.mode ?? judgment.options.find((option): option is ImportMode => option !== 'rollback')
  if (mode === undefined) throw new Error('只能回溯')
  const preview = previewJanuary(parsed.entries, snapshot, mode, options.picks)
  return { judgment, mode, preview }
}

/** 接著產生計畫（確認推進年份）並套用；套用被阻止時讓測試失敗 */
export async function applyJanuaryFile(
  db: WPStudBookDatabase,
  rows: readonly ExportValues[],
  options: JanuaryOptions = {},
): Promise<{ preview: JanuaryPreview; applied: AppliedImport }> {
  const { judgment, mode, preview } = await previewJanuaryFile(db, rows, options)
  const plan = buildImportPlan(judgment, { mode, advanceConfirmed: true }, januaryContent(preview))
  const result = await applyImport(db, plan)
  if (result.status !== 'done') throw new Error(JSON.stringify(result))
  return { preview, applied: result.value }
}
