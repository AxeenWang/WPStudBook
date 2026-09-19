import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { buildPerfGame, encodePerfBackup } from '../../scripts/lib/perf-game.ts';
import { closeDrawer, gotoPage, openApp } from './helpers.ts';

/** 3 萬筆：第 1 系歷年共 34 匹母馬、產駒 1,021 匹，都超過一頁（24）。 */
const SIZE = 30_000;

test.describe('大量資料', () => {
  test('[DATA-12] 數萬筆資料：還原顯示進度；母馬與產駒清單只建立目前一頁的元素，血緣按需展開', async ({
    page,
  }, testInfo) => {
    test.slow();
    const perf = buildPerfGame(SIZE);
    const backupPath = testInfo.outputPath(`perf-${String(SIZE)}.json.gz`);
    writeFileSync(backupPath, await encodePerfBackup(perf));
    const lineOne = perf.collections.mares.filter(
      (mare) => (mare.group as { position?: number }).position === 1,
    );
    expect(lineOne.length).toBeGreaterThan(24);
    expect(perf.collections.foals.length).toBeGreaterThan(24);

    await openApp(page);
    const backup = page.getByRole('region', { name: '備份與還原' });
    const chooser = page.waitForEvent('filechooser');
    await backup.getByRole('button', { name: '選擇備份檔' }).click();
    await (await chooser).setFiles(backupPath);
    const dialog = page.getByRole('dialog', { name: '還原備份為新遊戲局' });
    // 進度文字一閃即逝，先記下還原期間出現過的每一段狀態文字（需求規格 12.2「大型檔案顯示進度」）。
    await page.evaluate(() => {
      const seen: string[] = [];
      Reflect.set(window, '__statusTexts', seen);
      new MutationObserver(() => {
        for (const element of document.querySelectorAll('[role="status"]')) {
          seen.push(element.textContent);
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    await dialog.getByRole('button', { name: '還原為新遊戲局' }).click();
    const total = perf.recordCount.toLocaleString('en-US');
    await expect(page.getByTestId('status-records')).toHaveText(`${total} 筆`, {
      timeout: 60_000,
    });
    await expect(backup.getByRole('status')).toHaveText(`已還原為新遊戲局「${perf.game.name}」`);
    const seen = await page.evaluate(() => Reflect.get(window, '__statusTexts') as string[]);
    expect(seen).toContain('驗證中：核對 SHA-256…');
    // 寫入筆數含 1 筆遊戲局設定。
    const written = (perf.recordCount + 1).toLocaleString('en-US');
    expect(
      seen.some((text) => text.startsWith('寫入新遊戲局：') && text.endsWith(`／${written} 筆`)),
    ).toBe(true);

    // 母馬群：第 1 系全部代數、全部狀態，符合 34 匹，只建立第一頁 24 張卡片。
    await gotoPage(page, '母馬群');
    const herd = page.getByRole('region', { name: '繁殖牝馬群' });
    await herd.getByLabel('系', { exact: true }).selectOption({ label: '第 1 系' });
    await herd.getByRole('group', { name: '代數' }).getByText('全部代數').click();
    await herd
      .getByRole('group', { name: '篩選' })
      .getByLabel('狀態')
      .selectOption({ label: '全部' });
    await expect(herd.getByText(`符合條件 ${String(lineOne.length)} 匹`)).toBeVisible();
    await expect(herd.getByRole('article')).toHaveCount(24);
    const pages = herd.getByRole('navigation', { name: '分頁' });
    await expect(pages).toContainText('第 1／2 頁');
    await pages.getByRole('button', { name: '下一頁' }).click();
    await expect(herd.getByRole('article')).toHaveCount(lineOne.length - 24);

    // 血緣按需展開：開啟詳情欄時沒有血緣表，切到「血緣」頁籤才建立。
    const card = herd.getByRole('article').first();
    const name = await card.getAttribute('aria-label');
    await card.getByTestId('mare-site').click();
    const drawer = page.getByRole('dialog', { name: `「${name ?? ''}」詳情` });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('region', { name: '血緣表' })).toHaveCount(0);
    await drawer.getByRole('tab', { name: '血緣' }).click();
    await expect(drawer.getByRole('region', { name: '血緣表' })).toBeVisible();
    await closeDrawer(drawer);

    // 產駒清單：1,021 匹只建立第一頁 24 列。
    await gotoPage(page, '產駒');
    const foals = page.getByRole('list', { name: '產駒清單' });
    await expect(foals.getByRole('listitem')).toHaveCount(24);
    await expect(page.getByRole('navigation', { name: '分頁' })).toBeVisible();
  });
});
