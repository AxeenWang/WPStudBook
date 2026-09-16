import { describe, expect, it } from 'vitest';
import {
  IMPORT_FORMATS,
  type ImportFormat,
  type ImportFormatId,
} from '../../src/import/formats.ts';
import {
  cell,
  parseImportFile,
  type ParsedFile,
  type ParseResult,
  type SourceRow,
} from '../../src/import/parse.ts';

function headerCells(format: ImportFormat): string[] {
  const row = Array.from({ length: format.columnCount }, (_, index) => `欄${String(index + 1)}`);
  for (const { position, name } of format.headers) {
    row[position - 1] = name;
  }
  return row;
}

function dataCells(format: ImportFormat, values: Readonly<Record<number, string>>): string[] {
  const row = Array.from({ length: format.columnCount }, () => '');
  for (const [position, value] of Object.entries(values)) {
    row[Number(position) - 1] = value;
  }
  return row;
}

/** 組出一份 UTF-8 的匯入檔位元組；CP932 樣本由 tests/unit/import-decode.test.ts 覆蓋。 */
function fileBytes(rows: readonly (readonly string[])[], delimiter: string): Uint8Array {
  return new TextEncoder().encode(rows.map((row) => row.join(delimiter)).join('\r\n') + '\r\n');
}

function problemsOf(result: ParseResult): readonly string[] {
  if (result.ok) {
    throw new Error('預期解析失敗，實際成功');
  }
  return result.problems;
}

function parseOf(result: ParseResult): ParsedFile {
  if (!result.ok) {
    throw new Error(`預期解析成功，實際失敗：${result.problems.join('；')}`);
  }
  return result.file;
}

function firstRow(file: ParsedFile): SourceRow {
  const [row] = file.rows;
  if (row === undefined) {
    throw new Error('預期至少有一筆資料列');
  }
  return row;
}

function sampleFile(
  formatId: ImportFormatId,
  values: Readonly<Record<number, string>>,
): Uint8Array {
  const format = IMPORT_FORMATS[formatId];
  return fileBytes([headerCells(format), dataCells(format, values)], '\t');
}

describe('匯入檔解析（需求規格 11.1、IMP-04、IMP-06）', () => {
  it('Tab 分隔檔依位置取值，欄位內的逗號不影響分隔', () => {
    const bytes = sampleFile('stallion', { 1: 'テストウマ001', 37: '2,450', 59: '0x0000' });
    const file = parseOf(parseImportFile(bytes, 'stallion'));
    expect(file.delimiter).toBe('\t');
    expect(file.rows).toHaveLength(1);
    const row = firstRow(file);
    expect(cell(row, 1)).toBe('テストウマ001');
    expect(cell(row, 37)).toBe('2,450');
    expect(cell(row, 59)).toBe('0x0000');
  });

  it('表頭沒有 Tab 時以逗號分隔', () => {
    const format = IMPORT_FORMATS.broodmare;
    const bytes = fileBytes([headerCells(format), dataCells(format, { 1: 'テストウマ002' })], ',');
    const file = parseOf(parseImportFile(bytes, 'broodmare'));
    expect(file.delimiter).toBe(',');
    expect(file.rows).toHaveLength(1);
  });

  it('選錯類型時依欄數與必要欄位停止（IMP-04）', () => {
    const bytes = sampleFile('broodmare', { 1: 'テストウマ003' });
    const problems = problemsOf(parseImportFile(bytes, 'jan2yo'));
    expect(problems[0]).toContain('欄數應為 78');
  });

  it('資料列欄數不符時整份停止，指出行號', () => {
    const format = IMPORT_FORMATS.broodmare;
    const short = dataCells(format, { 1: 'テストウマ004' }).slice(0, -1);
    const bytes = fileBytes([headerCells(format), short], '\t');
    expect(problemsOf(parseImportFile(bytes, 'broodmare'))).toEqual([
      '第 2 行欄數應為 61，實際為 60',
    ]);
  });

  it('只有表頭時停止', () => {
    const format = IMPORT_FORMATS.aprFoals;
    const bytes = fileBytes([headerCells(format)], '\t');
    expect(problemsOf(parseImportFile(bytes, 'aprFoals'))).toEqual(['檔案只有表頭，沒有資料列']);
  });

  it('問題超過上限時只列出前幾項', () => {
    const format = IMPORT_FORMATS.broodmare;
    const short = dataCells(format, {}).slice(0, -1);
    const rows = [headerCells(format), ...Array.from({ length: 12 }, () => short)];
    const problems = problemsOf(parseImportFile(fileBytes(rows, '\t'), 'broodmare'));
    expect(problems).toHaveLength(11);
    expect(problems.at(-1)).toBe('另有 2 項問題未列出');
  });
});
