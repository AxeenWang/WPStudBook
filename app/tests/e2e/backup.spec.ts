import { expect, test } from './fixtures.ts';
import { changeYearViaUi, createGameViaUi, openApp } from './helpers.ts';

test.describe('備份與還原', () => {
  test('[DATA-07][DATA-02] 下載 JSON.GZ 備份並顯示摘要，還原為新遊戲局後資料一致', async ({
    page,
  }, testInfo) => {
    await openApp(page);
    await createGameViaUi(page, '備份局', 1968);
    await changeYearViaUi(page, 1969);
    await expect(page.getByTestId('status-records')).toHaveText('1 筆');
    const section = page.getByRole('region', { name: '備份與還原' });

    const downloadEvent = page.waitForEvent('download');
    await section.getByRole('button', { name: '下載備份' }).click();
    const download = await downloadEvent;
    const fileName = download.suggestedFilename();
    expect(fileName).toMatch(/^WPStudBook_備份局_1969年_\d{8}-\d{6}\.json\.gz$/);

    const summary = page.getByTestId('export-summary');
    await expect(summary).toContainText(fileName);
    await expect(summary).toContainText('備份局');
    await expect(summary).toContainText('1 筆');
    await expect(summary).toContainText(/程式 \d+\.\d+\.\d+・結構第 1 版/);
    await expect(summary).toContainText('JSON.GZ');
    await expect(page.getByTestId('status-backup')).toContainText(fileName);

    const savedPath = testInfo.outputPath(fileName);
    await download.saveAs(savedPath);
    const chooserEvent = page.waitForEvent('filechooser');
    await section.getByRole('button', { name: '選擇備份檔' }).click();
    await (await chooserEvent).setFiles(savedPath);

    const dialog = page.getByRole('dialog', { name: '還原備份為新遊戲局' });
    await expect(dialog.getByTestId('restore-summary')).toContainText('備份局');
    await dialog.getByLabel('新遊戲局名稱').fill('還原的局');
    await dialog.getByRole('button', { name: '還原為新遊戲局' }).click();

    await expect(page.getByTestId('status-game')).toHaveText('還原的局');
    await expect(page.getByTestId('status-year')).toHaveText('1969 年');
    await expect(page.getByTestId('status-records')).toHaveText('1 筆');
    await expect(page.getByRole('button', { name: '切換到「備份局」' })).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('status-game')).toHaveText('還原的局');
  });

  test('[DATA-04] 損壞的備份檔被拒絕並顯示原因，資料不變', async ({ page }) => {
    await openApp(page);
    await createGameViaUi(page, '原本的局');
    const section = page.getByRole('region', { name: '備份與還原' });

    const chooserEvent = page.waitForEvent('filechooser');
    await section.getByRole('button', { name: '選擇備份檔' }).click();
    await (
      await chooserEvent
    ).setFiles({
      name: 'broken.json.gz',
      mimeType: 'application/gzip',
      buffer: Buffer.from([0x1f, 0x8b, 1, 2, 3, 4]),
    });

    const alert = section.getByRole('alert');
    await expect(alert).toContainText('資料未變更');
    await expect(alert).toContainText('gzip 解壓縮失敗');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('status-game')).toHaveText('原本的局');
    await expect(page.getByRole('table', { name: '遊戲局列表' }).getByRole('row')).toHaveCount(2);
  });
});
