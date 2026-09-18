import { expect, test, type Page } from '@playwright/test';
import { buildSampleBytes, syntheticSample } from '../../scripts/lib/synthetic-samples.ts';
import { addMareViaUi, createGameViaUi, gotoPage, openApp } from './helpers.ts';

const MAY = syntheticSample('mayMares');
const JUL = syntheticSample('julMares');

function payload(sample: typeof MAY) {
  return {
    name: sample.fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from(buildSampleBytes(sample)),
  };
}

async function importMay(page: Page): Promise<void> {
  await gotoPage(page, '年度匯入');
  await page.getByLabel('選擇匯入檔（也可以把檔案拖放到這裡）').setInputFiles(payload(MAY));
  await expect(page.getByLabel('匯入類型').locator('option:checked')).toHaveText(
    '五月繁殖牝馬總表',
  );
  await page.getByRole('button', { name: '產生預覽' }).click();
  await expect(page.getByTestId('may-preview-table')).toBeVisible();
  await page.getByRole('button', { name: '套用這份總表' }).click();
  await expect(page.getByTestId('import-history')).toContainText(MAY.fileName);
}

async function previewJul(page: Page): Promise<void> {
  await gotoPage(page, '年度匯入');
  await page.getByLabel('選擇匯入檔（也可以把檔案拖放到這裡）').setInputFiles(payload(JUL));
  await expect(page.getByLabel('匯入類型').locator('option:checked')).toHaveText(
    '七月繁殖牝馬總表',
  );
  await expect(page.getByLabel('月', { exact: true })).toHaveValue('7');
  await page.getByRole('button', { name: '產生預覽' }).click();
  await expect(page.getByTestId('jul-preview-table')).toBeVisible();
}

test.describe('年度匯入：七月繁殖牝馬總表', () => {
  test('[JUL-01][JUL-09] 依狀態統計、逐筆列出自動建立的類型，確認後才寫入', async ({ page }) => {
    await openApp(page);
    await createGameViaUi(page, '七月匯入局');
    // 先有五月名單，七月才配對得到（需求規格 11.6）。
    await importMay(page);

    await previewJul(page);
    await expect(page.getByTestId('jul-conceptions')).toHaveText(
      '狀態分布：空胎 0、受胎 2、不受胎 1、未確認 0',
    );
    await expect(page.getByTestId('jul-overview')).toContainText('自動建立 3');
    await expect(page.getByTestId('jul-preview-table')).toContainText('自動建立自由配種');

    // 沒有確認就不套用（JUL-09）。
    await page.getByRole('button', { name: '套用這份總表' }).click();
    await expect(page.getByRole('alert')).toContainText('確認');

    await page.getByTestId('import-confirmations').getByRole('checkbox').check();
    await page.getByRole('button', { name: '套用這份總表' }).click();
    await expect(page.getByTestId('import-history')).toContainText(JUL.fileName);

    // 受胎結果寫進母馬的配種頁籤（需求規格 9.1）。
    await gotoPage(page, '母馬群');
    const herd = page.getByRole('region', { name: '繁殖牝馬群' });
    await herd.getByLabel('系', { exact: true }).selectOption({ label: '待指定用途' });
    await herd.getByRole('button', { name: 'テストメス001' }).click();
    const drawer = page.getByRole('dialog', { name: '「テストメス001」詳情' });
    await drawer.getByRole('tab', { name: '配種' }).click();
    await expect(drawer.getByRole('tabpanel')).toContainText('受胎');
    await expect(drawer.getByRole('tabpanel')).toContainText('テストウマ001');
  });

  test('[JUL-02] 七月缺席的母馬只列出核對，不移出繁殖牝馬圈', async ({ page }) => {
    await openApp(page);
    await createGameViaUi(page, '七月核對局');
    await gotoPage(page, '母馬群');
    await addMareViaUi(page, {
      position: 1,
      generation: 1,
      name: 'テストルスバン',
      site: '日本',
      birthYear: 1960,
    });
    const herd = page.getByRole('region', { name: '繁殖牝馬群' });
    await expect(herd).toContainText('テストルスバン');

    await previewJul(page);
    const row = page.getByTestId('jul-preview-table').locator('tr', {
      has: page.getByRole('rowheader', { name: 'テストルスバン' }),
    });
    await expect(row).toContainText('七月缺席');
    await expect(row).toContainText('不移出繁殖牝馬圈');

    // 待處理與缺席都不寫入，所以套用後她還在圈裡。
    await page.getByRole('button', { name: '套用這份總表' }).click();
    await expect(page.getByTestId('import-history')).toContainText(JUL.fileName);
    await gotoPage(page, '母馬群');
    await expect(page.getByRole('region', { name: '繁殖牝馬群' })).toContainText('テストルスバン');
  });
});
