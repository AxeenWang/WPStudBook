import { decodeImportFile, type SourceEncoding } from './decode.ts';
import { IMPORT_FORMATS, findHeaderMismatches, type ImportFormatId } from './formats.ts';
import { splitTable, type Delimiter } from './rows.ts';

/** 一筆資料列；`lineNumber` 是檔案行號，表頭為第 1 行。 */
export interface SourceRow {
  readonly lineNumber: number;
  readonly cells: readonly string[];
}

export interface ParsedFile {
  readonly formatId: ImportFormatId;
  readonly encoding: SourceEncoding;
  readonly delimiter: Delimiter;
  readonly header: readonly string[];
  readonly rows: readonly SourceRow[];
}

export type ParseResult =
  | { readonly ok: true; readonly file: ParsedFile }
  | { readonly ok: false; readonly problems: readonly string[] };

/** 停止時最多列出幾項問題；其餘以一行帶過，避免整份錯誤時洗版。 */
const MAX_PROBLEMS = 10;

function limited(problems: readonly string[]): string[] {
  if (problems.length <= MAX_PROBLEMS) {
    return [...problems];
  }
  return [
    ...problems.slice(0, MAX_PROBLEMS),
    `另有 ${String(problems.length - MAX_PROBLEMS)} 項問題未列出`,
  ];
}

/** 依位置取欄位值（需求規格 11.1）：序號從 1 起算，不依欄名。 */
export function cell(row: SourceRow, position: number): string | undefined {
  return row.cells[position - 1];
}

/**
 * 解析匯入檔（需求規格 11.1）：解碼 → 分隔 → 欄數與表頭驗證。
 * 解碼、分隔、欄數或必要欄位無法辨識時整份停止，不回傳部分結果（IMP-04、IMP-06）。
 */
export function parseImportFile(bytes: Uint8Array, formatId: ImportFormatId): ParseResult {
  const decoded = decodeImportFile(bytes);
  if (!decoded.ok) {
    return { ok: false, problems: [decoded.problem] };
  }
  const split = splitTable(decoded.text);
  if (!split.ok) {
    return { ok: false, problems: [split.problem] };
  }
  const format = IMPORT_FORMATS[formatId];
  const { delimiter, header, rows } = split.table;
  const problems = findHeaderMismatches(format, header);
  if (problems.length > 0) {
    return { ok: false, problems: limited(problems) };
  }
  const rowProblems: string[] = [];
  const parsed: SourceRow[] = [];
  for (const [index, cells] of rows.entries()) {
    const lineNumber = index + 2;
    if (cells.length === format.columnCount) {
      parsed.push({ lineNumber, cells });
      continue;
    }
    rowProblems.push(
      `第 ${String(lineNumber)} 行欄數應為 ${String(format.columnCount)}，實際為 ${String(cells.length)}`,
    );
  }
  if (rowProblems.length > 0) {
    return { ok: false, problems: limited(rowProblems) };
  }
  if (parsed.length === 0) {
    return { ok: false, problems: ['檔案只有表頭，沒有資料列'] };
  }
  return {
    ok: true,
    file: { formatId, encoding: decoded.encoding, delimiter, header, rows: parsed },
  };
}
