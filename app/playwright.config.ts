import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results/playwright',
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'edge', use: { ...devices['Desktop Edge'], channel: 'msedge' } },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
