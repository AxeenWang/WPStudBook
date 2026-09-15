import { expect, test } from '@playwright/test';
import { createGameViaUi, openApp } from './helpers.ts';

test.describe('原始資料匯出', () => {
  test('本機資料不符合資料契約時備份失敗，可以匯出標示不能還原的原始資料', async ({ page }) => {
    await openApp(page);
    await createGameViaUi(page, '救援局');

    await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('wpstudbook');
        request.onsuccess = () => {
          resolve(request.result);
        };
        request.onerror = () => {
          reject(new Error(request.error?.message ?? 'IndexedDB 開啟失敗'));
        };
      });
      try {
        const transaction = database.transaction(['appMeta', 'horses'], 'readwrite');
        const done = new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => {
            resolve();
          };
          transaction.onabort = () => {
            reject(new Error(transaction.error?.message ?? '交易中止'));
          };
        });
        const metaRequest = transaction.objectStore('appMeta').get('currentGameId');
        metaRequest.onsuccess = () => {
          const meta: unknown = metaRequest.result;
          const gameId: unknown =
            typeof meta === 'object' && meta !== null ? Reflect.get(meta, 'value') : undefined;
          if (typeof gameId !== 'string') {
            transaction.abort();
            return;
          }
          // 缺少必填的 sex，不符合 horses 的欄位規則。
          transaction.objectStore('horses').put({
            gameId,
            id: 'broken-horse',
            fullName: '性別不明',
            stageNumbers: [],
            aliases: [],
          });
        };
        await done;
      } finally {
        database.close();
      }
    });

    const section = page.getByRole('region', { name: '備份與還原' });
    await section.getByRole('button', { name: '下載備份' }).click();
    const alert = section.getByRole('alert');
    await expect(alert).toContainText('備份失敗');
    const rawButton = alert.getByRole('button', { name: '匯出原始資料（不能還原）' });
    await expect(rawButton).toBeVisible();

    const downloadEvent = page.waitForEvent('download');
    await rawButton.click();
    const download = await downloadEvent;

    expect(download.suggestedFilename()).toMatch(/_原始資料_不能還原\.json$/);
    await expect(section.getByRole('status')).toContainText('已匯出原始資料');
  });
});
