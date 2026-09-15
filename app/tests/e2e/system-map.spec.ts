import { expect, test } from '@playwright/test';
import { createGameViaUi, gotoPage, openApp } from './helpers.ts';

test.describe('系統對照表', () => {
  test('可新增、升格更新與刪除，變更保存在歷程', async ({ page }) => {
    await openApp(page);
    await createGameViaUi(page, '對照局');
    await gotoPage(page, '系統對照表');
    const form = page.getByRole('form', { name: '新增或更新對照' });
    const table = page.getByRole('table', { name: '系統對照表', exact: true });
    const history = page.getByRole('table', { name: '對照表變更歷程（新到舊）' });

    await form.getByLabel('子系統', { exact: true }).fill('ハンプトン系');
    await form.getByLabel('親系統', { exact: true }).fill('エクリプス');
    await form.getByRole('button', { name: '保存對照' }).click();
    await expect(table.getByRole('row', { name: /ハンプトン/ })).toContainText('エクリプス');

    await form.getByLabel('子系統', { exact: true }).fill('ハンプトン');
    await form.getByLabel('親系統', { exact: true }).fill('ハンプトン');
    await form.getByRole('button', { name: '保存對照' }).click();
    await expect(table.getByRole('row', { name: /ハンプトン/ })).not.toContainText('エクリプス');
    await expect(history).toContainText('「ハンプトン」的親系統：「エクリプス」→「ハンプトン」');

    await table.getByRole('button', { name: '刪除「ハンプトン」' }).click();
    await page
      .getByRole('dialog', { name: '刪除對照' })
      .getByRole('button', { name: '刪除', exact: true })
      .click();
    await expect(page.getByText('尚無對照。')).toBeVisible();
    await expect(history.getByRole('row')).toHaveCount(4);

    await page.reload();
    await gotoPage(page, '系統對照表');
    await expect(history).toContainText('刪除「ハンプトン」→「ハンプトン」');
  });
});
