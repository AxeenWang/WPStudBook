import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { buildSampleBytes, syntheticSample } from '../../scripts/lib/synthetic-samples.ts';
import { addMareViaUi, createGameViaUi, gotoPage, openApp } from './helpers.ts';

const SAMPLE = syntheticSample('mayMares');

function payload() {
  return {
    name: SAMPLE.fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from(buildSampleBytes(SAMPLE)),
  };
}

/** 檔名 `1968年 5月1週_繁殖牝馬.txt` 會預選五月匯入，仍要按「產生預覽」才繼續（IMP-02）。 */
async function pickFile(page: Page): Promise<void> {
  await gotoPage(page, '年度匯入');
  await page.getByLabel('選擇匯入檔（也可以把檔案拖放到這裡）').setInputFiles(payload());
  await expect(page.getByTestId('import-file-name')).toContainText(SAMPLE.fileName);
  // 預選的是五月繁殖牝馬總表，年與時點也從檔名解析出來（IMP-02）。
  await expect(page.getByLabel('匯入類型').locator('option:checked')).toHaveText(
    '五月繁殖牝馬總表',
  );
  await expect(page.getByLabel('遊戲年')).toHaveValue('1968');
  await expect(page.getByLabel('月', { exact: true })).toHaveValue('5');
  await expect(page.getByLabel('週', { exact: true })).toHaveValue('1');
  await page.getByRole('button', { name: '產生預覽' }).click();
  await expect(page.getByTestId('may-preview-table')).toBeVisible();
}

test.describe('年度匯入：五月繁殖牝馬總表', () => {
  test('[IMP-02][MAY-02][MAY-03][LINE-05] 檔名預選類型、預覽分類與據點分布、補登親系統後套用', async ({
    page,
  }) => {
    await openApp(page);
    await createGameViaUi(page, '五月匯入局');
    await pickFile(page);

    // 三匹都配對不到既有紀錄 → 新進（其他），據點 32、33、35 各一（MAY-02、MAY-03）。
    await expect(page.getByTestId('may-overview')).toContainText('新進（其他）3');
    await expect(page.getByTestId('may-sites')).toHaveText(
      '據點分布：日本 1、分場（俱樂部牧場） 1、美國 0、歐洲 1',
    );

    // 父系尚未登錄，可以就地補登；不補登也不影響匯入（LINE-05）。
    const unknown = page.getByTestId('may-unknown-subsystems');
    await expect(unknown).toContainText('エクリプス');
    await unknown.getByLabel('子系統').selectOption('エクリプス');
    await unknown.getByLabel('親系統').fill('エクリプス');
    await unknown.getByRole('button', { name: '補登親系統' }).click();
    await expect(page.getByTestId('may-preview-table')).toBeVisible();
    await expect(unknown).not.toContainText('エクリプス、');

    await page.getByRole('button', { name: '套用這份總表' }).click();
    await expect(page.getByTestId('import-history')).toContainText(SAMPLE.fileName);

    // 新進（其他）是待指定用途（需求規格 11.5）。
    await gotoPage(page, '母馬群');
    const herd = page.getByRole('region', { name: '繁殖牝馬群' });
    await herd.getByLabel('系', { exact: true }).selectOption({ label: '待指定用途' });
    await expect(herd).toContainText('テストメス001');
    await expect(herd).toContainText('テストメス002');
  });

  test('[MARE-09] 缺席者的預設處置可以逐匹更正', async ({ page }) => {
    await openApp(page);
    await createGameViaUi(page, '缺席處置局');
    await gotoPage(page, '母馬群');
    await addMareViaUi(page, {
      position: 1,
      generation: 1,
      name: 'テストルスバン',
      site: '日本',
      birthYear: 1960,
    });
    await expect(page.getByRole('region', { name: '繁殖牝馬群' })).toContainText('テストルスバン');

    await pickFile(page);
    // 總表裡沒有她 → 缺席；1967 年時 7 歲，未達定年，預設售出。
    const row = page.getByTestId('may-preview-table').locator('tr', {
      hasText: 'テストルスバン',
    });
    await expect(row).toContainText('售出');
    await row.getByLabel('テストルスバン的處置').selectOption({ label: '定年引退' });

    await page.getByRole('button', { name: '套用這份總表' }).click();
    await expect(page.getByTestId('import-history')).toContainText(SAMPLE.fileName);

    await gotoPage(page, '母馬群');
    const herd = page.getByRole('region', { name: '繁殖牝馬群' });
    await herd.getByLabel('狀態').selectOption({ label: '已離圈' });
    await expect(herd).toContainText('テストルスバン');
    await herd
      .getByRole('button', { name: /テストルスバン/ })
      .first()
      .click();
    await expect(
      page.getByRole('dialog', { name: '「テストルスバン」詳情' }).getByRole('tabpanel'),
    ).toContainText('已離圈（定年引退）');
  });
});
