import { expect, test } from '@playwright/test';
import { createGameViaUi, openApp } from './helpers.ts';

const CHECK_KEYS = [
  'secureContext',
  'randomUuid',
  'sha256',
  'compression',
  'shiftJis',
  'indexedDb',
] as const;

test.describe('file:// 環境條件（設計決策 7.5 節）', () => {
  test('[BLD-02][BLD-04] 環境檢查全部通過，建立資料與重新整理的過程沒有任何網路請求', async ({
    page,
  }) => {
    const externalRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith('file:') && !url.startsWith('data:') && !url.startsWith('blob:')) {
        externalRequests.push(url);
      }
    });

    await openApp(page);
    await expect(page.getByRole('heading', { name: 'WPStudBook' })).toBeVisible();
    for (const key of CHECK_KEYS) {
      await expect(page.getByTestId(`env-${key}-reason`), `環境檢查 ${key} 的失敗原因`).toHaveText(
        '',
      );
      await expect(page.getByTestId(`env-${key}`)).toHaveText('通過');
    }
    await createGameViaUi(page, '網路檢查局');
    await page.reload();
    await expect(page.getByTestId('status-game')).toHaveText('網路檢查局');
    expect(externalRequests).toEqual([]);
  });

  test('建立遊戲局表單可只用鍵盤完成', async ({ page }) => {
    await openApp(page);
    await page.getByLabel('遊戲局名稱').focus();
    await page.keyboard.type('鍵盤局');
    await page.keyboard.press('Tab');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('1970');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('status-game')).toHaveText('鍵盤局');
    await expect(page.getByTestId('status-year')).toHaveText('1970 年');
  });
});
