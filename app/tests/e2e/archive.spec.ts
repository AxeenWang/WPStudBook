import { expect, test } from './fixtures.ts';
import { changeYearViaUi, createGameViaUi, gotoPage, openApp } from './helpers.ts';

test.describe('封存舊遊戲局', () => {
  test('[DATA-09] 選回下載的封存檔核對並輸入局名後才移除本機明細；保留索引並可從封存檔還原', async ({
    page,
  }, testInfo) => {
    await openApp(page);
    await createGameViaUi(page, '舊局', 1968);
    await changeYearViaUi(page, 1970);
    await createGameViaUi(page, '新局', 1971);
    const section = page.getByRole('region', { name: '封存' });
    const games = page.getByRole('table', { name: '遊戲局列表' });

    // 預設選擇目前遊戲局以外、最早建立的一局。
    await expect(section.getByRole('radio', { name: /^舊局（1968～1970 年）$/ })).toBeChecked();
    const downloadEvent = page.waitForEvent('download');
    await section.getByRole('button', { name: '產生並下載「舊局」的封存檔' }).click();
    const download = await downloadEvent;
    const fileName = download.suggestedFilename();
    expect(fileName).toMatch(/^WPStudBook_舊局_1970年_\d{8}-\d{6}_封存\.json\.gz$/);
    await expect(section.getByTestId('archive-summary')).toContainText(fileName);
    await expect(section.getByTestId('archive-summary')).toContainText('JSON.GZ');

    // 還沒選回下載的封存檔：不能移除，資料不變。
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(games.getByRole('row')).toHaveCount(3);

    // 選到損壞的檔案：核對不通過，資料不變。
    let chooserEvent = page.waitForEvent('filechooser');
    await section.getByRole('button', { name: '選擇下載的封存檔核對' }).click();
    await (
      await chooserEvent
    ).setFiles({
      name: fileName,
      mimeType: 'application/gzip',
      buffer: Buffer.from([0x1f, 0x8b, 1, 2, 3, 4]),
    });
    await expect(section.getByRole('alert')).toContainText('封存檔核對未通過，本機資料未變更');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(games.getByRole('row')).toHaveCount(3);

    const savedPath = testInfo.outputPath(fileName);
    await download.saveAs(savedPath);
    chooserEvent = page.waitForEvent('filechooser');
    await section.getByRole('button', { name: '選擇下載的封存檔核對' }).click();
    await (await chooserEvent).setFiles(savedPath);

    const dialog = page.getByRole('alertdialog', { name: '移除本機明細' });
    await expect(dialog).toContainText(`封存檔「${fileName}」核對通過`);
    await expect(dialog).toContainText('將移除「舊局」的資料');
    const confirm = dialog.getByRole('button', { name: '移除本機明細' });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('請輸入局名「舊局」確認').fill('舊局');
    await confirm.click();

    await expect(section.getByRole('status')).toContainText('已封存「舊局」');
    await expect(games.getByRole('row')).toHaveCount(2);
    await expect(games.getByRole('row', { name: /舊局/ })).toHaveCount(0);
    await expect(page.getByTestId('status-game')).toHaveText('新局');

    const index = section.getByRole('table', { name: '封存索引' });
    const row = index.getByRole('row', { name: /舊局/ });
    await expect(row).toContainText('1968～1970 年');
    await expect(row).toContainText(fileName);
    await expect(row).toContainText(/程式 \d+\.\d+\.\d+・結構第 1 版/);

    await page.reload();
    await gotoPage(page, '資料管理');
    await expect(row).toBeVisible();
    await expect(games.getByRole('row')).toHaveCount(2);

    // 從封存檔還原為獨立遊戲局；索引保留。
    chooserEvent = page.waitForEvent('filechooser');
    await row.getByRole('button', { name: '從封存檔還原「舊局」' }).click();
    await (await chooserEvent).setFiles(savedPath);
    const restore = page.getByRole('dialog', { name: '從封存檔還原為新遊戲局' });
    await expect(restore.getByTestId('archive-restore-summary')).toContainText(fileName);
    await expect(restore.getByLabel('新遊戲局名稱')).toHaveValue('舊局');
    await restore.getByRole('button', { name: '還原為新遊戲局' }).click();

    await expect(page.getByTestId('status-game')).toHaveText('舊局');
    await expect(page.getByTestId('status-year')).toHaveText('1970 年');
    await expect(games.getByRole('row')).toHaveCount(3);
    await expect(row).toBeVisible();

    // 移除索引只刪索引，遊戲局不受影響。
    await row.getByRole('button', { name: '移除「舊局」的索引' }).click();
    await page
      .getByRole('alertdialog', { name: '移除封存索引' })
      .getByRole('button', { name: '移除索引' })
      .click();
    await expect(section).toContainText('還沒有封存的遊戲局。');
    await expect(games.getByRole('row')).toHaveCount(3);
  });
});
