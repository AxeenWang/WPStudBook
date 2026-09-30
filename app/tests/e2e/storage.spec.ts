import { expect, test, type Page } from '@playwright/test'

// 儲存整合驗證（技術設計第 7 節「儲存整合的驗證」）：不是由點擊直接觸發的下載。
// 資料夾的寫入與權限詢問無法自動化，在 Edge 手動驗證

const appUrl = new URL('../../dist/WPStudBook.html', import.meta.url).href
const BACKUP_NAME = /^WPStudBook_驗證用_2026年_\d{8}-\d{6}\.json\.gz$/

// 每次下載前要等 6 秒（SIMULATED_WORK_MS）
test.setTimeout(60_000)

/** 點擊按鈕，等它在 6 秒後觸發的下載，回傳下載的檔名 */
async function clickAndDownload(page: Page, testId: string): Promise<string> {
  const downloading = page.waitForEvent('download', { timeout: 20_000 })
  await page.getByTestId(testId).click()
  return (await downloading).suggestedFilename()
}

test('延遲下載：點擊 6 秒後才觸發的下載可以完成', async ({ page }) => {
  await page.goto(appUrl)
  expect(await clickAndDownload(page, 'storage-delayed-download')).toMatch(BACKUP_NAME)
  await expect(page.getByTestId('storage-message')).toContainText('已下載')
})

test('未選資料夾時模擬年度匯入的自動備份：改為下載，原因 not-set', async ({ page }) => {
  await page.goto(appUrl)
  expect(await clickAndDownload(page, 'storage-auto-backup')).toMatch(BACKUP_NAME)
  await expect(page.getByTestId('storage-message')).toContainText('原因：not-set')
})

test('連續兩次點擊，各自觸發一次延遲下載', async ({ page }) => {
  await page.goto(appUrl)
  for (let round = 0; round < 2; round++) {
    expect(await clickAndDownload(page, 'storage-delayed-download')).toMatch(BACKUP_NAME)
  }
})
