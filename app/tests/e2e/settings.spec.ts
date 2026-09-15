import { expect, test } from '@playwright/test';
import { createGameViaUi, openApp } from './helpers.ts';

test.describe('遊戲局設定', () => {
  test('保存高齡提醒年齡與活力建議門檻，重新整理後仍在；空白門檻表示不使用；錯誤時顯示原因', async ({
    page,
  }) => {
    await openApp(page);
    await createGameViaUi(page, '設定局');
    const form = page.getByRole('form', { name: '繁殖牝馬提醒' });
    const age = form.getByLabel('高齡提醒年齡');
    const threshold = form.getByLabel('活力建議門檻（留空＝不使用）');
    await expect(age).toHaveValue('18');
    await expect(threshold).toHaveValue('');

    await age.fill('20');
    await age.blur();
    await threshold.fill('60');
    await threshold.blur();
    await form.getByRole('button', { name: '保存設定' }).click();
    await expect(form.getByRole('status')).toHaveText('已保存設定');

    await page.reload();
    const reloaded = page.getByRole('form', { name: '繁殖牝馬提醒' });
    await expect(reloaded.getByLabel('高齡提醒年齡')).toHaveValue('20');
    await expect(reloaded.getByLabel('活力建議門檻（留空＝不使用）')).toHaveValue('60');

    await reloaded.getByLabel('活力建議門檻（留空＝不使用）').fill('');
    await reloaded.getByLabel('活力建議門檻（留空＝不使用）').blur();
    await reloaded.getByLabel('高齡提醒年齡').fill('0');
    await reloaded.getByLabel('高齡提醒年齡').blur();
    await reloaded.getByRole('button', { name: '保存設定' }).click();
    await expect(reloaded.getByRole('alert')).toHaveText('高齡提醒年齡必須是 1～99 的整數');
  });
});
