import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSampleBytes, SYNTHETIC_SAMPLES } from './lib/synthetic-samples.ts';

/**
 * 產生合成樣本檔（設計決策 7.4）。單元與整合測試直接在記憶體裡組出位元組，
 * 端到端測試需要真的檔案才能透過檔案選擇器上傳，所以另外寫到這個目錄；產物不提交。
 */
const OUTPUT_DIR = join('tests', 'fixtures', 'generated');

mkdirSync(OUTPUT_DIR, { recursive: true });
for (const sample of SYNTHETIC_SAMPLES) {
  const bytes = buildSampleBytes(sample);
  writeFileSync(join(OUTPUT_DIR, sample.fileName), bytes);
  console.log(
    `${sample.fileName}：${String(sample.rows.length)} 筆、${String(bytes.length)} 位元組`,
  );
}
