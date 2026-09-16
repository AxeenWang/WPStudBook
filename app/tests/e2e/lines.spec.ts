import { expect, test } from '@playwright/test';
import { createGameViaUi, gotoPage, openApp } from './helpers.ts';

test.describe('八系位置', () => {
  test('[LINE-01] 新遊戲局的八系位置全部空白；開啟第 1 系後重新整理仍在', async ({ page }) => {
    await openApp(page);
    await createGameViaUi(page, '八系局', 1968);
    await gotoPage(page, '八系');
    for (let position = 1; position <= 8; position += 1) {
      await expect(page.getByTestId(`line-slot-${String(position)}`)).toContainText('尚未開啟');
    }

    // 系位置由總覽的任務看板開啟（需求規格 7.3、13.2）。
    await gotoPage(page, '總覽');
    const form = page.getByRole('form', { name: '開啟第 1 系' });
    await form.getByLabel('目前子系統').fill('ネアルコ系');
    await form.getByLabel('親系統', { exact: true }).fill('ネアルコ');
    await form.getByLabel('零代市場種牡馬馬名').fill('(外)テストシュボバ');
    await form.getByLabel('能力番号（選填，例如 0x0000）').fill('0x0000');
    await form.getByRole('button', { name: '開啟第 1 系' }).click();
    await expect(page.getByRole('form', { name: '開啟第 1 系' })).toHaveCount(0);

    await gotoPage(page, '八系');
    const first = page.getByTestId('line-slot-1');
    await expect(first).toContainText('ネアルコ');
    await expect(first).toContainText('(外)テストシュボバ');
    await expect(first).toContainText('紅');
    await expect(page.getByTestId('line-slot-2')).toContainText('尚未開啟');
    await expect(page.getByTestId('status-records')).toHaveText('8 筆');

    await page.reload();
    await gotoPage(page, '八系');
    await expect(page.getByTestId('line-slot-1')).toContainText('(外)テストシュボバ');
    await expect(page.getByTestId('line-slot-8')).toContainText('尚未開啟');
  });

  test('親系統與系統對照表不同時，確認後才開啟並更新對照表', async ({ page }) => {
    await openApp(page);
    await createGameViaUi(page, '確認局', 1968);
    await gotoPage(page, '系統對照表');
    const mapForm = page.getByRole('form', { name: '新增或更新對照' });
    await mapForm.getByLabel('子系統', { exact: true }).fill('ネアルコ');
    await mapForm.getByLabel('親系統', { exact: true }).fill('ファラリス');
    await mapForm.getByRole('button', { name: '保存對照' }).click();
    await expect(page.getByRole('table', { name: '系統對照表', exact: true })).toContainText(
      'ファラリス',
    );

    await gotoPage(page, '總覽');
    const form = page.getByRole('form', { name: '開啟第 1 系' });
    await form.getByLabel('目前子系統').fill('ネアルコ');
    await form.getByLabel('目前子系統').blur();
    await expect(form.getByLabel('親系統', { exact: true })).toHaveValue('ファラリス');
    await form.getByLabel('親系統', { exact: true }).fill('ネアルコ');
    await form.getByLabel('零代市場種牡馬馬名').fill('テストシュボバ');
    await form.getByRole('button', { name: '開啟第 1 系' }).click();

    const dialog = page.getByRole('dialog', { name: '確認開啟第 1 系' });
    await expect(dialog).toContainText('確認後會改為「ネアルコ」');
    await dialog.getByRole('button', { name: '確認並開啟' }).click();
    await gotoPage(page, '八系');
    await expect(page.getByTestId('line-slot-1')).toContainText('テストシュボバ');

    await gotoPage(page, '系統對照表');
    const table = page.getByRole('table', { name: '系統對照表', exact: true });
    await expect(table).not.toContainText('ファラリス');
  });
});
