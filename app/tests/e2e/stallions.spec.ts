import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  addMareViaUi,
  changeYearViaUi,
  closeDrawer,
  createGameViaUi,
  gotoPage,
  openApp,
  openFirstLineViaUi,
} from './helpers.ts';

function herd(page: Page) {
  return page.getByRole('region', { name: '繁殖牝馬群' });
}

async function openDrawer(page: Page, name: string): Promise<Locator> {
  await gotoPage(page, '母馬群');
  await herd(page)
    .getByRole('article', { name })
    .getByRole('button', { name, exact: true })
    .click();
  const drawer = page.getByRole('dialog', { name: `「${name}」詳情` });
  await expect(drawer).toBeVisible();
  return drawer;
}

async function breedConceived(page: Page, mareName: string): Promise<void> {
  const drawer = await openDrawer(page, mareName);
  await drawer.getByRole('tab', { name: '配種' }).click();
  const form = drawer.getByRole('form', { name: '登記繁殖紀錄' });
  await form.getByLabel('受胎狀態').selectOption({ label: '受胎' });
  await form.getByRole('button', { name: '保存繁殖紀錄' }).click();
  await expect(form.getByRole('status')).toContainText('繁殖紀錄');
  await closeDrawer(page, drawer);
}

async function confirmColt(page: Page, mareName: string, breedingYear: number): Promise<void> {
  const drawer = await openDrawer(page, mareName);
  await drawer.getByRole('tab', { name: '配種' }).click();
  await drawer
    .getByRole('listitem', { name: `${String(breedingYear)} 年繁殖紀錄` })
    .getByRole('button', { name: '確認出生' })
    .click();
  const foalForm = drawer.getByRole('form', { name: '登記產駒' });
  await foalForm.getByLabel('性別').selectOption({ label: '牡' });
  await foalForm.getByRole('button', { name: '登記產駒' }).click();
  await expect(drawer.getByRole('status').first()).toContainText('已登記產駒');
  await closeDrawer(page, drawer);
}

async function changeYear(page: Page, year: number): Promise<void> {
  await gotoPage(page, '資料管理');
  await changeYearViaUi(page, year);
}

async function foalPanel(page: Page, name: string): Promise<Locator> {
  await gotoPage(page, '產駒');
  const row = page.getByRole('list', { name: '產駒清單' }).getByRole('listitem', { name });
  await row.getByRole('button', { name, exact: true }).click();
  return row;
}

function stallionCard(page: Page) {
  return page.getByRole('article', { name: '第 1 系種牡馬' });
}

test.describe('種牡馬', () => {
  test('[LINE-22][LINE-30][LINE-32] 同父異母弟弟取代哥哥擔任現任；兄弟並排比較不標示優劣，由使用者選回哥哥', async ({
    page,
  }) => {
    await openApp(page);
    await createGameViaUi(page, '種牡馬局', 1968);
    await openFirstLineViaUi(page);
    await gotoPage(page, '母馬群');
    for (const name of ['オオトリモナーコス', 'テストヒンバ']) {
      await addMareViaUi(page, { position: 1, generation: 0, name, site: '日本' });
      await expect(herd(page).getByRole('article', { name })).toBeVisible();
    }
    await breedConceived(page, 'オオトリモナーコス');
    await changeYear(page, 1969);
    await confirmColt(page, 'オオトリモナーコス', 1968);
    await breedConceived(page, 'テストヒンバ');
    await changeYear(page, 1970);
    await confirmColt(page, 'テストヒンバ', 1969);

    const elder = await foalPanel(page, 'オオトリモナーコス1969');
    const assign = elder.getByRole('form', { name: '接任現任' });
    await assign.getByRole('button', { name: '接任現任' }).click();
    await expect(elder.getByRole('region', { name: '種牡馬' }).getByRole('status')).toHaveText(
      '已接任第 1 系 1 代現任',
    );
    await expect(assign).toHaveCount(0);
    await expect(elder.getByTestId('horse-stallion-status')).toHaveText(
      '已成為種牡馬・第 1 系 1 代現任（在崗）',
    );
    await expect(elder.getByText('已成為種牡馬，種牡馬馬名唯讀。')).toBeVisible();
    const younger = page
      .getByRole('list', { name: '產駒清單' })
      .getByRole('listitem', { name: 'テストヒンバ1970' });
    await younger.getByRole('button', { name: 'テストヒンバ1970', exact: true }).click();
    const register = younger.getByRole('form', { name: '登記成為種牡馬' });
    await register.getByLabel('種牡馬馬番号（選填，例如 0x0000）').fill('0x0102');
    await register.getByRole('button', { name: '登記成為種牡馬' }).click();
    await expect(younger.getByRole('region', { name: '種牡馬' }).getByRole('status')).toHaveText(
      '已登記「テストヒンバ1970」成為種牡馬',
    );

    await gotoPage(page, '八系');
    const card = stallionCard(page);
    const elderItem = card.getByRole('listitem', { name: '1 代 オオトリモナーコス1969' });
    await expect(elderItem.getByTestId('current-stallion')).toContainText('在崗・1970 年起');
    await elderItem.getByRole('button', { name: '更換現任' }).click();
    const replace = elderItem.getByRole('form', { name: '更換現任' });
    await replace.getByLabel('後任').selectOption({ label: 'テストヒンバ1970' });
    await replace.getByLabel('更換原因').selectOption({ label: '弟弟較優' });
    await replace.getByRole('button', { name: '確認更換' }).click();
    await expect(replace.getByRole('status')).toHaveText('已更換第 1 系 1 代現任');

    const youngerItem = card.getByRole('listitem', { name: '1 代 テストヒンバ1970' });
    await expect(youngerItem.getByTestId('current-stallion')).toContainText('在崗');
    await expect(elderItem.getByTestId('current-stallion')).toContainText(
      '已被取代・1970 年起～1970 年',
    );
    await expect(elderItem.getByTestId('current-stallion')).toContainText(
      '更換原因 弟弟較優・後任 テストヒンバ1970',
    );
    await expect(card.getByTestId('current-stallion').filter({ hasText: '在崗' })).toHaveCount(2);

    await youngerItem.getByRole('button', { name: '兄弟比較' }).click();
    const comparison = youngerItem.getByRole('region', { name: '兄弟比較' });
    const table = comparison.getByRole('table', {
      name: '第 1 系 1 代・父 テストシュボバ 的種牡馬兄弟',
    });
    await expect(table.getByRole('row')).toHaveCount(3);
    await expect(table.getByRole('row', { name: /オオトリモナーコス1969/ })).toContainText(
      '已被取代',
    );
    await expect(table.getByRole('row', { name: /テストヒンバ1970/ })).toContainText('在崗');
    await expect(table.getByRole('button', { name: '選「テストヒンバ1970」為現任' })).toHaveCount(
      0,
    );
    await expect(comparison).toContainText('不判定優劣');

    await table.getByRole('button', { name: '選「オオトリモナーコス1969」為現任' }).click();
    await expect(comparison.getByRole('status')).toHaveText(
      '已選定「オオトリモナーコス1969」為現任',
    );
    await expect(youngerItem.getByTestId('current-stallion')).toContainText('已被取代');
    const reelected = card
      .getByRole('listitem', { name: '1 代 オオトリモナーコス1969' })
      .getByTestId('current-stallion')
      .filter({ hasText: '在崗' });
    await expect(reelected).toHaveCount(1);
  });

  test('[LINE-26] 現任達種牡馬提醒年齡 → 八系頁顯示準備後繼提醒；調整提醒年齡後提醒消失', async ({
    page,
  }) => {
    await openApp(page);
    await createGameViaUi(page, '提醒局', 1968);
    await gotoPage(page, '總覽');
    const form = page.getByRole('form', { name: '開啟第 1 系' });
    await form.getByLabel('目前子系統').fill('ネアルコ');
    await form.getByLabel('親系統', { exact: true }).fill('ネアルコ');
    await form.getByLabel('零代市場種牡馬馬名').fill('テストシュボバ');
    const birthYear = form.getByLabel('出生年（選填）');
    await birthYear.fill('1942');
    await birthYear.blur();
    await form.getByRole('button', { name: '開啟第 1 系' }).click();
    await expect(page.getByRole('form', { name: '開啟第 1 系' })).toHaveCount(0);

    // 總覽的提醒區與八系頁的種牡馬區都顯示準備後繼提醒（需求規格 13.2）。
    await expect(page.getByRole('list', { name: '提醒' })).toContainText('達到種牡馬提醒年齡');

    await gotoPage(page, '八系');
    const reminders = stallionCard(page).getByRole('list', { name: '提醒' });
    await expect(reminders).toHaveText(
      '第 1 系 0 代現任「テストシュボバ」已 26 歲，達到種牡馬提醒年齡，請準備後繼',
    );

    await gotoPage(page, '資料管理');
    const settings = page.getByRole('form', { name: '遊戲局設定' });
    const age = settings.getByLabel('種牡馬提醒年齡');
    await age.fill('27');
    await age.blur();
    await settings.getByRole('button', { name: '保存設定' }).click();
    await expect(settings.getByRole('status')).toHaveText('已保存設定');
    await gotoPage(page, '八系');
    await expect(stallionCard(page).getByTestId('current-stallion')).toContainText('26 歲');
    await expect(stallionCard(page).getByRole('list', { name: '提醒' })).toHaveCount(0);
  });

  test('[BRD-17][BRD-18] 總合評價選項為 S～D；同年編輯直接更新，跨年舊值可查', async ({ page }) => {
    await openApp(page);
    await createGameViaUi(page, '評價局', 1968);
    await openFirstLineViaUi(page);
    await gotoPage(page, '母馬群');
    await addMareViaUi(page, {
      position: 1,
      generation: 0,
      name: 'オオトリモナーコス',
      site: '日本',
    });
    let drawer = await openDrawer(page, 'オオトリモナーコス');
    await drawer.getByRole('tab', { name: '配種' }).click();
    let form = drawer.getByRole('form', { name: '配種評價' });
    await expect(form.getByLabel('總合評價').locator('option')).toHaveText([
      '未填',
      'S',
      'A',
      'B',
      'C',
      'D',
    ]);
    await form.getByLabel('總合評價').selectOption({ label: 'B' });
    const power = form.getByLabel('爆發力');
    await power.fill('12');
    await power.blur();
    await form.getByRole('button', { name: '保存配種評價' }).click();
    await expect(form.getByRole('status')).toHaveText('已保存 1968 年的配種評價');
    const ratings = drawer.getByRole('list', { name: '配種評價' });
    await expect(ratings.getByRole('listitem')).toHaveText([
      '1968 年・テストシュボバ・總合評價 B・爆發力 12',
    ]);

    await form.getByLabel('總合評價').selectOption({ label: 'A' });
    await form.getByRole('button', { name: '保存配種評價' }).click();
    await expect(ratings.getByRole('listitem')).toHaveText([
      '1968 年・テストシュボバ・總合評價 A・爆發力 12',
    ]);
    await closeDrawer(page, drawer);

    await changeYear(page, 1969);
    drawer = await openDrawer(page, 'オオトリモナーコス');
    await drawer.getByRole('tab', { name: '配種' }).click();
    form = drawer.getByRole('form', { name: '配種評價' });
    await expect(form.getByLabel('爆發力')).toHaveValue('');
    await form.getByLabel('總合評價').selectOption({ label: 'S' });
    await form.getByRole('button', { name: '保存配種評價' }).click();
    await expect(drawer.getByRole('list', { name: '配種評價' }).getByRole('listitem')).toHaveText([
      '1969 年・テストシュボバ・總合評價 S・爆發力 —',
      '1968 年・テストシュボバ・總合評價 A・爆發力 12',
    ]);
  });
});
