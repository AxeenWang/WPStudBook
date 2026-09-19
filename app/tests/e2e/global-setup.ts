import { chromium, type FullConfig } from '@playwright/test';
import { APP_URL } from './helpers.ts';

/** 暖機最多等待的時間；只是避免無限等待。 */
const WARM_UP_TIMEOUT = 180_000;

/**
 * 測試開始前，每個瀏覽器先啟動一次並開啟建置檔，等狀態列出現後關閉。
 *
 * GitHub Actions 的 Windows 環境裡，瀏覽器第一次啟動並載入頁面的時間落差很大：多半 8～12 秒，
 * 偶爾 20 秒以上，PR #27 的 CI（執行 35437405500）兩個 worker 的第一個測試都超過 30 秒，
 * 在 `page.goto` 還沒回應時就逾時。之後重新啟動的 worker 只要 8～9 秒，所以是整台機器第一次
 * 啟動的一次性成本。先在這裡付掉，測試本身維持 30 秒的時限，也不開重試。
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  for (const project of config.projects) {
    const started = Date.now();
    const { channel } = project.use;
    const browser = await chromium.launch(channel === undefined ? {} : { channel });
    try {
      const page = await browser.newPage();
      await page.goto(APP_URL, { timeout: WARM_UP_TIMEOUT });
      await page.getByTestId('status-game').waitFor({ timeout: WARM_UP_TIMEOUT });
    } finally {
      await browser.close();
    }
    console.log(`[e2e] ${project.name} 暖機 ${String(Date.now() - started)} ms`);
  }
}
