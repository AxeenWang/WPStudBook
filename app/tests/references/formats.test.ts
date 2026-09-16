import { describe, expect, it } from 'vitest';
import { parseImportFile } from '../../src/import/parse.ts';
import { REFERENCE_SAMPLES, readSampleBytes, sampleExists } from './samples.ts';

/** 附錄 A 記錄的樣本筆數；只比對筆數，不輸出原始資料（設計決策 7.4）。 */
const EXPECTED_ROW_COUNTS: Readonly<Record<string, number>> = {
  '1968年 1月1週._二歲新馬.txt': 1160,
  '1968年10月1週_繁殖牝馬.txt': 2971,
  '1968年5月1週_種牡馬.txt': 443,
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
    });
  }
});
