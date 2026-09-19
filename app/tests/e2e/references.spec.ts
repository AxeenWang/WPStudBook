import { expect, test } from './fixtures.ts';
import { REFERENCE_SAMPLES, readSampleBytes, sampleExists } from '../references/samples.ts';
import { APP_URL } from './helpers.ts';

test.describe('@references 本機實檔：瀏覽器與 Node 的 CP932 解碼結果一致', () => {
  for (const sample of REFERENCE_SAMPLES) {
    test(sample.fileName, async ({ page }) => {
      test.skip(!sampleExists(sample), '檔案不存在，未執行');
      const bytes = Array.from(readSampleBytes(sample));
      const nodeText = new TextDecoder('shift_jis', { fatal: true }).decode(new Uint8Array(bytes));

      await page.goto(APP_URL);
      const browserText = await page.evaluate(
        (input) => new TextDecoder('shift_jis', { fatal: true }).decode(new Uint8Array(input)),
        bytes,
      );
      expect(browserText === nodeText, '瀏覽器與 Node 解碼結果不同').toBe(true);
    });
  }
});
