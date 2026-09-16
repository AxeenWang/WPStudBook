import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  addMareViaUi,
  changeYearViaUi,
  createGameViaUi,
  gotoPage,
  openApp,
  openLineViaUi,
} from './helpers.ts';

function board(page: Page): Locator {
  return page.getByRole('region', { name: '任務看板' });
}

function herd(page: Page): Locator {
  return page.getByRole('region', { name: '繁殖牝馬群' });
}

async function openDrawer(page: Page, name: string): Promise<Locator> {
  await herd(page)
    .getByRole('article', { name })
    .getByRole('button', { name, exact: true })
    .click();
  const drawer = page.getByRole('dialog', { name: `「${name}」詳情` });
  await expect(drawer).toBeVisible();
  return drawer;
}

async function breedConceived(page: Page, mareName: string): Promise<void> {
  await gotoPage(page, '母馬群');
  const drawer = await openDrawer(page, mareName);
  await drawer.getByRole('tab', { name: '配種' }).click();
  const form = drawer.getByRole('form', { name: '登記繁殖紀錄' });
  await form.getByLabel('受胎狀態').selectOption({ label: '受胎' });
  await form.getByRole('button', { name: '保存繁殖紀錄' }).click();
  await expect(form.getByRole('status')).toContainText('繁殖紀錄');
  await page.keyboard.press('Escape');
}

async function confirmBirth(
  page: Page,
  mareName: string,
  breedingYear: number,
  sex: '牡' | '牝',
): Promise<void> {
  await gotoPage(page, '資料管理');
  await changeYearViaUi(page, breedingYear + 1);
  await gotoPage(page, '母馬群');
  const drawer = await openDrawer(page, mareName);
  await drawer.getByRole('tab', { name: '配種' }).click();
  await drawer
    .getByRole('listitem', { name: `${String(breedingYear)} 年繁殖紀錄` })
    .getByRole('button', { name: '確認出生' })
    .click();
  const foalForm = drawer.getByRole('form', { name: '登記產駒' });
  await foalForm.getByLabel('性別').selectOption({ label: sex });
  await foalForm.getByRole('button', { name: '登記產駒' }).click();
  await expect(drawer.getByRole('status').first()).toContainText('已登記產駒');
  await page.keyboard.press('Escape');
}

async function openFoalRow(page: Page, name: string): Promise<Locator> {
  await gotoPage(page, '產駒');
  const row = page.getByRole('list', { name: '產駒清單' }).getByRole('listitem', { name });
  await row.getByRole('button', { name, exact: true }).click();
  return row;
}

async function nameFoal(page: Page, row: Locator, name: string): Promise<Locator> {
  const form = row.getByRole('form', { name: '正式馬名' });
  await form.getByLabel('正式馬名').fill(name);
  await form.getByRole('button', { name: '保存馬名' }).click();
  const renamed = page.getByRole('list', { name: '產駒清單' }).getByRole('listitem', { name });
  await expect(renamed.getByRole('form', { name: '正式馬名' }).getByRole('status')).toHaveText(
    `已登記正式馬名「${name}」`,
  );
  return renamed;
}

test.describe('總覽與任務看板（需求規格 13.2）', () => {
  test('[LINE-04][LINE-06] 八系卡片、親系統狀態與系統名稱更新', async ({ page }) => {
    await openApp(page);
    await createGameViaUi(page, '總覽局', 1968);
    await openLineViaUi(page, 1, 'ネアルコ', 'テストシュボバ');

    await expect(page.getByTestId('parent-system-count')).toHaveText('親系統種類數 1／8');
    const card = page.getByTestId('overview-line-1');
    await expect(card).toContainText('ネアルコ');
    await expect(card).toContainText('尚未成立');
    await expect(page.getByTestId('overview-line-2')).toContainText('尚未開啟');

    await gotoPage(page, '八系');
    const form = page.getByRole('form', { name: '更新系統名稱' });
    await form.getByLabel('第 1 系目前子系統').fill('ネアルコ二世');
    await form.getByRole('button', { name: '更新第 1 系系統名稱' }).click();
    await expect(form.getByRole('status')).toHaveText('第 1 系已更新為「ネアルコ二世」');

    // 位置與代表色不變，只有名稱更新。
    await gotoPage(page, '總覽');
    await expect(page.getByTestId('overview-line-1')).toContainText('ネアルコ二世');
    await expect(page.getByTestId('parent-system-count')).toHaveText('親系統種類數 1／8');
  });

  test('[LINE-09][LINE-02] 產出 2 代時看板列出兩條配對，可開啟第 2 系並登記指定配種', async ({
    page,
  }) => {
    test.slow();
    await openApp(page);
    await createGameViaUi(page, '建系局', 1968);
    await openLineViaUi(page, 1, 'ネアルコ', 'テストシュボバ');
    await gotoPage(page, '母馬群');
    await addMareViaUi(page, {
      position: 1,
      generation: 0,
      name: 'オオトリモナーコス',
      site: '日本',
    });

    // 第 1 系 1 代：母駒轉入讓該代成立，公駒接任現任。
    await breedConceived(page, 'オオトリモナーコス');
    await confirmBirth(page, 'オオトリモナーコス', 1968, '牝');
    await breedConceived(page, 'オオトリモナーコス');
    await confirmBirth(page, 'オオトリモナーコス', 1969, '牡');

    const filly = await openFoalRow(page, 'オオトリモナーコス1969');
    const namedFilly = await nameFoal(page, filly, 'テストムスメ');
    const convert = namedFilly.getByRole('form', { name: '轉入為繁殖牝馬' });
    await convert.getByLabel('轉入據點').selectOption({ label: '日本' });
    await convert.getByRole('button', { name: '轉入母馬群' }).click();
    await expect(convert.getByRole('status')).toContainText('該代已成立');

    const colt = await openFoalRow(page, 'オオトリモナーコス1970');
    const namedColt = await nameFoal(page, colt, 'テストムスコ');
    const assign = namedColt.getByRole('form', { name: '接任現任' });
    await assign.getByRole('button', { name: '接任現任' }).click();
    await expect(namedColt.getByRole('region', { name: '種牡馬' }).getByRole('status')).toHaveText(
      '已接任第 1 系 1 代現任',
    );

    // 推進原系用的替代第 2 系母馬。
    await gotoPage(page, '母馬群');
    await addMareViaUi(page, {
      position: 2,
      generation: 1,
      name: 'テストダイヨウ',
      site: '日本',
      origin: '市場創系',
    });

    await gotoPage(page, '總覽');
    const cards = board(page).locator('li.task-card');
    await expect(
      board(page).getByRole('heading', { name: '第 1 系 1 代 × 替代第 2 系 → 第 1 系 2 代' }),
    ).toBeVisible();
    await expect(
      board(page).getByRole('heading', { name: '第 2 系零代 × 第 1 系 1 代母馬 → 第 2 系 2 代' }),
    ).toBeVisible();
    await expect(cards.first()).toContainText('高優先');
    await expect(cards.first()).toContainText('推進原系');

    // 依任務登記指定配種。
    await board(page)
      .getByRole('list', { name: '可配母馬' })
      .first()
      .getByRole('button', { name: '登記指定配種' })
      .click();
    await expect(page.getByTestId('task-feedback').getByRole('status')).toContainText(
      '已依任務登記「テストダイヨウ」的 1970 年指定配種',
    );
    await expect(board(page).getByText('1970 年已登記')).toBeVisible();

    // 建立新系：只有規則指定的第 2 系可以開啟。
    await openLineViaUi(page, 2, 'ヘロド', 'テストシンケイ');
    await expect(page.getByTestId('parent-system-count')).toHaveText('親系統種類數 2／8');
    await expect(page.getByTestId('overview-line-2')).toContainText('ヘロド');
  });
});
