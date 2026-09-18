import { expect, test, type Page } from '@playwright/test';
import {
  buildSampleBytes,
  syntheticSample,
  type SyntheticSample,
} from '../../scripts/lib/synthetic-samples.ts';
import { addMareViaUi, createGameViaUi, gotoPage, openApp } from './helpers.ts';

const APR = syntheticSample('aprFoals');

function payload(sample: SyntheticSample) {
  return {
    name: sample.fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from(buildSampleBytes(sample)),
  };
}

async function previewApr(page: Page): Promise<void> {
  await gotoPage(page, '年度匯入');
  await page.getByLabel('選擇匯入檔（也可以把檔案拖放到這裡）').setInputFiles(payload(APR));
  await expect(page.getByLabel('匯入類型').locator('option:checked')).toHaveText(
    '四月誕生幼駒總表',
  );
  await expect(page.getByLabel('月', { exact: true })).toHaveValue('4');
  await page.getByRole('button', { name: '產生預覽' }).click();
  await expect(page.getByTestId('apr-preview-table')).toBeVisible();
}

test.describe('年度匯入：四月誕生幼駒總表', () => {
  test('[APR-03] 沒有相符受胎紀錄 → 待核對；勾選確認後比照自由配種產駒建立', async ({ page }) => {
    await openApp(page);
    await createGameViaUi(page, '四月匯入局');
    await gotoPage(page, '母馬群');
    await addMareViaUi(page, {
      position: 1,
      generation: 1,
      name: 'テストメス001',
      site: '日本',
      birthYear: 1960,
    });
    await expect(page.getByRole('region', { name: '繁殖牝馬群' })).toContainText('テストメス001');

    await previewApr(page);
    // 母馬在管理中但沒有前一年的受胎紀錄 → 待核對；另一匹母馬不在管理資料，也是待核對。
    await expect(page.getByTestId('apr-overview')).toContainText('待核對 2');
    await expect(page.getByTestId('apr-overview')).toContainText('牡 1、牝 1');

    const row = page.getByTestId('apr-preview-table').locator('tr', {
      has: page.getByRole('rowheader', { name: 'テストメス001の0歳' }),
    });
    await row.getByRole('checkbox').check();
    await expect(row).toContainText('已確認（比照自由配種）');

    await page.getByTestId('import-confirmations').getByRole('checkbox').check();
    await page.getByRole('button', { name: '套用這份總表' }).click();
    await expect(page.getByTestId('import-history')).toContainText(APR.fileName);

    // 自由配種產駒自動待售、沒有系與代數（需求規格 9.5、APR-08）。
    await gotoPage(page, '產駒');
    const list = page.getByRole('list', { name: '產駒清單' });
    await expect(list).toContainText('テストメス0011968');
    await expect(list).toContainText('待售');
  });

  test('[APR-04] 馬主番号或繋養牧場番号超出範圍時整份停止', async ({ page }) => {
    await openApp(page);
    await createGameViaUi(page, '四月範圍局');

    const outOfRange: SyntheticSample = {
      ...APR,
      rows: APR.rows.map((row) => ({ ...row, owner: '12' })),
    };
    await gotoPage(page, '年度匯入');
    await page
      .getByLabel('選擇匯入檔（也可以把檔案拖放到這裡）')
      .setInputFiles(payload(outOfRange));
    await page.getByRole('button', { name: '產生預覽' }).click();

    await expect(page.getByRole('alert')).toContainText('匯入停止');
    await expect(page.getByTestId('apr-preview-table')).toHaveCount(0);
  });
});
