import { expect, test } from './fixtures.ts';
import { createGameViaUi, openApp } from './helpers.ts';

test.describe('遊戲局管理', () => {
  test('[BLD-01] 以 file:// 建立遊戲局，重新整理後資料仍在', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('status-game')).toHaveText('尚未建立');
    await createGameViaUi(page, 'テスト局', 1968);
    await expect(page.getByTestId('status-year')).toHaveText('1968 年');
    await expect(page.getByTestId('status-save')).toContainText('已保存');
    await page.reload();
    await expect(page.getByTestId('status-game')).toHaveText('テスト局');
    await expect(page.getByTestId('status-year')).toHaveText('1968 年');
  });

  test('[DATA-11] 更新目前遊戲年前顯示影響並確認，取消時不變', async ({ page }) => {
    await openApp(page);
    await createGameViaUi(page, '第一局', 1968);
    const yearForm = page.getByRole('form', { name: '目前遊戲年' });
    const yearInput = yearForm.getByLabel('新的目前遊戲年');
    await yearInput.fill('1969');
    await yearInput.blur();

    await yearForm.getByRole('button', { name: '更新遊戲年' }).click();
    const dialog = page.getByRole('dialog', { name: '確認更新目前遊戲年' });
    await expect(dialog).toContainText('從 1968 年改為 1969 年');
    await dialog.getByRole('button', { name: '取消' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('status-year')).toHaveText('1968 年');

    await yearForm.getByRole('button', { name: '更新遊戲年' }).click();
    await page
      .getByRole('dialog', { name: '確認更新目前遊戲年' })
      .getByRole('button', { name: '確認更新' })
      .click();
    await expect(page.getByTestId('status-year')).toHaveText('1969 年');
  });

  test('[DATA-13] 新局可選擇只複製設定，建立後沒有其他資料', async ({ page }) => {
    await openApp(page);
    await createGameViaUi(page, '來源局');
    const form = page.getByRole('form', { name: '建立遊戲局' });
    await form.getByLabel('遊戲局名稱').fill('複製設定的新局');
    // 用鍵盤依 WAI-ARIA radiogroup 慣例移動選取（Tab 到「全新空白」後按方向鍵），
    // 不用滑鼠點選文字：這個選項在頁面下半部，滑鼠點擊觸發的捲動在 Edge 上會與
    // Playwright 的可操作性檢查互相干擾（捲動位置在重試之間反覆跳動），
    // 鍵盤操作不需要捲動定位，穩定且同樣證明表單可用鍵盤完成。
    await form.getByRole('radio', { name: '全新空白' }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(
      form.getByRole('radio', { name: '只複製「來源局」的系統對照表與顯示設定' }),
    ).toBeChecked();
    await form.getByRole('button', { name: '建立遊戲局' }).click();
    await expect(page.getByTestId('status-game')).toHaveText('複製設定的新局');
    await expect(page.getByTestId('status-records')).toHaveText('0 筆');
    await expect(page.getByRole('button', { name: '切換到「來源局」' })).toBeVisible();
  });

  test('[DATA-10] 永久刪除此局位於危險區，局名不符時不能確認', async ({ page }) => {
    await openApp(page);
    await createGameViaUi(page, '保留局');
    await createGameViaUi(page, '要刪除的局');

    const zone = page.getByRole('region', { name: '危險區' });
    await zone.getByRole('button', { name: '永久刪除此局' }).click();
    const dialog = page.getByRole('alertdialog', { name: '永久刪除此局' });
    const confirm = dialog.getByRole('button', { name: '永久刪除' });
    await expect(dialog).toContainText('要刪除的局');
    await dialog.getByLabel('請輸入局名').fill('要刪除');
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('請輸入局名').fill('要刪除的局');
    await confirm.click();

    await expect(page.getByTestId('status-game')).toHaveText('保留局');
    await expect(page.getByRole('button', { name: '切換到「要刪除的局」' })).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('status-game')).toHaveText('保留局');
  });

  test('[DATA-10] 刪除全部存檔要輸入局名並再次確認', async ({ page }) => {
    await openApp(page);
    await createGameViaUi(page, '第一局');
    await createGameViaUi(page, '第二局');
    const zone = page.getByRole('region', { name: '危險區' });

    const startDeleteAll = async () => {
      await zone.getByRole('button', { name: '刪除全部存檔' }).click();
      const first = page.getByRole('alertdialog', { name: '刪除全部存檔' });
      await expect(first).toContainText('2 個遊戲局');
      await first.getByLabel('請輸入局名').fill('第二局');
      await first.getByRole('button', { name: '下一步' }).click();
      return page.getByRole('alertdialog', { name: '再次確認刪除全部存檔' });
    };

    const cancelled = await startDeleteAll();
    await cancelled.getByRole('button', { name: '取消' }).click();
    await expect(page.getByTestId('status-game')).toHaveText('第二局');

    const confirmed = await startDeleteAll();
    await confirmed.getByRole('button', { name: '刪除全部' }).click();
    await expect(page.getByTestId('status-game')).toHaveText('尚未建立');
    await page.reload();
    await expect(page.getByTestId('status-game')).toHaveText('尚未建立');
  });
});
