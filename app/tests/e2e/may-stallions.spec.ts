import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import {
  buildSampleBytes,
  syntheticSample,
  type SyntheticSample,
} from '../../scripts/lib/synthetic-samples.ts';
import { createGameViaUi, gotoPage, openApp } from './helpers.ts';

const SAMPLE = syntheticSample('mayStallions');

/** 隔年的總表：`年` 是馬齡要加 1，並且少掉第一匹（今年缺席）。 */
const NEXT_YEAR: SyntheticSample = {
  ...SAMPLE,
  fileName: '1969年5月1週_種牡馬.txt',
  rows: SAMPLE.rows.slice(1).map((row) => ({ ...row, age: String(Number(row.age ?? '0') + 1) })),
};

function payload(sample: SyntheticSample) {
  return {
    name: sample.fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from(buildSampleBytes(sample)),
  };
}

/** 檔名 `1968年5月1週_種牡馬.txt`（年與月之間沒有空白）仍要解析出類型與時點（IMP-02）。 */
async function pickFile(page: Page, sample: SyntheticSample): Promise<void> {
  await gotoPage(page, '年度匯入');
  await page.getByLabel('選擇匯入檔（也可以把檔案拖放到這裡）').setInputFiles(payload(sample));
  await expect(page.getByTestId('import-file-name')).toContainText(sample.fileName);
  await expect(page.getByLabel('匯入類型').locator('option:checked')).toHaveText('五月種牡馬總表');
  await expect(page.getByLabel('月', { exact: true })).toHaveValue('5');
  await page.getByRole('button', { name: '產生預覽' }).click();
  await expect(page.getByTestId('stallion-preview-table')).toBeVisible();
}

test.describe('年度匯入：五月種牡馬總表', () => {
  test('[STL-02][UI-03][STL-08] 沒有待建立新系的年份也列在年度工作清單，匯入後標示完成', async ({
    page,
  }) => {
    await openApp(page);
    await createGameViaUi(page, '種牡馬匯入局');

    // 匯入前：五項年度工作都在清單裡且未完成（需求規格 13.2、UI-03、STL-02）。
    await gotoPage(page, '總覽');
    await expect(page.getByTestId('annual-work').getByRole('listitem')).toHaveCount(5);
    await expect(page.getByTestId('annual-work-mayStallions')).toContainText('未完成');

    await pickFile(page, SAMPLE);
    await expect(page.getByLabel('遊戲年')).toHaveValue('1968');
    await expect(page.getByTestId('stallion-overview')).toContainText('新建 3');
    await page.getByRole('button', { name: '套用這份總表' }).click();
    await expect(page.getByTestId('import-history')).toContainText(SAMPLE.fileName);

    await gotoPage(page, '總覽');
    await expect(page.getByTestId('annual-work-mayStallions')).toContainText('已完成');
    await expect(page.getByTestId('annual-work-mayMares')).toContainText('未完成');
  });

  test('[STL-10][IMP-14] 隔年缺席的種牡馬標示非現役；推進遊戲年要先勾選確認', async ({ page }) => {
    await openApp(page);
    await createGameViaUi(page, '種牡馬離場局');
    await pickFile(page, SAMPLE);
    await page.getByRole('button', { name: '套用這份總表' }).click();
    await expect(page.getByTestId('import-history')).toContainText(SAMPLE.fileName);

    await pickFile(page, NEXT_YEAR);
    // 檔案裡少掉的那一匹上年在表、今年缺席 → 非現役；不是八系任期，所以不必確認。
    await expect(page.getByTestId('stallion-overview')).toContainText('非現役 1');
    await expect(page.getByTestId('stallion-overview')).toContainText('已引退 0');

    // 1969 年的檔案比目前遊戲年晚，要勾選確認才會推進（IMP-14）。
    const confirmations = page.getByTestId('import-confirmations');
    await expect(confirmations).toContainText('推進遊戲年');
    await page.getByRole('button', { name: '套用這份總表' }).click();
    await expect(page.getByRole('alert')).toContainText('確認');

    await confirmations.getByRole('checkbox').check();
    await page.getByRole('button', { name: '套用這份總表' }).click();
    await expect(page.getByTestId('import-history')).toContainText(NEXT_YEAR.fileName);
  });
});
