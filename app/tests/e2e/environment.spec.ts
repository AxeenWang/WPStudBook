import { expect, test } from '@playwright/test';
import { APP_URL } from './helpers.ts';

const CHECK_KEYS = [
  'secureContext',
  'randomUuid',
  'sha256',
  'compression',
  'shiftJis',
  'indexedDb',
] as const;

test.describe('file:// 環境條件（設計決策 7.5 節）', () => {
  test('所有環境檢查都通過，且沒有發出任何網路請求', async ({ page }) => {
    const externalRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith('file:') && !url.startsWith('data:') && !url.startsWith('blob:')) {
        externalRequests.push(url);
      }
    });

    await page.goto(APP_URL);
    await expect(page.getByRole('heading', { name: 'WPStudBook' })).toBeVisible();
    for (const key of CHECK_KEYS) {
      await expect(page.getByTestId(`env-${key}-reason`), `環境檢查 ${key} 的失敗原因`).toHaveText(
        '',
      );
      await expect(page.getByTestId(`env-${key}`)).toHaveText('通過');
    }
    expect(externalRequests).toEqual([]);
  });

  test('重新整理後 IndexedDB 資料仍在', async ({ page }) => {
    await page.goto(APP_URL);
    const probeCount = page.getByTestId('probe-count');
    await expect(probeCount).toHaveText('1');
    await page.reload();
    await expect(probeCount).toHaveText('2');
  });

  test('React Aria 按鈕可用鍵盤操作，重新檢查會再寫入一次', async ({ page }) => {
    await page.goto(APP_URL);
    const probeCount = page.getByTestId('probe-count');
    await expect(probeCount).toHaveText('1');
    await page.getByRole('button', { name: '重新檢查' }).focus();
    await page.keyboard.press('Enter');
    await expect(probeCount).toHaveText('2');
  });
});
