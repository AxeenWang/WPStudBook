import { expect, test, type Locator, type Page } from '@playwright/test';
import { addMareViaUi, closeDrawer, createGameViaUi, gotoPage, openApp } from './helpers.ts';

function herd(page: Page) {
  return page.getByRole('region', { name: '繁殖牝馬群' });
}

async function setupMare(page: Page, gameName: string): Promise<void> {
  await openApp(page);
  await createGameViaUi(page, gameName, 1968);
  await gotoPage(page, '母馬群');
  await addMareViaUi(page, { position: 1, generation: 0, name: 'テストヒンバ', site: '日本' });
  await expect(herd(page).getByRole('article', { name: 'テストヒンバ' })).toBeVisible();
}

async function fillNumber(form: Locator, label: string, value: string): Promise<void> {
  const input = form.getByLabel(label, { exact: true });
  await input.fill(value);
  await input.blur();
}

test.describe('母馬詳情欄', () => {
  test('[UI-02] 點卡片開啟右側藍色詳情欄（五個頁籤）；點欄外、X、Esc 關閉並回到原卡片，保留最後查看的頁籤', async ({
    page,
  }) => {
    await setupMare(page, '詳情局');
    const card = herd(page).getByRole('article', { name: 'テストヒンバ' });
    const nameButton = card.getByRole('button', { name: 'テストヒンバ' });
    const drawer = page.getByRole('dialog', { name: '「テストヒンバ」詳情' });

    await card.getByTestId('mare-site').click();
    await expect(drawer).toBeVisible();
    await expect(page.locator('.drawer')).toHaveCSS('border-left-color', 'rgb(21, 101, 192)');
    await expect(drawer.getByRole('tab')).toHaveText(['概要', '配種', '產駒', '血緣', '歷程']);
    await expect(drawer.getByRole('tab', { name: '概要' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(drawer.getByRole('tabpanel')).toContainText('自身父系');

    await drawer.getByRole('tab', { name: '歷程' }).click();
    await expect(drawer.getByRole('tabpanel')).toContainText('加入母馬群');
    await closeDrawer(page, drawer);
    await expect(nameButton).toBeFocused();

    await nameButton.click();
    await expect(drawer.getByRole('tab', { name: '歷程' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await drawer.getByRole('button', { name: '關閉' }).click();
    await expect(drawer).toBeHidden();
    await expect(nameButton).toBeFocused();

    await nameButton.press('Enter');
    await expect(drawer).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(drawer).toBeHidden();
    await expect(nameButton).toBeFocused();
  });

  test('[MARE-19][MARE-13][MARE-17][MARE-22] 在詳情欄轉場、登記年度資料與設定今年計畫，卡片與篩選隨之更新', async ({
    page,
  }) => {
    await setupMare(page, '操作局');
    const region = herd(page);
    const card = region.getByRole('article', { name: 'テストヒンバ' });
    const nameButton = card.getByRole('button', { name: 'テストヒンバ' });
    const drawer = page.getByRole('dialog', { name: '「テストヒンバ」詳情' });
    await expect(card.getByTestId('mare-kodashi')).toHaveText('未取得');

    await nameButton.click();
    const transfer = drawer.getByRole('form', { name: '轉場' });
    await transfer.getByLabel('新據點').selectOption({ label: '美國' });
    await fillNumber(transfer, '月', '5');
    await fillNumber(transfer, '週', '1');
    await transfer.getByRole('button', { name: '執行轉場' }).click();
    await expect(transfer.getByRole('status')).toHaveText('已轉場到美國');
    await expect(drawer.getByTestId('detail-site')).toHaveText('美國');

    const yearly = drawer.getByRole('form', { name: '今年年度資料' });
    await fillNumber(yearly, '5 月活力', '73');
    await fillNumber(yearly, '仔出（0～15）', '0');
    await yearly.getByRole('button', { name: '保存年度資料' }).click();
    await expect(yearly.getByRole('status')).toHaveText('已保存年度資料');
    await expect(drawer.getByRole('table', { name: '年度資料（新到舊）' })).toContainText('73');

    const plan = drawer.getByRole('form', { name: '今年計畫' });
    await plan.getByLabel('計畫', { exact: true }).selectOption({ label: '輪休' });
    await plan.getByRole('button', { name: '保存計畫' }).click();
    await expect(plan.getByRole('status')).toHaveText('已設定今年計畫為「輪休」');

    await drawer.getByRole('tab', { name: '歷程' }).click();
    await expect(drawer.getByRole('tabpanel')).toContainText(
      '1968 年 5 月 1 週：轉場（日本 → 美國）',
    );
    await expect(drawer.getByRole('tabpanel')).toContainText('1968 年：更正年度資料');
    await drawer.getByRole('tab', { name: '概要' }).click();
    await closeDrawer(page, drawer);

    await expect(card.getByTestId('mare-site')).toHaveText('美國');
    await expect(card.getByTestId('mare-vitality')).toHaveText('73（5 月）');
    await expect(card.getByRole('meter', { name: '活力' })).toHaveAttribute('value', '73');
    await expect(card.getByTestId('mare-kodashi')).toHaveText('0（1968 年）');
    await expect(card.getByTestId('mare-plan')).toHaveText('輪休');

    for (const [july, expected] of [
      ['0', '0（7 月）'],
      ['100', '100（7 月）'],
    ] as const) {
      await nameButton.click();
      await fillNumber(drawer.getByRole('form', { name: '今年年度資料' }), '7 月活力', july);
      await drawer.getByRole('button', { name: '保存年度資料' }).click();
      await expect(
        drawer.getByRole('form', { name: '今年年度資料' }).getByRole('status'),
      ).toHaveText('已保存年度資料');
      await closeDrawer(page, drawer);
      await expect(card.getByTestId('mare-vitality')).toHaveText(expected);
    }

    await nameButton.click();
    const clearing = drawer.getByRole('form', { name: '今年年度資料' });
    await fillNumber(clearing, '5 月活力', '');
    await fillNumber(clearing, '7 月活力', '');
    await fillNumber(clearing, '仔出（0～15）', '15');
    await clearing.getByRole('button', { name: '保存年度資料' }).click();
    await expect(clearing.getByRole('status')).toHaveText('已保存年度資料');
    const yearlyTable = drawer.getByRole('table', { name: '年度資料（新到舊）' });
    await expect(yearlyTable.getByRole('row', { name: /1968 年/ })).toContainText('15CE 擴充值');
    await closeDrawer(page, drawer);
    await expect(card.getByTestId('mare-vitality')).toHaveText('待更新');
    await expect(card.getByTestId('mare-kodashi')).toHaveText('15（1968 年）CE 擴充值');

    const filters = region.getByRole('group', { name: '篩選' });
    await filters.getByLabel('今年計畫').selectOption({ label: '輪休' });
    await expect(card).toBeVisible();
    await filters.getByLabel('今年計畫').selectOption({ label: '八系指定配種' });
    await expect(region.getByRole('article')).toHaveCount(0);
  });
});
