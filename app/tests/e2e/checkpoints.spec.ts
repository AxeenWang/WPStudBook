import { expect, test } from './fixtures.ts';
import { changeYearViaUi, createGameViaUi, openApp } from './helpers.ts';

test.describe('檢查點與回溯', () => {
  test('[CKPT-02][CKPT-04][CKPT-06] 手動建立加註的檢查點，回溯前自動下載目前備份，回溯後資料與遊戲年回到檢查點', async ({
    page,
  }) => {
    await openApp(page);
    await createGameViaUi(page, '回溯局', 1968);
    const section = page.getByRole('region', { name: '檢查點' });

    await section.getByLabel('檢查點註記').fill('1968 年初');
    await section.getByRole('button', { name: '建立檢查點' }).click();
    const target = section.getByRole('row', { name: /1968 年初/ });
    await expect(target).toBeVisible();
    await expect(page.getByTestId('status-checkpoint')).toContainText('1968 年初');

    await target.getByRole('button', { name: '釘選', exact: true }).click();
    await expect(target.getByRole('button', { name: '取消釘選' })).toBeVisible();

    await changeYearViaUi(page, 1970);
    await section.getByLabel('檢查點註記').fill('1970 年');
    await section.getByRole('button', { name: '建立檢查點' }).click();
    await expect(section.getByRole('row', { name: /1970 年/ })).toBeVisible();

    await target.getByRole('button', { name: '回溯到此' }).click();
    const dialog = page.getByRole('alertdialog', { name: '回溯到檢查點' });
    await expect(dialog).toContainText('1970 年 → 1968 年');
    await expect(dialog).toContainText('事件');
    await expect(dialog).toContainText('將移除的較晚檢查點');

    const downloadEvent = page.waitForEvent('download');
    await dialog.getByRole('button', { name: '下載備份並回溯' }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toMatch(
      /^WPStudBook_回溯局_1970年_\d{8}-\d{6}\.json\.gz$/,
    );

    await expect(page.getByTestId('status-year')).toHaveText('1968 年');
    await expect(page.getByTestId('status-records')).toHaveText('0 筆');
    await expect(section.getByRole('row', { name: /1970 年/ })).toHaveCount(0);
    await expect(target).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('status-year')).toHaveText('1968 年');
  });
});
