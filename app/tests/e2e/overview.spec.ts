import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import {
  addMareViaUi,
  changeYearViaUi,
  closeDrawer,
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
  await closeDrawer(drawer);
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
  await closeDrawer(drawer);
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

    // 推進原系只提供替代第 2 系的母馬：第 1 系 1 代的女兒テストムスメ 不在這一群，
    // 所以看板不會讓她配自己的哥哥（需求規格 10.3、LINE-34）。
    const advanceMares = cards.first().getByRole('list', { name: '可配母馬' });
    await expect(advanceMares).toContainText('テストダイヨウ');
    await expect(advanceMares).not.toContainText('テストムスメ');

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

    // 建系期不計算活血，所以繁殖紀錄有規則快照但沒有血統檢查結果（需求規格 10.1、PED-01）。
    await gotoPage(page, '母馬群');
    await herd(page).getByLabel('系', { exact: true }).selectOption({ label: '第 2 系' });
    const drawer = await openDrawer(page, 'テストダイヨウ');
    await drawer.getByRole('tab', { name: '配種' }).click();
    const row = drawer.getByRole('listitem', { name: '1970 年繁殖紀錄' });
    await expect(row.getByTestId('breeding-rule')).toHaveText(
      '依任務登記：第 1 系 1 代 × 第 2 系 1 代 → 第 1 系 2 代',
    );
    await expect(row.getByTestId('breeding-pedigree')).toHaveCount(0);
    await closeDrawer(drawer);
  });
  test('[LINE-18][LINE-19][LINE-21] 母馬群降為 0 時列出三個選擇；宣告斷血後暫停建立新系，取消後解除', async ({
    page,
  }) => {
    test.slow();
    await openApp(page);
    await createGameViaUi(page, '補系局', 1968);
    await openLineViaUi(page, 1, 'ネアルコ', 'テストシュボバ');
    await gotoPage(page, '母馬群');
    await addMareViaUi(page, {
      position: 1,
      generation: 0,
      name: 'オオトリモナーコス',
      site: '日本',
    });

    await breedConceived(page, 'オオトリモナーコス');
    await confirmBirth(page, 'オオトリモナーコス', 1968, '牝');
    const filly = await openFoalRow(page, 'オオトリモナーコス1969');
    const namedFilly = await nameFoal(page, filly, 'テストムスメ');
    const convert = namedFilly.getByRole('form', { name: '轉入為繁殖牝馬' });
    await convert.getByLabel('轉入據點').selectOption({ label: '日本' });
    await convert.getByRole('button', { name: '轉入母馬群' }).click();
    await expect(convert.getByRole('status')).toContainText('該代已成立');

    // 賣掉第 1 系 1 代唯一的自家母馬：已成立但母馬群降為 0。
    await gotoPage(page, '母馬群');
    const region = herd(page);
    await region
      .getByRole('article', { name: 'テストムスメ' })
      .getByRole('button', { name: '賣出' })
      .click();
    await page
      .getByRole('alertdialog', { name: '賣出繁殖牝馬' })
      .getByRole('button', { name: '確認賣出' })
      .click();
    await expect(region.getByRole('status')).toContainText('已賣出');

    await gotoPage(page, '總覽');
    await expect(
      page.getByTestId('overview-line-1').getByTestId('line-needs-replenish'),
    ).toHaveText('已成立，母馬群待補');
    await expect(page.getByRole('list', { name: '提醒' })).toContainText('母馬群待補');

    // 系統只列出三個選擇，不代選（LINE-19）。
    const choices = page.getByRole('list', { name: '第 1 系的處理選擇' });
    await expect(choices.getByRole('listitem')).toHaveCount(3);
    await expect(choices).toContainText('原階段重試');
    await expect(choices).toContainText('市場補血');
    await expect(choices).toContainText('宣告斷血並補系');

    const declare = page.getByRole('form', { name: '宣告第 1 系斷血' });
    await declare.getByLabel('原因').fill('母馬群全部離圈');
    await declare.getByRole('button', { name: '宣告斷血' }).click();
    await expect(page.getByTestId('recovery-active')).toContainText('補系進行中');
    await expect(page.getByTestId('recovery-active')).toContainText('補系將產出 2 代');

    // 補系進行中暫停建立新系（LINE-21）。
    await expect(board(page)).toContainText('斷血補系進行中');

    await page.getByTestId('recovery-active').getByRole('button', { name: '取消補系' }).click();
    await expect(page.getByTestId('recovery-feedback').getByRole('status')).toContainText(
      '已取消第 1 系的補系',
    );
    await expect(board(page)).not.toContainText('斷血補系進行中');
  });

  test('[UI-03][UI-06] 年度工作清單可人工更正；母馬、對照表待補與備份的提醒集中在提醒區', async ({
    page,
  }) => {
    await openApp(page);
    await createGameViaUi(page, '提醒局', 1968);
    await gotoPage(page, '母馬群');
    // 1968 年 24 歲：定年 25 的前一年，也達高齡提醒年齡 18。
    await addMareViaUi(page, {
      position: 1,
      generation: 0,
      name: 'テストヒンバ',
      site: '日本',
      birthYear: 1944,
      sireSubsystem: 'ネアルコ',
    });
    await expect(herd(page)).toContainText('テストヒンバ');

    await gotoPage(page, '總覽');
    const reminders = page.getByTestId('reminders');
    await expect(reminders).toContainText('母馬「テストヒンバ」（24 歲）：最後值得配種的年齡');
    await expect(reminders).toContainText('系統對照表待補：ネアルコ');
    await expect(reminders).toContainText('這一局還沒有匯出過備份');

    const jan = page.getByTestId('annual-work-jan2yo');
    await expect(jan).toContainText('未完成');
    await jan.getByRole('button', { name: '標示為已完成' }).click();
    await expect(jan).toContainText('已完成（人工更正）');
    await jan.getByRole('button', { name: '標示為未完成' }).click();
    await expect(jan).toContainText('未完成');
    await expect(jan).not.toContainText('人工更正');
  });
});
