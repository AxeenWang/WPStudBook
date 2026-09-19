import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import {
  buildSampleBytes,
  syntheticSample,
  type SyntheticSample,
} from '../../scripts/lib/synthetic-samples.ts';
import { addMareViaUi, createGameViaUi, gotoPage, openApp } from './helpers.ts';

const APR = syntheticSample('aprFoals');
const OCT = syntheticSample('octWorldMares');

function payload(sample: SyntheticSample) {
  return {
    name: sample.fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from(buildSampleBytes(sample)),
  };
}

async function chooseFile(page: Page, sample: SyntheticSample): Promise<void> {
  await gotoPage(page, '年度匯入');
  await page.getByLabel('選擇匯入檔（也可以把檔案拖放到這裡）').setInputFiles(payload(sample));
  await page.getByRole('button', { name: '產生預覽' }).click();
}

async function confirmAllAndApply(page: Page, fileName: string): Promise<void> {
  for (const box of await page.getByTestId('import-confirmations').getByRole('checkbox').all()) {
    await box.check();
  }
  await page.getByRole('button', { name: '套用這份總表' }).click();
  await expect(page.getByTestId('import-history')).toContainText(fileName);
}

function row(label: string): Readonly<Record<string, string>> {
  const found = OCT.rows.find((item) => item.name === label);
  if (found === undefined) {
    throw new Error(`樣本沒有「${label}」`);
  }
  return found;
}

/** 1972 年十月：4,999 匹其他牧場的母馬，加上 1968 年出生、在牧場 150 的自家牝駒（4 歲）。 */
function worldMares1972(): SyntheticSample {
  const other = row('テストメス020');
  const others = Array.from({ length: 4999 }, (_, index) => ({
    ...other,
    name: `テスト他場${String(index).padStart(4, '0')}`,
    baseName: `テスト他場${String(index).padStart(4, '0')}`,
    abilityNo: `0x${(0x9000 + index).toString(16).toUpperCase()}`,
    horseNo: `0x${(0xa000 + index).toString(16).toUpperCase()}`,
    farm: String(index % 273),
  }));
  return {
    ...OCT,
    fileName: '1972年10月1週_繁殖牝馬.txt',
    rows: [...others, { ...row('テストメス010'), age: '4', farm: '150' }],
  };
}

test.describe('年度匯入：十月全世界繁殖牝馬總表', () => {
  test('[OCT-02][OCT-08] 5,000 筆顯示處理進度，預覽只列出配對到的自家產駒；套用後母馬的產駒頁籤標示去向', async ({
    page,
  }) => {
    test.slow();
    await openApp(page);
    await createGameViaUi(page, '十月匯入局');
    await gotoPage(page, '母馬群');
    await addMareViaUi(page, {
      position: 1,
      generation: 1,
      name: 'テストメス002',
      site: '日本',
      birthYear: 1960,
    });
    const herd = page.getByRole('region', { name: '繁殖牝馬群' });
    await expect(herd).toContainText('テストメス002');

    // 四月總表確認建立テストメス002 的女兒（能力番号 0x3002、1968 年出生）。
    await chooseFile(page, APR);
    await page
      .getByTestId('apr-preview-table')
      .locator('tr', { has: page.getByRole('rowheader', { name: 'テストメス002の0歳' }) })
      .getByRole('checkbox')
      .check();
    await confirmAllAndApply(page, APR.fileName);

    const world = worldMares1972();
    await chooseFile(page, world);
    await expect(page.getByLabel('匯入類型').locator('option:checked')).toHaveText(
      '十月全世界繁殖牝馬總表',
    );
    await expect(page.getByTestId('import-progress')).toHaveText('處理進度：5,000／5,000 筆');
    await expect(page.getByTestId('oct-overview')).toContainText('總數 5000');
    await expect(page.getByTestId('oct-overview')).toContainText('新發現 1');
    const table = page.getByTestId('oct-preview-table');
    await expect(table.getByRole('rowheader')).toHaveText(['テストメス010']);
    await expect(table).toContainText('テストメス0021968');
    await confirmAllAndApply(page, world.fileName);

    await gotoPage(page, '母馬群');
    await herd
      .getByRole('article', { name: 'テストメス002' })
      .getByRole('button', { name: 'テストメス002', exact: true })
      .click();
    const drawer = page.getByRole('dialog', { name: '「テストメス002」詳情' });
    await drawer.getByRole('tab', { name: '產駒' }).click();
    await expect(drawer.getByTestId('foal-mare-elsewhere')).toHaveText(
      '在其他牧場成為繁殖牝馬（牧場 150・1972 年確認）',
    );
  });

  test('[OCT-07] 十月總表不列入年度工作清單，匯入後也不建立檢查點', async ({ page }) => {
    await openApp(page);
    await createGameViaUi(page, '十月選用局');
    await gotoPage(page, '總覽');
    await expect(page.getByTestId('annual-work').getByRole('listitem')).toHaveCount(5);
    await expect(page.getByTestId('annual-work')).not.toContainText('十月');

    await chooseFile(page, OCT);
    await expect(page.getByTestId('oct-overview')).toContainText('新發現 0');
    await expect(page.getByTestId('oct-preview-table')).toHaveCount(0);
    await confirmAllAndApply(page, OCT.fileName);

    await gotoPage(page, '總覽');
    await expect(page.getByTestId('annual-work')).not.toContainText('十月');
    await expect(page.getByTestId('status-checkpoint')).toContainText('尚無');
  });
});
