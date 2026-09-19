import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import {
  buildSampleBytes,
  syntheticSample,
  type SyntheticSample,
} from '../../scripts/lib/synthetic-samples.ts';
import { addMareViaUi, createGameViaUi, gotoPage, openApp } from './helpers.ts';

const APR = syntheticSample('aprFoals');
const JAN = syntheticSample('jan2yo');

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

/** 1968 年開局、一匹管理中的母馬，四月總表確認建立她的產駒（能力番号 0x3001）。 */
async function setupFoal(page: Page, gameName: string): Promise<void> {
  await openApp(page);
  await createGameViaUi(page, gameName);
  await gotoPage(page, '母馬群');
  await addMareViaUi(page, {
    position: 1,
    generation: 1,
    name: 'テストメス001',
    site: '日本',
    birthYear: 1960,
  });
  await expect(page.getByRole('region', { name: '繁殖牝馬群' })).toContainText('テストメス001');

  await chooseFile(page, APR);
  const row = page.getByTestId('apr-preview-table').locator('tr', {
    has: page.getByRole('rowheader', { name: 'テストメス001の0歳' }),
  });
  await row.getByRole('checkbox').check();
  await page.getByTestId('import-confirmations').getByRole('checkbox').check();
  await page.getByRole('button', { name: '套用這份總表' }).click();
  await expect(page.getByTestId('import-history')).toContainText(APR.fileName);
}

async function confirmAll(page: Page): Promise<void> {
  const boxes = page.getByTestId('import-confirmations').getByRole('checkbox');
  for (const box of await boxes.all()) {
    await box.check();
  }
}

test.describe('年度匯入：一月二歲馬總表', () => {
  test('[JAN-02][JAN-05][BRD-20] 唯一配對的產駒補上正式馬名；非管理的馬只顯示筆數；補名管理由等待總表變成已由總表更新', async ({
    page,
  }) => {
    await setupFoal(page, '一月匯入局');

    await gotoPage(page, '產駒');
    await expect(page.getByTestId('naming-summary')).toContainText('等待總表 1');
    const list = page.getByRole('list', { name: '產駒清單' });
    await expect(list.getByTestId('foal-naming')).toHaveText('等待總表');

    await chooseFile(page, JAN);
    await expect(page.getByLabel('匯入類型').locator('option:checked')).toHaveText(
      '一月二歲馬總表',
    );
    await expect(page.getByTestId('jan-birth-year')).toContainText('出生年 1968 年');
    // テストメス010 的母馬與 [地]テストウマ011 都不是這一局的，只顯示筆數（JAN-02）。
    await expect(page.getByTestId('jan-birth-year')).toContainText('其他二歲馬 2 筆');
    const table = page.getByTestId('jan-preview-table');
    await expect(table.getByRole('rowheader')).toHaveText(['テストウマ010']);
    await expect(table).toContainText('補正式馬名');
    await expect(table).toContainText('テストメス0011968（能力番号＋出生年）');

    const apply = page.getByRole('button', { name: '套用這份總表' });
    await expect(apply).toBeDisabled();
    await page.getByLabel('出生年 1968 年正確（1970 年的二歲馬）').check();
    await confirmAll(page);
    await apply.click();
    await expect(page.getByTestId('import-history')).toContainText(JAN.fileName);
    await expect(page.getByTestId('status-year')).toHaveText('1970 年');

    await gotoPage(page, '產駒');
    await expect(list).toContainText('テストウマ010');
    await expect(list.getByTestId('foal-naming')).toHaveText('已由總表更新');
    await expect(page.getByTestId('naming-summary')).toContainText('已由總表更新 1');
    await expect(page.getByTestId('naming-todo')).toHaveText('沒有需要人工補名的產駒。');
  });

  test('人工確認：選定候選產駒後以警告列套用，未選的不寫入', async ({ page }) => {
    await setupFoal(page, '一月確認局');

    // 能力番号相符但母馬不同：列為人工確認，候選就是那匹產駒（需求規格 6.2）。
    const mismatch: SyntheticSample = {
      ...JAN,
      rows: JAN.rows.map((row, index) => (index === 0 ? { ...row, dam: 'テストメス777' } : row)),
    };
    await chooseFile(page, mismatch);
    const table = page.getByTestId('jan-preview-table');
    const picker = table.getByLabel('テストウマ010 對應的產駒');
    await expect(picker).toBeVisible();
    await expect(table).toContainText('人工確認');

    await picker.selectOption({ label: 'テストメス0011968（母 テストメス001・父 テストウマ001）' });
    await expect(table).toContainText('補正式馬名');
    await expect(page.getByTestId('import-confirmations')).toContainText('有 1 列警告');
    // 改選「不選」就回到人工確認。
    await picker.selectOption({ label: '不選（不寫入）' });
    await expect(table).not.toContainText('補正式馬名');
    await picker.selectOption({ label: 'テストメス0011968（母 テストメス001・父 テストウマ001）' });

    await page.getByLabel('出生年 1968 年正確（1970 年的二歲馬）').check();
    await confirmAll(page);
    await page.getByRole('button', { name: '套用這份總表' }).click();
    await expect(page.getByTestId('import-history')).toContainText(JAN.fileName);

    await gotoPage(page, '產駒');
    await expect(page.getByRole('list', { name: '產駒清單' })).toContainText('テストウマ010');
  });
});
