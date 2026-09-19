import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { addMareViaUi, createGameViaUi, gotoPage, openApp, openFirstLineViaUi } from './helpers.ts';

function herd(page: Page) {
  return page.getByRole('region', { name: '繁殖牝馬群' });
}

test.describe('母馬群', () => {
  test('[LINE-07][MARE-01][UI-01][MARE-18] 只有第 1 系時新增起點與替代母馬，卡片顯示用途、代數與各欄位', async ({
    page,
  }) => {
    await openApp(page);
    await createGameViaUi(page, '母馬局', 1968);
    await openFirstLineViaUi(page);
    await gotoPage(page, '母馬群');
    const region = herd(page);
    await expect(region.getByText('沒有符合條件的母馬。')).toBeVisible();

    await addMareViaUi(page, {
      position: 1,
      generation: 0,
      name: 'テストヒンバ',
      site: '日本',
      birthYear: 1958,
      sireSubsystem: 'マンノウォー',
    });
    await expect(region.getByRole('status')).toContainText('已新增「テストヒンバ」為第 1 系起點用');
    await expect(region.getByTestId('mare-group-title')).toHaveText(
      '第 1 系起點母馬群：在圈 1／目標 5',
    );
    const starter = region.getByRole('article', { name: 'テストヒンバ' });
    await expect(starter.getByTestId('mare-usage')).toHaveText('第 1 系起點用');
    await expect(starter.getByTestId('mare-generation')).toHaveText('零代');
    await expect(starter).toContainText('マンノウォー');
    await expect(starter.getByTestId('mare-site')).toHaveText('日本');
    await expect(starter).toContainText('10 歲');
    await expect(starter.getByTestId('mare-vitality')).toHaveText('待更新');
    await expect(starter).toContainText('未登記');
    await expect(starter.getByTestId('mare-plan')).toHaveText('待定');
    await expect(starter.getByTestId('mare-status')).toHaveText('生產中・市場創系');
    await expect(starter.getByRole('button', { name: '賣出' })).toBeVisible();
    await expect(starter.getByRole('button', { name: '退役' })).toHaveCount(0);

    await addMareViaUi(page, {
      position: 2,
      generation: 1,
      name: 'テストカワリ',
      site: '分場（俱樂部牧場）',
    });
    await expect(region.getByRole('status')).toContainText(
      '提示：自身父系未填，無法判斷是否屬於第 2 系',
    );
    await expect(region.getByTestId('mare-group-title')).toHaveText(
      '第 2 系 1 代母馬群：在圈 1／目標 5',
    );
    const substitute = region.getByRole('article', { name: 'テストカワリ' });
    await expect(substitute.getByTestId('mare-usage')).toHaveText('替代第 2 系 1 代');
    await expect(substitute.getByTestId('mare-generation')).toHaveText('零代');
    await expect(substitute.getByTestId('mare-site')).toHaveText('分場（俱樂部牧場）');
    await expect(region.getByRole('article', { name: 'テストヒンバ' })).toHaveCount(0);
    await expect(page.getByTestId('status-records')).toHaveText('16 筆');

    await page.reload();
    await gotoPage(page, '母馬群');
    await expect(herd(page).getByTestId('mare-group-title')).toHaveText(
      '第 1 系起點母馬群：在圈 1／目標 5',
    );
  });

  test('[LINE-29] 替代母馬的自身父系與該系親系統不同時，確認後才新增', async ({ page }) => {
    await openApp(page);
    await createGameViaUi(page, '替代局', 1968);
    await openFirstLineViaUi(page);
    await gotoPage(page, '系統對照表');
    const mapForm = page.getByRole('form', { name: '新增或更新對照' });
    await mapForm.getByLabel('子系統', { exact: true }).fill('マンノウォー');
    await mapForm.getByLabel('親系統', { exact: true }).fill('マッチェム');
    await mapForm.getByRole('button', { name: '保存對照' }).click();
    await expect(page.getByRole('table', { name: '系統對照表', exact: true })).toContainText(
      'マッチェム',
    );

    await gotoPage(page, '母馬群');
    const region = herd(page);
    await addMareViaUi(page, {
      position: 1,
      generation: 2,
      name: 'テストコンケツ',
      site: '日本',
      sireSubsystem: 'マンノウォー',
    });
    const dialog = page.getByRole('dialog', { name: '確認新增替代母馬' });
    await expect(dialog).toContainText('與第 1 系目前的親系統「ネアルコ」不同');
    await dialog.getByRole('button', { name: '取消' }).click();
    await expect(region.getByRole('article', { name: 'テストコンケツ' })).toHaveCount(0);

    await region
      .getByRole('form', { name: '手動新增母馬' })
      .getByRole('button', { name: '新增母馬' })
      .click();
    await dialog.getByRole('button', { name: '確認並新增' }).click();
    await expect(region.getByTestId('mare-group-title')).toHaveText(
      '第 1 系 2 代母馬群：在圈 1／目標 5',
    );
    const card = region.getByRole('article', { name: 'テストコンケツ' });
    await expect(card.getByTestId('mare-usage')).toHaveText('替代第 1 系 2 代');
    await expect(card.getByTestId('mare-status')).toHaveText('生產中・市場補血');
  });

  test('[UI-07][MARE-08][MARE-20] 篩選以交集套用；賣出後離開母馬群，已離圈篩選仍查得到且來源不變', async ({
    page,
  }) => {
    await openApp(page);
    await createGameViaUi(page, '篩選局', 1968);
    await gotoPage(page, '母馬群');
    const region = herd(page);
    await addMareViaUi(page, { position: 1, generation: 0, name: 'テストアルファ', site: '日本' });
    await addMareViaUi(page, {
      position: 1,
      generation: 0,
      name: 'テストブラボー',
      site: '美國',
      origin: '所屬競走馬引退轉入',
    });
    await addMareViaUi(page, {
      position: 2,
      generation: 1,
      name: 'テストチャーリー',
      site: '美國',
    });
    await expect(region.getByRole('article', { name: 'テストチャーリー' })).toBeVisible();

    await region.getByLabel('系', { exact: true }).selectOption({ label: '第 1 系' });
    await expect(region.getByTestId('mare-group-title')).toHaveText(
      '第 1 系起點母馬群：在圈 2／目標 5',
    );
    const filters = region.getByRole('group', { name: '篩選' });
    await filters.getByLabel('據點').selectOption({ label: '美國' });
    await expect(region.getByRole('article')).toHaveCount(1);
    await expect(region.getByRole('article', { name: 'テストブラボー' })).toBeVisible();
    await filters.getByLabel('關鍵字（馬名）').fill('アルファ');
    await expect(region.getByRole('article')).toHaveCount(0);
    await expect(region.getByText('沒有符合條件的母馬。')).toBeVisible();
    await filters.getByRole('button', { name: '清除篩選' }).click();
    await expect(region.getByRole('article')).toHaveCount(2);

    const bravo = region.getByRole('article', { name: 'テストブラボー' });
    await expect(bravo.getByTestId('mare-status')).toHaveText('生產中・所屬競走馬引退轉入');
    await bravo.getByRole('button', { name: '賣出' }).click();
    const dialog = page.getByRole('alertdialog', { name: '賣出繁殖牝馬' });
    await expect(dialog).toContainText('生產中 2 → 1 匹');
    await dialog.getByRole('button', { name: '確認賣出' }).click();
    await expect(region.getByRole('status')).toContainText('已賣出「テストブラボー」');
    await expect(bravo).toHaveCount(0);
    await expect(region.getByTestId('mare-group-title')).toHaveText(
      '第 1 系起點母馬群：在圈 1／目標 5',
    );

    await filters.getByLabel('狀態').selectOption({ label: '已離圈' });
    await expect(bravo.getByTestId('mare-status')).toHaveText('已離圈（售出）・所屬競走馬引退轉入');
    await expect(bravo.getByTestId('mare-vitality')).toHaveText('不適用');
    await expect(bravo.getByRole('button', { name: '賣出' })).toHaveCount(0);
  });

  test('[MARE-25] 高齡提醒依設定的提醒年齡判斷', async ({ page }) => {
    await openApp(page);
    await createGameViaUi(page, '高齡局', 1968);
    await gotoPage(page, '母馬群');
    await addMareViaUi(page, {
      position: 1,
      generation: 0,
      name: 'テストロウバ',
      site: '日本',
      birthYear: 1950,
    });
    const card = herd(page).getByRole('article', { name: 'テストロウバ' });
    await expect(card).toContainText('產駒素質可能下降，可考慮出售');

    await gotoPage(page, '資料管理');
    const form = page.getByRole('form', { name: '遊戲局設定' });
    await form.getByLabel('高齡提醒年齡').fill('19');
    await form.getByLabel('高齡提醒年齡').blur();
    await form.getByRole('button', { name: '保存設定' }).click();
    await expect(form.getByRole('status')).toHaveText('已保存設定');

    await gotoPage(page, '母馬群');
    await expect(herd(page).getByRole('article', { name: 'テストロウバ' })).not.toContainText(
      '產駒素質可能下降',
    );
  });
});
