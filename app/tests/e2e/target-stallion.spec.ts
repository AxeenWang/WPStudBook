import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import {
  buildSampleBytes,
  syntheticSample,
  type SyntheticSample,
} from '../../scripts/lib/synthetic-samples.ts';
import { createGameViaUi, gotoPage, openApp } from './helpers.ts';

const SAMPLE = syntheticSample('targetStallion');

/** 0 匹的檔案：只有表頭，整份不套用（STL-04）。 */
const EMPTY: SyntheticSample = { ...SAMPLE, fileName: '目標種牡馬_空.txt', rows: [] };

function payload(sample: SyntheticSample) {
  return {
    name: sample.fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from(buildSampleBytes(sample)),
  };
}

/** 檔名解析不出年與時點，所以類型、年與時點都要自己選（IMP-03）。 */
async function pickFile(page: Page, sample: SyntheticSample): Promise<void> {
  await gotoPage(page, '年度匯入');
  await page.getByLabel('選擇匯入檔（也可以把檔案拖放到這裡）').setInputFiles(payload(sample));
  await expect(page.getByTestId('import-file-name')).toContainText(sample.fileName);
  await page.getByLabel('匯入類型').selectOption({ label: '目標種牡馬 TXT' });
  // 數字欄位在失焦時才送出值，所以填完要離開欄位。
  await page.getByLabel('月', { exact: true }).fill('5');
  await page.getByLabel('月', { exact: true }).blur();
  await page.getByLabel('週', { exact: true }).fill('1');
  await page.getByLabel('週', { exact: true }).blur();
  await expect(page.getByLabel('用途')).toBeVisible();
}

test.describe('年度匯入：目標種牡馬 TXT', () => {
  test('[STL-01] 開啟建立新系的分支並匯入 → 建立該系零代種牡馬並連結分支', async ({ page }) => {
    await openApp(page);
    await createGameViaUi(page, '目標種牡馬局');
    await pickFile(page, SAMPLE);

    // 子系統留白就取檔案的父系；預覽先讓人看清楚要連結到哪一系（需求規格 11.9）。
    await page.getByLabel('親系統', { exact: true }).fill('ヘロド');
    await page.getByRole('button', { name: '產生預覽' }).click();
    const preview = page.getByTestId('target-stallion-preview');
    await expect(preview).toContainText('テストウマ004');
    await expect(preview).toContainText('第 1 系（建立新系）');
    await expect(page.getByTestId('target-stallion-outcome')).toContainText('可套用');

    await page.getByRole('button', { name: '套用這匹目標種牡馬' }).click();
    await expect(page.getByTestId('import-history')).toContainText(SAMPLE.fileName);

    await gotoPage(page, '八系');
    const first = page.getByTestId('line-slot-1');
    await expect(first).toContainText('ヘロド');
    await expect(first).toContainText('テストウマ004');
    await expect(page.getByTestId('line-slot-2')).toContainText('尚未開啟');
  });

  test('[STL-04] 檔案裡沒有任何一匹時停止，不寫入', async ({ page }) => {
    await openApp(page);
    await createGameViaUi(page, '空檔局');
    await pickFile(page, EMPTY);
    await page.getByLabel('親系統', { exact: true }).fill('ヘロド');
    await page.getByRole('button', { name: '產生預覽' }).click();

    await expect(page.getByRole('alert')).toContainText('匯入停止');
    await gotoPage(page, '八系');
    await expect(page.getByTestId('line-slot-1')).toContainText('尚未開啟');
  });
});
