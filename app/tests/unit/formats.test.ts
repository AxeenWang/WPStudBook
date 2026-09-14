import { describe, expect, it } from 'vitest';
import { IMPORT_TYPES } from '../../src/domain/import-type.ts';
import {
  FORMAT_OF_IMPORT_TYPE,
  IMPORT_FORMATS,
  findHeaderMismatches,
  type ImportFormat,
} from '../../src/import/formats.ts';

function headerRowFor(format: ImportFormat): string[] {
  const row = Array.from({ length: format.columnCount }, (_, index) => `欄${String(index + 1)}`);
  for (const { position, name } of format.headers) {
    row[position - 1] = name;
  }
  return row;
}

describe('匯入格式表（附錄 A）', () => {
  it('每種匯入類型都對應到一種格式', () => {
    for (const importType of IMPORT_TYPES) {
      expect(IMPORT_FORMATS[FORMAT_OF_IMPORT_TYPE[importType]]).toBeDefined();
    }
  });

  it('表頭位置都在欄數範圍內且不重複，最後一欄是空白', () => {
    for (const format of Object.values(IMPORT_FORMATS)) {
      const positions = format.headers.map((header) => header.position);
      expect(new Set(positions).size).toBe(positions.length);
      expect(positions.every((position) => position >= 1 && position <= format.columnCount)).toBe(
        true,
      );
      expect(format.headers).toContainEqual({ position: format.columnCount, name: '' });
    }
  });

  it('符合格式的表頭沒有差異', () => {
    for (const format of Object.values(IMPORT_FORMATS)) {
      expect(findHeaderMismatches(format, headerRowFor(format))).toEqual([]);
    }
  });

  it('欄位名稱不同時指出位置與預期名稱', () => {
    const format = IMPORT_FORMATS.broodmare;
    const row = headerRowFor(format);
    row[56] = '別的欄';
    expect(findHeaderMismatches(format, row)).toEqual([
      '第 57 欄應為「能力番号」，實際為「別的欄」',
    ]);
  });

  it('欄數不同時回報欄數與缺少的欄', () => {
    const format = IMPORT_FORMATS.stallion;
    const row = headerRowFor(format).slice(0, -1);
    expect(findHeaderMismatches(format, row)).toEqual([
      '欄數應為 63，實際為 62',
      '第 63 欄應為「」，實際為「（不存在）」',
    ]);
  });
});
