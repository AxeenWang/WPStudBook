import { expect, test as base } from '@playwright/test';

/**
 * 每個端到端測試都檢查主控台（開發計畫第 10 章：以 `file://` 執行時主控台沒有未處理錯誤）。
 * 頁面丟出未捕捉的例外或未處理的 Promise 拒絕（pageerror），或主控台出現 error 等級的訊息，
 * 測試結束時判定失敗。程式本身不寫主控台，錯誤都顯示在畫面上，所以這裡出現的都是意外。
 *
 * spec 一律從這裡匯入 `test`（eslint 擋下直接從 `@playwright/test` 匯入）。
 */
export const test = base.extend<{ consoleErrors: undefined }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => {
        errors.push(`pageerror：${error.message}`);
      });
      page.on('console', (message) => {
        if (message.type() === 'error') {
          errors.push(`console.error：${message.text()}`);
        }
      });
      await use(undefined);
      expect(errors, '主控台沒有未處理錯誤').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
