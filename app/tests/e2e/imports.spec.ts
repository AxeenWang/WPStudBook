import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { buildSampleBytes, syntheticSample } from '../../scripts/lib/synthetic-samples.ts';
import { closeDrawer, createGameViaUi, gotoPage, openApp } from './helpers.ts';

const SAMPLE = syntheticSample('candidateFile');
const BYTES = buildSampleBytes(SAMPLE);

function payload() {
  return { name: SAMPLE.fileName, mimeType: 'text/plain', buffer: Buffer.from(BYTES) };
}

/** 候選 TXT 的檔名解析不出年與時點，所以類型、年份與時點都由使用者填（IMP-03）。 */
async function chooseCandidate(page: Page): Promise<void> {
  await page.getByLabel('匯入類型').selectOption({ label: '候選 TXT' });
  const year = page.getByLabel('遊戲年');
  await year.fill('1968');
  await year.blur();
  const month = page.getByLabel('月', { exact: true });
  await month.fill('9');
  await month.blur();
  const week = page.getByLabel('週', { exact: true });
  await week.fill('3');
  await week.blur();
  await page.getByRole('button', { name: '產生預覽' }).click();
  await expect(page.getByTestId('candidate-preview-table')).toBeVisible();
}

test.describe('年度匯入：候選 TXT', () => {
  test('[CAND-01][CAND-02][IMP-05] 選檔、預覽、搜尋、勾選與匯入', async ({ page }) => {
    await openApp(page);
    await createGameViaUi(page, '候選匯入局');
    await gotoPage(page, '年度匯入');

    await page.getByLabel('選擇匯入檔（也可以把檔案拖放到這裡）').setInputFiles(payload());
    await expect(page.getByTestId('import-file-name')).toContainText(SAMPLE.fileName);
    // 檔名無法解析時不預選類型（IMP-03）。
    await expect(page.getByLabel('匯入類型')).toHaveValue('');

    await chooseCandidate(page);
    await expect(page.getByTestId('import-summary')).toHaveText(
      '可套用 30、略過 0、待核對 0、警告 0、錯誤 0',
    );
    // 每頁 24 筆，30 筆要分兩頁。
    await expect(page.getByTestId('candidate-preview-table').locator('tbody tr')).toHaveCount(24);

    await page.getByLabel('搜尋馬名、父馬、母馬或父系').fill('テスト候補002');
    await expect(page.getByTestId('candidate-preview-table').locator('tbody tr')).toHaveCount(1);
    await page.getByLabel('搜尋馬名、父馬、母馬或父系').fill('');

    // 用途：只選據點，母馬群留「待指定用途」（需求規格 11.5）；原牧場只會記為來源（CAND-04）。
    await page.getByLabel('據點').selectOption({ label: '日本' });

    // 先全部取消，再只勾兩筆（CAND-02）。
    const toggleAll = page.getByRole('button', { name: '本頁全選／全不選' });
    await toggleAll.click();
    await page.getByRole('button', { name: '下一頁' }).click();
    await toggleAll.click();
    await page.getByRole('button', { name: '上一頁' }).click();
    await page.getByLabel('勾選 (外)テスト候補001').check();
    await page.getByLabel('勾選 テスト候補002').check();

    await page.getByRole('button', { name: '匯入勾選的 2 匹' }).click();
    await expect(page.getByRole('status').filter({ hasText: '已匯入 2 匹母馬' })).toBeVisible();
    await expect(page.getByTestId('import-history')).toContainText(SAMPLE.fileName);

    // 待指定用途的母馬有自己的檢視，不屬於任何系（需求規格 11.5「新進（其他）」）。
    await gotoPage(page, '母馬群');
    const herd = page.getByRole('region', { name: '繁殖牝馬群' });
    await expect(herd).not.toContainText('テスト候補002');
    await herd.getByLabel('系', { exact: true }).selectOption({ label: '待指定用途' });
    await expect(page.getByTestId('mare-group-title')).toHaveText('待指定用途');
    await expect(herd).toContainText('テスト候補002');

    // [MARE-21] 父馬、母馬、父系立即顯示；沒有內部馬匹時標示「尚未連結內部馬匹」。
    await herd
      .getByRole('button', { name: /テスト候補002/ })
      .first()
      .click();
    const drawer = page.getByRole('dialog', { name: '「テスト候補002」詳情' });
    await expect(drawer.getByRole('tabpanel')).toContainText('ヘロド');
    await drawer.getByRole('tab', { name: '血緣' }).click();
    await expect(drawer.getByRole('tabpanel')).toContainText('尚未連結內部馬匹');

    // 指定用途後才離開這個檢視、進入該系該代的母馬群。
    await drawer.getByRole('tab', { name: '概要' }).click();
    const assign = drawer.getByRole('form', { name: '指定用途' });
    await assign.getByLabel('母馬群的系').selectOption({ label: '第 1 系' });
    const generation = assign.getByLabel('母馬群的代數（0＝第 1 系起點）');
    await generation.fill('1');
    await generation.blur();
    await assign.getByRole('button', { name: '指定用途' }).click();
    // 斷言在持久的結果上：指定成功後她不再是待指定用途，表單也跟著消失。
    // 成功訊息是暫態的，詳情欄重新載入就可能已經換掉，不適合當斷言對象。
    await expect(drawer.getByRole('tabpanel')).toContainText('替代第 1 系 1 代');
    await expect(assign).toBeHidden();
    await closeDrawer(drawer);

    await herd.getByLabel('系', { exact: true }).selectOption({ label: '第 1 系' });
    await expect(herd).toContainText('テスト候補002');
  });

  test('[IMP-13] 拖放檔案進入與選檔相同的預覽流程', async ({ page }) => {
    await openApp(page);
    await createGameViaUi(page, '拖放匯入局');
    await gotoPage(page, '年度匯入');

    const transfer = await page.evaluateHandle(
      ({ name, data }: { name: string; data: readonly number[] }) => {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(new File([new Uint8Array(data)], name, { type: 'text/plain' }));
        return dataTransfer;
      },
      { name: SAMPLE.fileName, data: [...BYTES] },
    );
    await page.getByTestId('import-drop-zone').dispatchEvent('drop', { dataTransfer: transfer });
    await expect(page.getByTestId('import-file-name')).toContainText(SAMPLE.fileName);

    await chooseCandidate(page);
    await expect(page.getByTestId('import-summary')).toContainText('可套用 30');
  });

  test('總覽的年度工作卡可直接選檔：帶到年度匯入頁，預選該卡的類型與月份', async ({ page }) => {
    await openApp(page);
    await createGameViaUi(page, '交接局', 1968);
    await gotoPage(page, '總覽');

    const chooser = page.waitForEvent('filechooser');
    await page
      .getByTestId('annual-work-julMares')
      .getByRole('button', { name: '匯入七月繁殖牝馬總表' })
      .click();
    await (
      await chooser
    ).setFiles({
      name: '受胎確認.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('x'),
    });

    const nav = page.getByRole('navigation', { name: '主要頁面' });
    await expect(nav.getByRole('button', { name: '年度匯入', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByTestId('import-file-name')).toHaveText('已選擇：受胎確認.txt');
    await expect(page.getByLabel('匯入類型').locator('option:checked')).toHaveText(
      '七月繁殖牝馬總表',
    );
    await expect(page.getByLabel('遊戲年')).toHaveValue('1968');
    await expect(page.getByLabel('月', { exact: true })).toHaveValue('7');
    await expect(page.getByLabel('週', { exact: true })).toHaveValue('1');

    // 交接的檔案只屬於原本那一局：在年度匯入頁建立（切換到）另一局後不再帶入。
    await page
      .getByRole('group', { name: '常用操作' })
      .getByRole('button', { name: '新遊戲局' })
      .click();
    const create = page.getByRole('dialog', { name: '建立遊戲局' });
    await create.getByLabel('遊戲局名稱').fill('另一局');
    await create.getByRole('button', { name: '建立遊戲局' }).click();
    await expect(page.getByTestId('status-game')).toHaveText('另一局');
    await expect(page.getByTestId('import-file-name')).toHaveCount(0);

    // 從側欄重新進入年度匯入頁是重新開始，不再帶入同一個檔案。
    await gotoPage(page, '總覽');
    await gotoPage(page, '年度匯入');
    await expect(page.getByTestId('import-file-name')).toHaveCount(0);
  });
});
