import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
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
  await herd(page)
    .getByRole('article', { name })
    .getByRole('button', { name, exact: true })
    .click();
  const drawer = page.getByRole('dialog', { name: `「${name}」詳情` });
  await expect(drawer).toBeVisible();
  return drawer;
}

async function breedConceived(page: Page): Promise<void> {
  await gotoPage(page, '母馬群');
  const drawer = await openDrawer(page, 'オオトリモナーコス');
  await drawer.getByRole('tab', { name: '配種' }).click();
  const form = drawer.getByRole('form', { name: '登記繁殖紀錄' });
  await form.getByLabel('受胎狀態').selectOption({ label: '受胎' });
  await form.getByRole('button', { name: '保存繁殖紀錄' }).click();
  await expect(form.getByRole('status')).toContainText('繁殖紀錄');
  await closeDrawer(drawer);
}

async function confirmBirth(page: Page, breedingYear: number, sex: '牡' | '牝'): Promise<void> {
  await gotoPage(page, '資料管理');
  await changeYearViaUi(page, breedingYear + 1);
  await gotoPage(page, '母馬群');
  const drawer = await openDrawer(page, 'オオトリモナーコス');
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

/** 補登正式馬名；清單列的名稱隨之改變，回傳改名後的列。 */
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

async function expectStudState(page: Page): Promise<void> {
  await gotoPage(page, '八系');
  const current = page
    .getByRole('article', { name: '第 1 系種牡馬' })
    .getByTestId('current-stallion');
  await expect(current).toHaveCount(2);
  await expect(current.nth(0)).toContainText('1 代・テストムスコ・在崗・1970 年起');
  await expect(current.nth(1)).toContainText('0 代・テストシュボバ・在崗・1968 年起');

  await gotoPage(page, '母馬群');
  const region = herd(page);
  await expect(region.getByTestId('mare-group-title')).toHaveText(
    '第 1 系 1 代母馬群：在圈 1／目標 5',
  );
  await expect(region.getByRole('article', { name: 'テストムスメ' })).toBeVisible();

  const colt = await openFoalRow(page, 'テストムスコ');
  await expect(colt.getByTestId('horse-stallion-status')).toHaveText(
    '已成為種牡馬（種牡馬馬番号 0x0201）・第 1 系 1 代現任（在崗）',
  );
  await colt.getByRole('button', { name: '血緣表' }).click();
  const pedigree = colt.getByRole('region', { name: '血緣表' });
  await expect(pedigree.getByRole('listitem', { name: '父：テストシュボバ' })).toBeVisible();
  await expect(
    pedigree.getByRole('listitem', { name: '母：オオトリモナーコス' }).first(),
  ).toContainText('已售出');
}

test.describe('關卡 C：第 1 系生命週期', () => {
  test('[BLD-03][PED-09] 不開 CE 手動走完第 1 系：受胎、產駒、母駒轉入、公駒接任、母馬賣出；JSON.GZ 往返後資料一致，390 像素寬可操作', async ({
    page,
  }, testInfo) => {
    await openApp(page);
    await createGameViaUi(page, '生命週期局', 1968);
    await openFirstLineViaUi(page);
    await gotoPage(page, '母馬群');
    await addMareViaUi(page, {
      position: 1,
      generation: 0,
      name: 'オオトリモナーコス',
      site: '日本',
    });
    await expect(herd(page).getByRole('article', { name: 'オオトリモナーコス' })).toBeVisible();

    await breedConceived(page);
    await confirmBirth(page, 1968, '牝');
    await breedConceived(page);
    await confirmBirth(page, 1969, '牡');

    const filly = await openFoalRow(page, 'オオトリモナーコス1969');
    const namedFilly = await nameFoal(page, filly, 'テストムスメ');
    const convert = namedFilly.getByRole('form', { name: '轉入為繁殖牝馬' });
    await convert.getByLabel('轉入據點').selectOption({ label: '日本' });
    await convert.getByRole('button', { name: '轉入母馬群' }).click();
    await expect(convert.getByRole('status')).toHaveText(
      '已轉入為第 1 系 1 代母馬（暫定保留），該代已成立',
    );

    const colt = await openFoalRow(page, 'オオトリモナーコス1970');
    const namedColt = await nameFoal(page, colt, 'テストムスコ');
    const assign = namedColt.getByRole('form', { name: '接任現任' });
    await assign.getByLabel('種牡馬馬番号（選填，例如 0x0000）').fill('0x0201');
    await assign.getByRole('button', { name: '接任現任' }).click();
    await expect(namedColt.getByRole('region', { name: '種牡馬' }).getByRole('status')).toHaveText(
      '已接任第 1 系 1 代現任',
    );

    await gotoPage(page, '母馬群');
    const region = herd(page);
    await region
      .getByRole('group', { name: '代數' })
      .getByRole('button', { name: /^起點/ })
      .click();
    await region
      .getByRole('article', { name: 'オオトリモナーコス' })
      .getByRole('button', { name: '賣出' })
      .click();
    await page
      .getByRole('alertdialog', { name: '賣出繁殖牝馬' })
      .getByRole('button', { name: '確認賣出' })
      .click();
    await expect(region.getByRole('status')).toContainText('已賣出「オオトリモナーコス」');
    await page.reload();
    await expect(page.getByTestId('status-game')).toHaveText('生命週期局');
    await expectStudState(page);

    await gotoPage(page, '資料管理');
    const backup = page.getByRole('region', { name: '備份與還原' });
    const downloadEvent = page.waitForEvent('download');
    await backup.getByRole('button', { name: '下載備份' }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toMatch(/\.json\.gz$/);
    const savedPath = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(savedPath);
    const chooserEvent = page.waitForEvent('filechooser');
    await backup.getByRole('button', { name: '選擇備份檔' }).click();
    await (await chooserEvent).setFiles(savedPath);
    const dialog = page.getByRole('dialog', { name: '還原備份為新遊戲局' });
    await dialog.getByLabel('新遊戲局名稱').fill('往返局');
    await dialog.getByRole('button', { name: '還原為新遊戲局' }).click();
    await expect(page.getByTestId('status-game')).toHaveText('往返局');
    await expect(page.getByTestId('status-year')).toHaveText('1970 年');

    await page.setViewportSize({ width: 390, height: 844 });
    await expectStudState(page);
    const fitsViewport = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(await fitsViewport(), '產駒').toBe(true);
    for (const name of ['八系', '母馬群', '資料管理']) {
      await gotoPage(page, name);
      expect(await fitsViewport(), name).toBe(true);
    }
    await gotoPage(page, '母馬群');
    const drawer = await openDrawer(page, 'テストムスメ');
    for (const tab of ['配種', '血緣']) {
      await drawer.getByRole('tab', { name: tab }).click();
      await expect(drawer.getByRole('tabpanel')).toBeVisible();
      const fits = await page
        .locator('.drawer')
        .evaluate((element) => element.scrollWidth <= element.clientWidth);
      expect(fits, tab).toBe(true);
    }
    await expect(
      drawer
        .getByRole('region', { name: '血緣表' })
        .getByRole('listitem', { name: '母：オオトリモナーコス' }),
    ).toContainText('已售出');
  });
});
