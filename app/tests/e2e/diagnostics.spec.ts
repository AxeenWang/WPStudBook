import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

interface DiagnosticsRow {
  id: string
  status: string
  detail: string
}
interface DiagnosticsSnapshot {
  done: boolean
  results: DiagnosticsRow[]
  cp932: unknown[]
  indexedDb: { previous: { value: string } | null; written: { value: string } } | null
}
declare global {
  interface Window {
    __wpsbDiagnostics?: DiagnosticsSnapshot
  }
}

const appUrl = new URL('../../dist/WPStudBook.html', import.meta.url).href
const fixturePath = fileURLToPath(new URL('../fixtures/sample-cp932.txt', import.meta.url))
const resultDir = new URL('../../test-results/diagnostics/', import.meta.url)

async function readDiagnostics(page: Page): Promise<DiagnosticsSnapshot> {
  await page.waitForFunction(() => window.__wpsbDiagnostics?.done === true)
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__wpsbDiagnostics)))
}

test('自動檢查完成，必要項目成功，並保存結果', async ({ page }, testInfo) => {
  await page.goto(appUrl)
  const diagnostics = await readDiagnostics(page)
  for (const id of ['indexeddb', 'sha256', 'gzip', 'cp932']) {
    await expect(page.getByTestId(`check-${id}`)).toHaveAttribute('data-status', 'ok')
  }
  const userAgent = await page.evaluate(() => navigator.userAgent)
  mkdirSync(resultDir, { recursive: true })
  writeFileSync(
    new URL(`${testInfo.project.name}.json`, resultDir),
    JSON.stringify({ userAgent, ...diagnostics }, null, 2),
  )
})

test('重新整理後 IndexedDB 資料仍在', async ({ page }) => {
  await page.goto(appUrl)
  const token = (await readDiagnostics(page)).indexedDb?.written.value
  await page.reload()
  const after = await readDiagnostics(page)
  expect(after.indexedDb?.previous?.value).toBe(token)
})

test('關閉再重新開啟瀏覽器後 IndexedDB 資料仍在', async ({ playwright }, testInfo) => {
  const channel = testInfo.project.use.channel
  const userDataDir = testInfo.outputPath('profile')

  const first = await playwright.chromium.launchPersistentContext(userDataDir, { channel })
  const firstPage = await first.newPage()
  await firstPage.goto(appUrl)
  const token = (await readDiagnostics(firstPage)).indexedDb?.written.value
  await first.close()

  const second = await playwright.chromium.launchPersistentContext(userDataDir, { channel })
  const secondPage = await second.newPage()
  await secondPage.goto(appUrl)
  const after = await readDiagnostics(secondPage)
  expect(after.indexedDb?.previous?.value).toBe(token)
  await second.close()
})

test('可以觸發下載', async ({ page }) => {
  await page.goto(appUrl)
  await readDiagnostics(page)
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-test').click(),
  ])
  expect(download.suggestedFilename()).toBe('wpsb-download-test.txt')
})

test('可以讀取 CP932 檔案', async ({ page }) => {
  await page.goto(appUrl)
  await readDiagnostics(page)
  await page.getByTestId('cp932-file').setInputFiles(fixturePath)
  await expect(page.getByTestId('cp932-first-line')).toHaveText(
    '馬名 | 国 | 年 | SP | ST | 距離適性 | 父系',
  )
})
