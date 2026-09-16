import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  addMareViaUi,
  changeYearViaUi,
  createGameViaUi,
  gotoPage,
  openApp,
  openFirstLineViaUi,
} from './helpers.ts';

function herd(page: Page) {
  return page.getByRole('region', { name: '繁殖牝馬群' });
}

function drawerOf(page: Page, name: string) {
  return page.getByRole('dialog', { name: `「${name}」詳情` });
}

async function fillNumber(scope: Locator, label: string, value: string): Promise<void> {
  const input = scope.getByLabel(label, { exact: true });
  await input.fill(value);
  await input.blur();
}

async function openDrawer(page: Page, name: string): Promise<Locator> {
  await herd(page)
    .getByRole('article', { name })
    .getByRole('button', { name, exact: true })
    .click();
  const drawer = drawerOf(page, name);
  await expect(drawer).toBeVisible();
  return drawer;
}

async function changeYear(page: Page, year: number): Promise<void> {
  await gotoPage(page, '資料管理');
  await changeYearViaUi(page, year);
  await gotoPage(page, '母馬群');
}

/** 1968 年開局，第 1 系零代種牡馬與一匹起點母馬。 */
async function setup(page: Page, gameName: string): Promise<void> {
  await openApp(page);
  await createGameViaUi(page, gameName, 1968);
  await openFirstLineViaUi(page);
  await gotoPage(page, '母馬群');
  await addMareViaUi(page, {
    position: 1,
    generation: 0,
    name: 'オオトリモナーコス',
    site: '日本',
  });
  await expect(herd(page).getByRole('article', { name: 'オオトリモナーコス' })).toBeVisible();
}

async function saveBreeding(drawer: Locator, conception: string, stallion?: string) {
  await drawer.getByRole('tab', { name: '配種' }).click();
  const form = drawer.getByRole('form', { name: '登記繁殖紀錄' });
  if (stallion !== undefined) {
    await form.getByLabel('種牡馬', { exact: true }).selectOption({ label: stallion });
  }
  await form.getByLabel('受胎狀態').selectOption({ label: conception });
  await form.getByRole('button', { name: '保存繁殖紀錄' }).click();
  await expect(form.getByRole('status')).toContainText('繁殖紀錄');
}

test.describe('配種與產駒', () => {
  test('[BRD-01][BRD-04][LINE-08] 受胎後顯示隔年 4 月 1 週預定出生，確認出生才建立產駒與追蹤名；時間軸區分輪空與未登記', async ({
    page,
  }) => {
    await setup(page, '配種局');
    let drawer = await openDrawer(page, 'オオトリモナーコス');
    await drawer.getByRole('tab', { name: '產駒' }).click();
    await expect(drawer.getByRole('tabpanel')).toContainText('尚無產駒紀錄');
    await expect(drawer.getByRole('tabpanel').getByRole('alert')).toHaveCount(0);

    await saveBreeding(drawer, '受胎');
    const row1968 = drawer.getByRole('listitem', { name: '1968 年繁殖紀錄' });
    await expect(row1968).toContainText('八系指定配種・種牡馬 テストシュボバ・受胎');
    await expect(row1968.getByTestId('breeding-expected')).toHaveText('預定 1969 年 4 月 1 週出生');
    await expect(row1968.getByRole('button', { name: '確認出生' })).toHaveCount(0);
    await drawer.getByRole('tab', { name: '產駒' }).click();
    await expect(drawer.getByRole('list', { name: '產駒時間軸' })).toContainText(
      '1969 年預定 1969 年 4 月 1 週出生',
    );
    await page.keyboard.press('Escape');

    await changeYear(page, 1969);
    drawer = await openDrawer(page, 'オオトリモナーコス');
    await drawer.getByRole('tab', { name: '配種' }).click();
    await drawer
      .getByRole('listitem', { name: '1968 年繁殖紀錄' })
      .getByRole('button', { name: '確認出生' })
      .click();
    const foalForm = drawer.getByRole('form', { name: '登記產駒' });
    await foalForm.getByLabel('性別').selectOption({ label: '牝' });
    await foalForm.getByRole('button', { name: '登記產駒' }).click();
    await expect(drawer.getByRole('status').first()).toHaveText(
      '已登記產駒「オオトリモナーコス1969」',
    );
    await expect(
      drawer.getByRole('listitem', { name: '1968 年繁殖紀錄' }).getByTestId('breeding-expected'),
    ).toHaveText('1969 年出生：オオトリモナーコス1969');

    await saveBreeding(drawer, '空胎', '不選（空胎）');
    await page.keyboard.press('Escape');
    await changeYear(page, 1971);
    drawer = await openDrawer(page, 'オオトリモナーコス');
    await drawer.getByRole('tab', { name: '產駒' }).click();
    const timeline = drawer.getByRole('list', { name: '產駒時間軸' });
    const items = timeline.locator(':scope > li');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText('1971 年未登記繁殖紀錄');
    await expect(items.nth(1)).toContainText('1970 年輪空（空胎）');
    const foal = items.nth(2).getByRole('article', { name: 'オオトリモナーコス1969' });
    await expect(foal).toContainText('第 1 系 1 代');
    await expect(foal.getByRole('img', { name: '牝' })).toBeVisible();

    await drawer.getByRole('tab', { name: '配種' }).click();
    const form = drawer.getByRole('form', { name: '登記繁殖紀錄' });
    const selected = (label: string) =>
      form.getByLabel(label, { exact: true }).locator('option:checked');
    await expect(selected('受胎狀態')).toHaveText('未登記');
    await fillNumber(form, '配種年', '1969');
    await expect(selected('受胎狀態')).toHaveText('空胎');
    await expect(selected('種牡馬')).toHaveText('不選（空胎）');
    await fillNumber(form, '配種年', '1968');
    await expect(selected('受胎狀態')).toHaveText('受胎');
    await expect(selected('種牡馬')).toHaveText('テストシュボバ（第 1 系 0 代）');
  });

  test('[LINE-17][MARE-03][MARE-23][BRD-08][BRD-13] 補名與轉入：暫定保留轉入後該代成立，交接中同時顯示母女，母親卡片提示可出售', async ({
    page,
  }) => {
    await setup(page, '轉入局');
    let drawer = await openDrawer(page, 'オオトリモナーコス');
    await saveBreeding(drawer, '受胎');
    await page.keyboard.press('Escape');
    await changeYear(page, 1969);
    drawer = await openDrawer(page, 'オオトリモナーコス');
    await drawer.getByRole('tab', { name: '產駒' }).click();
    await drawer
      .getByRole('list', { name: '產駒時間軸' })
      .getByRole('button', { name: '確認出生' })
      .click();
    const foalForm = drawer.getByRole('form', { name: '登記產駒' });
    await foalForm.getByLabel('性別').selectOption({ label: '牝' });
    await fillNumber(foalForm, 'SP', '72');
    await foalForm.getByLabel('芝適性').selectOption({ label: '◎' });
    await foalForm.getByLabel('ダート適性').selectOption({ label: '△' });
    await foalForm.getByRole('button', { name: '登記產駒' }).click();

    const foal = drawer.getByRole('article', { name: 'オオトリモナーコス1969' });
    await expect(foal.getByTestId('foal-abilities')).toHaveText('SP 72・芝 ◎・ダ △（芝型）');
    await foal.getByRole('button', { name: '管理' }).click();
    const nameForm = foal.getByRole('form', { name: '正式馬名' });
    await nameForm.getByLabel('正式馬名').fill('オオトリヒメ');
    await nameForm.getByRole('button', { name: '保存馬名' }).click();
    // 補名後產駒卡的名稱就會換成正式馬名，所以改以新名稱定位，不能沿用原本的卡片。
    const named = drawer.getByRole('article', { name: 'オオトリヒメ' });
    await expect(named.getByRole('form', { name: '正式馬名' }).getByRole('status')).toHaveText(
      '已登記正式馬名「オオトリヒメ」',
    );
    await expect(named).toContainText('追蹤名：オオトリモナーコス1969');
    await expect(named.getByTestId('foal-abilities')).toHaveText('SP 72・芝 ◎・ダ △（芝型）');

    const convert = named.getByRole('form', { name: '轉入為繁殖牝馬' });
    await convert.getByLabel('轉入據點').selectOption({ label: '日本' });
    await convert.getByRole('button', { name: '轉入母馬群' }).click();
    await expect(convert.getByRole('status')).toHaveText(
      '已轉入為第 1 系 1 代母馬（暫定保留），該代已成立',
    );
    await expect(named.getByRole('form', { name: '正式馬名' })).toHaveCount(0);
    await expect(named).toContainText('已轉入母馬群，繁殖牝馬馬名唯讀。');
    await page.keyboard.press('Escape');

    const region = herd(page);
    const mother = region.getByRole('article', { name: 'オオトリモナーコス' });
    const generations = region.getByRole('group', { name: '代數' });
    await expect(region.getByTestId('mare-group-title')).toHaveText(
      '第 1 系 1 代母馬群：在圈 1／目標 5',
    );
    await generations.getByRole('button', { name: '交接中' }).click();
    await expect(region.getByTestId('mare-group-title')).toHaveText('第 1 系交接中（起點 → 1 代）');
    await expect(region.getByRole('article')).toHaveCount(2);
    await expect(mother.getByTestId('mare-sell-mother')).toHaveText(
      '女兒已轉入且今年已生產，可考慮出售',
    );
    const daughter = region.getByRole('article', { name: 'オオトリヒメ' });
    await expect(daughter.getByTestId('mare-succession')).toHaveText('暫定保留');
    await expect(daughter.getByTestId('mare-usage')).toHaveText('第 1 系 1 代');

    await generations.getByRole('button', { name: /^1 代/ }).click();
    await expect(generations.getByRole('button', { name: /^1 代/ })).toHaveText(
      '1 代（生產中 1・待接替 1・已離圈 0）',
    );
    await expect(region.getByRole('article')).toHaveCount(1);
    await expect(daughter).toBeVisible();
    await generations.getByRole('button', { name: /^起點/ }).click();
    await expect(region.getByRole('article')).toHaveCount(1);
    await expect(mother).toBeVisible();

    await gotoPage(page, '八系');
    await expect(page.getByTestId('line-slot-1')).toBeVisible();
  });

  test('[BRD-21][BRD-12][UI-04] 產駒密集清單以藍色方形與洋紅色圓形區分牡牝並提供文字；SP 依高低、ST 依數值排序；390 像素寬沒有水平捲動', async ({
    page,
  }) => {
    await setup(page, '清單局');
    await addMareViaUi(page, { position: 1, generation: 0, name: 'ベツノヒンバ', site: '日本' });
    await expect(herd(page).getByRole('article', { name: 'ベツノヒンバ' })).toBeVisible();

    for (const [dam, sex, sp, st] of [
      ['オオトリモナーコス', '牡', '80', '30'],
      ['ベツノヒンバ', '牝', '60', '70'],
    ] as const) {
      const drawer = await openDrawer(page, dam);
      await drawer.getByRole('tab', { name: '產駒' }).click();
      await drawer.getByRole('button', { name: '手動登記產駒' }).click();
      const form = drawer.getByRole('form', { name: '登記產駒' });
      await form.getByLabel('性別').selectOption({ label: sex });
      await form.getByLabel('父馬名（沒有受胎紀錄時填寫，選填）').fill('ソトノチチ');
      await fillNumber(form, 'SP', sp);
      await fillNumber(form, 'ST', st);
      await form.getByRole('button', { name: '登記產駒' }).click();
      const confirm = page.getByRole('dialog', { name: '確認登記產駒' });
      await expect(confirm).toContainText('1967 年沒有繁殖紀錄');
      await confirm.getByRole('button', { name: '確認並登記' }).click();
      await expect(drawer.getByRole('status').first()).toHaveText(`已登記產駒「${dam}1968」`);
      await expect(drawer.getByRole('article', { name: `${dam}1968` })).toContainText('自由配種');
      await page.keyboard.press('Escape');
    }

    await gotoPage(page, '產駒');
    const section = page.getByRole('region', { name: '產駒' });
    const rows = section.getByRole('list', { name: '產駒清單' }).getByRole('listitem');
    await expect(rows).toHaveCount(2);
    const colt = section.getByRole('listitem', { name: 'オオトリモナーコス1968' });
    const filly = section.getByRole('listitem', { name: 'ベツノヒンバ1968' });
    const coltMarker = colt.getByRole('img', { name: '牡' });
    const fillyMarker = filly.getByRole('img', { name: '牝' });
    await expect(coltMarker).toHaveCSS('color', 'rgb(21, 101, 192)');
    await expect(coltMarker).toHaveText('■');
    await expect(fillyMarker).toHaveCSS('color', 'rgb(194, 24, 91)');
    await expect(fillyMarker).toHaveText('●');
    await expect(colt).toContainText('待售');

    const sort = section.getByLabel('排序');
    await expect(sort.locator('option')).toHaveText([
      '出生年（新到舊）',
      'SP（高到低）',
      'ST 數值（小到大）',
      'ST 數值（大到小）',
    ]);
    await sort.selectOption({ label: 'SP（高到低）' });
    await expect(rows.getByTestId('foal-sp')).toHaveText(['SP 80', 'SP 60']);
    await sort.selectOption({ label: 'ST 數值（大到小）' });
    await expect(rows.getByTestId('foal-st')).toHaveText(['ST 70', 'ST 30']);
    await sort.selectOption({ label: 'ST 數值（小到大）' });
    await expect(rows.getByTestId('foal-st')).toHaveText(['ST 30', 'ST 70']);

    await section.getByLabel('關鍵字（馬名、追蹤名）').fill('ベツノ');
    await expect(rows).toHaveCount(1);
    await section.getByLabel('關鍵字（馬名、追蹤名）').fill('');

    const noHorizontalScroll = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(rows).toHaveCount(2);
    expect(await noHorizontalScroll()).toBe(true);
    await colt.getByRole('button', { name: 'オオトリモナーコス1968' }).click();
    await expect(colt.getByRole('form', { name: '正式馬名' })).toBeVisible();
    expect(await noHorizontalScroll()).toBe(true);

    await gotoPage(page, '母馬群');
    await expect(herd(page).getByRole('article')).toHaveCount(2);
    expect(await noHorizontalScroll()).toBe(true);
    const drawer = await openDrawer(page, 'オオトリモナーコス');
    for (const tab of ['概要', '配種', '產駒']) {
      await drawer.getByRole('tab', { name: tab }).click();
      await expect(drawer.getByRole('tabpanel')).toBeVisible();
      const fits = await page
        .locator('.drawer')
        .evaluate((element) => element.scrollWidth <= element.clientWidth);
      expect(fits, tab).toBe(true);
    }
    await expect(drawer.getByRole('article', { name: 'オオトリモナーコス1968' })).toBeVisible();
    expect(await noHorizontalScroll()).toBe(true);
  });
});
