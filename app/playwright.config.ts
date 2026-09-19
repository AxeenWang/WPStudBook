import { defineConfig, devices } from '@playwright/test';
import { parseBrowserChannels } from './scripts/lib/browser-channels.ts';

const channels = parseBrowserChannels(process.env.E2E_BROWSERS);
if (!channels.includes('chrome') && !process.env.CI) {
  console.warn('[e2e] 未執行 Chrome：E2E_BROWSERS 未包含 chrome，Chrome 由 GitHub Actions 驗證');
}

export default defineConfig({
  testDir: 'tests/e2e',
  // 瀏覽器第一次啟動的一次性成本在測試開始前付掉（見 global-setup.ts）。
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // 停用影片錄製：Playwright 的影片錄製需要獨立下載的 ffmpeg 執行檔
    // （不在已安裝的系統 Edge／`npx playwright install` 範圍內，且本計畫禁止額外下載），
    // 缺少時 browserContext.newPage() 會直接失敗。影片只是失敗時的除錯輔助產物，
    // 不影響任何測試斷言或涵蓋範圍；trace 與失敗自動截圖仍保留供除錯使用。
    video: 'off',
  },
  projects: channels.map((channel) => ({
    name: channel,
    use: {
      ...(channel === 'msedge' ? devices['Desktop Edge'] : devices['Desktop Chrome']),
      channel,
    },
  })),
});
