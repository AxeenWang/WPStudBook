import type { Conception } from '../core/horse'
import { duplicateAbilityNumbers } from '../core/identity'
import type { ImportType } from '../core/imports'
import { headerCells, rowCells, type ImportProblem } from './cells'
import { parseImportFileName, type ImportFileName } from './file-name'
import {
  FIELD_COUNTS,
  FORMAT_OF,
  readBroodmare,
  readFoal,
  readStallion,
  readTwoYearOld,
  type BroodmareEntry,
  type EntryReader,
  type ExportEntry,
  type FoalEntry,
  type ImportFormat,
  type StallionEntry,
  type TwoYearOldEntry,
} from './formats'
import { decodeImportText, splitRecords } from './text'

// 呼叫端（之後的匯入流程與畫面）只引用這個檔案，問題的型別也從這裡取得
export type { ImportProblem, ImportProblemReason } from './cells'

/** 讀檔的結果：解碼後的文字與從檔名讀出的年、時點與類型；解碼失敗時拒絕 */
export type ReadImportFileResult =
  | { status: 'ok'; text: string; nameInfo: ImportFileName | null }
  | { status: 'rejected'; reason: 'decode' }

/**
 * 讀檔（技術設計 4.4「解析」第一步）：解碼，並從檔名解析年與時點、預選類型。
 * 之後由使用者確認類型與年份，再呼叫 parseImportFile
 */
export function readImportFile(
  bytes: Uint8Array<ArrayBuffer>,
  fileName: string,
): ReadImportFileResult {
  const text = decodeImportText(bytes)
  if (text === null) return { status: 'rejected', reason: 'decode' }
  return { status: 'ok', text, nameInfo: parseImportFileName(fileName) }
}

/** 各格式解析出的列 */
export type ParsedEntries =
  | { format: 'two-year-old'; entries: TwoYearOldEntry[] }
  | { format: 'foal'; entries: FoalEntry[] }
  | { format: 'broodmare'; entries: BroodmareEntry[] }
  | { format: 'stallion'; entries: StallionEntry[] }

/** 解析的結果：有任何問題時整份停止，回傳全部問題 */
export type ParseResult =
  ({ status: 'ok' } & ParsedEntries) | { status: 'rejected'; problems: ImportProblem[] }

/**
 * 解析（技術設計 4.4「解析」第二步）：依確認後的類型驗證欄數與欄名，依位置讀成該格式的列，
 * 出生年＝年份減馬齡；表頭可用時再做整份停止的檢查。格式錯誤都是阻擋錯誤（IMP-06），不略過有問題的列
 */
export function parseImportFile(text: string, type: ImportType, year: number): ParseResult {
  const problems: ImportProblem[] = []
  const parsed = readEntries(text, FORMAT_OF[type], year, problems)
  if (parsed !== null) checkFile(type, text, parsed, problems)
  return parsed === null || problems.length > 0
    ? { status: 'rejected', problems }
    : { status: 'ok', ...parsed }
}

function readEntries(
  text: string,
  format: ImportFormat,
  year: number,
  problems: ImportProblem[],
): ParsedEntries | null {
  switch (format) {
    case 'two-year-old': {
      const entries = readLines(text, format, readTwoYearOld, year, problems)
      return entries === null ? null : { format, entries }
    }
    case 'foal': {
      const entries = readLines(text, format, readFoal, year, problems)
      return entries === null ? null : { format, entries }
    }
    case 'broodmare': {
      const entries = readLines(text, format, readBroodmare, year, problems)
      return entries === null ? null : { format, entries }
    }
    case 'stallion': {
      const entries = readLines(text, format, readStallion, year, problems)
      return entries === null ? null : { format, entries }
    }
  }
}

/**
 * 讀表頭與資料列。表頭的欄數是格式的欄數（含尾端的空白欄），或少了尾端的空白欄；
 * 表頭不能用（沒有任何一行、雙引號不成對、欄數或欄名不符）時不讀資料列，回傳 null。
 * 資料列的欄數要與表頭相同，有問題的列不採用
 */
function readLines<E extends ExportEntry>(
  text: string,
  format: ImportFormat,
  read: EntryReader<E>,
  year: number,
  problems: ImportProblem[],
): E[] | null {
  const records = splitRecords(text)
  if (records.length === 0) {
    problems.push({ reason: 'empty' })
    return null
  }
  const [header, ...rows] = records
  if (header.fields === null) {
    problems.push({ reason: 'quote', line: header.line })
    return null
  }
  const count = header.fields.length
  if (count !== FIELD_COUNTS[format] && count !== FIELD_COUNTS[format] - 1) {
    problems.push({ reason: 'field-count', line: header.line, value: String(count) })
    return null
  }
  const headerProblems = problems.length
  read(headerCells(header.fields, problems), header.line, year)
  if (problems.length > headerProblems) return null
  const entries: E[] = []
  for (const { line, fields } of rows) {
    if (fields === null) {
      problems.push({ reason: 'quote', line })
    } else if (fields.length !== count) {
      problems.push({ reason: 'field-count', line, value: String(fields.length) })
    } else {
      const before = problems.length
      const entry = read(rowCells(fields, line, problems), line, year)
      if (problems.length === before) entries.push(entry)
    }
  }
  return entries
}

/** 受胎名單的 `状態`（需求規格 11.6、附錄 A.3） */
const CONCEPTIONS: readonly string[] = ['空胎', '受胎', '不受胎', '未確認'] satisfies Conception[]

/** 自家牧場的繋養牧場番号 32～35（第 3 章「據點」） */
function isOwnFarm(code: number | null): boolean {
  return code !== null && code >= 32 && code <= 35
}

/**
 * 整份停止的檢查（技術設計 4.4「解析」）：四月誕生幼駒名單的馬齡、馬主與繋牧（需求規格 11.4、APR-04），
 * 五月與七月名單的牧場（11.5、11.6、MAY-01），七月名單的 `状態`（JUL-06），目標種牡馬 TXT 的筆數
 * （11.9、STL-04），以及任何類型的檔內能力番号重複（6.2）。只檢查讀得出來的列，有問題的列已另外回報
 */
function checkFile(
  type: ImportType,
  text: string,
  parsed: ParsedEntries,
  problems: ImportProblem[],
): void {
  if (parsed.format === 'foal') {
    for (const { line, age, owner, stable } of parsed.entries) {
      if (age !== 0) problems.push({ reason: 'value', line, header: '年', value: String(age) })
      if (owner !== 46 && owner !== 47) {
        problems.push({ reason: 'scope', line, header: '馬主', value: String(owner ?? '') })
      }
      if (!isOwnFarm(stable)) {
        problems.push({ reason: 'scope', line, header: '繋牧', value: String(stable ?? '') })
      }
    }
  }
  if (parsed.format === 'broodmare' && (type === 'may-herd' || type === 'july-conception')) {
    for (const { line, farm, status } of parsed.entries) {
      if (!isOwnFarm(farm)) {
        problems.push({ reason: 'scope', line, header: '牧場', value: String(farm ?? '') })
      }
      if (type === 'july-conception' && !CONCEPTIONS.includes(status)) {
        problems.push({ reason: 'value', line, header: '状態', value: status })
      }
    }
  }
  if (type === 'target-stallion') {
    const rows = splitRecords(text).length - 1
    if (rows !== 1) problems.push({ reason: 'row-count', value: String(rows) })
  }
  const entries: readonly ExportEntry[] = parsed.entries
  const duplicates = duplicateAbilityNumbers(entries.map((entry) => entry.abilityNumber))
  for (const { line, abilityNumber } of entries) {
    if (duplicates.includes(abilityNumber)) {
      problems.push({ reason: 'duplicate', line, header: '能力番号', value: abilityNumber })
    }
  }
}
