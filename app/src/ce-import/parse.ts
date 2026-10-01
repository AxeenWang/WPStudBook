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
 * 出生年＝年份減馬齡。格式錯誤都是阻擋錯誤（IMP-06），不略過有問題的列
 */
export function parseImportFile(text: string, type: ImportType, year: number): ParseResult {
  const problems: ImportProblem[] = []
  const parsed = readEntries(text, FORMAT_OF[type], year, problems)
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
