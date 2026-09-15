import { expect, test } from '@playwright/test';
import { createGameViaUi, openApp } from './helpers.ts';

test.describe('遊戲局設定', () => {
  test('[LINE-26] 保存高齡提醒年齡、種牡馬提醒年齡與活力建議門檻，重新整理後仍在；空白門檻表示不使用；錯誤時顯示原因', async ({
    page,
  }) => {
    await openApp(page);
    await createGameViaUi(page, '設定局');
    const form = page.getByRole('form', { name: '提醒設定' });
    const age = form.getByLabel('高齡提醒年齡');
    const threshold = form.getByLabel('活力建議門檻（留空＝不使用）');
    await expect(age).toHaveValue('18');
    await expect(threshold).toHaveValue('');
    const stallionAge = form.getByLabel('種牡馬提醒年齡');
    await expect(stallionAge).toHaveValue('26');

    await stallionAge.fill('24');
    await stallionAge.blur();
    await age.fill('20');
    await age.blur();
    await threshold.fill('60');
    await threshold.blur();
    await form.getByRole('button', { name: '保存設定' }).click();
    await expect(form.getByRole('status')).toHaveText('已保存設定');

    await page.reload();
    const reloaded = page.getByRole('form', { name: '提醒設定' });
    await expect(reloaded.getByLabel('高齡提醒年齡')).toHaveValue('20');
    await expect(reloaded.getByLabel('活力建議門檻（留空＝不使用）')).toHaveValue('60');
    await expect(reloaded.getByLabel('種牡馬提醒年齡')).toHaveValue('24');

    await reloaded.getByLabel('活力建議門檻（留空＝不使用）').fill('');
    await reloaded.getByLabel('活力建議門檻（留空＝不使用）').blur();
    await reloaded.getByLabel('高齡提醒年齡').fill('0');
    await reloaded.getByLabel('高齡提醒年齡').blur();
    await reloaded.getByRole('button', { name: '保存設定' }).click();
    await expect(reloaded.getByRole('alert')).toHaveText('高齡提醒年齡必須是 1～99 的整數');
  });

  test('回溯檢查點後，設定表單顯示回溯後的設定，不會把回溯前的值寫回', async ({ page }) => {
    await openApp(page);
    await createGameViaUi(page, '設定回溯局');
    const checkpoints = page.getByRole('region', { name: '檢查點' });
    await checkpoints.getByLabel('檢查點註記').fill('設定前');
    await checkpoints.getByRole('button', { name: '建立檢查點' }).click();
    const target = checkpoints.getByRole('row', { name: /設定前/ });
    await expect(target).toBeVisible();

    const form = page.getByRole('form', { name: '提醒設定' });
    const threshold = form.getByLabel('活力建議門檻（留空＝不使用）');
    await threshold.fill('60');
    await threshold.blur();
    await form.getByRole('button', { name: '保存設定' }).click();
    await expect(form.getByRole('status')).toHaveText('已保存設定');

    await target.getByRole('button', { name: '回溯到此' }).click();
    const downloadEvent = page.waitForEvent('download');
    await page
      .getByRole('alertdialog', { name: '回溯到檢查點' })
      .getByRole('button', { name: '下載備份並回溯' })
      .click();
    await downloadEvent;

    await expect(threshold).toHaveValue('');
    await expect(form.getByLabel('高齡提醒年齡')).toHaveValue('18');
  });
});
