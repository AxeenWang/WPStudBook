import { describe, expect, it } from 'vitest';
import { STALLION_COLUMNS } from '../../src/import/columns.ts';
import { cell, parseImportFile } from '../../src/import/parse.ts';
import { REFERENCE_SAMPLES, readSampleBytes, sampleExists } from './samples.ts';

/** 附錄 A 記錄的樣本筆數；只比對筆數，不輸出原始資料（設計決策 7.4）。 */
const EXPECTED_ROW_COUNTS: Readonly<Record<string, number>> = {
  '1968年 1月1週._二歲新馬.txt': 1160,
  '1968年10月1週_繁殖牝馬.txt': 2971,
  '1968年5月1週_種牡馬.txt': 443,
};

/** 附錄 A.4 記錄的 `国` 分布；同樣只比對筆數。 */
const EXPECTED_COUNTRY_COUNTS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  '1968年5月1週_種牡馬.txt': { 日: 104, 米: 158, 欧: 181 },
};

describe('本機實檔：CP932 解碼、表頭與每列欄數（設計決策 7.4 節）', () => {
  for (const sample of REFERENCE_SAMPLES) {
    it.skipIf(!sampleExists(sample))(`${sample.fileName}（檔案不存在時略過，視為未執行）`, () => {
      // 走正式的解析路徑，而不是在測試裡重寫一份：兩邊一起錯就驗不出東西。
      const result = parseImportFile(readSampleBytes(sample), sample.formatId);
      if (!result.ok) {
        throw new Error(`解析失敗：${result.problems.join('；')}`);
      }
      expect(result.file.encoding).toBe('cp932');
      expect(result.file.delimiter).toBe('\t');
      const expected = EXPECTED_ROW_COUNTS[sample.fileName];
      if (expected !== undefined) {
        expect(result.file.rows).toHaveLength(expected);
      } else {
        expect(result.file.rows.length).toBeGreaterThan(0);
      }
      const countries = EXPECTED_COUNTRY_COUNTS[sample.fileName];
      if (countries !== undefined) {
        // [STL-08] `国` 的分布（日、米、欧）與附錄 A.4 一致。
        const tally: Record<string, number> = {};
        for (const row of result.file.rows) {
          const country = cell(row, STALLION_COLUMNS.country)?.trim() ?? '';
          tally[country] = (tally[country] ?? 0) + 1;
        }
        expect(tally).toEqual(countries);
      }
    });
  }
});
