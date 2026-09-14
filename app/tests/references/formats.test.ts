import { describe, expect, it } from 'vitest';
import { IMPORT_FORMATS, findHeaderMismatches } from '../../src/import/formats.ts';
import { REFERENCE_SAMPLES, readSampleBytes, sampleExists } from './samples.ts';

describe('本機實檔：CP932 解碼、表頭與每列欄數（設計決策 7.4 節）', () => {
  for (const sample of REFERENCE_SAMPLES) {
    it.skipIf(!sampleExists(sample))(`${sample.fileName}（檔案不存在時略過，視為未執行）`, () => {
      const format = IMPORT_FORMATS[sample.formatId];
      const text = new TextDecoder('shift_jis', { fatal: true }).decode(readSampleBytes(sample));
      const lines = text.split('\r\n').filter((line) => line !== '');
      expect(findHeaderMismatches(format, (lines[0] ?? '').split('\t'))).toEqual([]);

      const badLineNumbers = lines
        .map((line, index) => ({ lineNumber: index + 1, columns: line.split('\t').length }))
        .filter(({ columns }) => columns !== format.columnCount)
        .map(({ lineNumber }) => lineNumber);
      expect(badLineNumbers).toEqual([]);
    });
  }
});
