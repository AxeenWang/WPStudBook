import { writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { buildPerfGame, encodePerfBackup } from '../../scripts/lib/perf-game.ts';
import { buildSampleBytes, syntheticSample } from '../../scripts/lib/synthetic-samples.ts';
import { closeDrawer, createGameViaUi, gotoPage, openApp } from './helpers.ts';

/**
 * 可及性自動檢查（需求規格 13.5）：以 axe-core 對每一頁與主要狀態檢查 WCAG 2.1 A、AA 規則，
 * 包含對比、標籤、名稱、角色與鍵盤可及。畫面內容用合成遊戲局，讓清單、卡片與表格都有資料。
 */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

interface Finding {
  readonly state: string;
  readonly rule: string;
  readonly impact: string;
  readonly targets: readonly string[];
}

/** axe 無法自動判定、需要人工確認的項目（例如背景為漸層時的對比），另外記錄供檢視。 */
const reviews: Finding[] = [];

async function audit(page: Page, state: string, findings: Finding[]): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  // 確認真的檢查過：每個狀態都至少有通過的規則。
  expect(result.passes.length, state).toBeGreaterThan(0);
  for (const item of result.incomplete) {
    reviews.push({
      state,
      rule: `${item.id}：${item.help}`,
      impact: item.impact ?? '',
      targets: item.nodes.slice(0, 5).map((node) => node.target.join(' ')),
    });
  }
  for (const violation of result.violations) {
    findings.push({
      state,
      rule: `${violation.id}：${violation.help}`,
      impact: violation.impact ?? '',
      targets: violation.nodes.slice(0, 5).map((node) => node.target.join(' ')),
    });
  }
}

test.describe('可及性', () => {
  test('每一頁與主要狀態沒有 WCAG 2.1 A、AA 違規（axe-core）', async ({ page }, testInfo) => {
    test.slow();
    const perf = buildPerfGame(3_000);
    const backupPath = testInfo.outputPath('a11y.json.gz');
    writeFileSync(backupPath, await encodePerfBackup(perf));
    const findings: Finding[] = [];

    await openApp(page);
    await audit(page, '空白（資料管理）', findings);

    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '選擇備份檔' }).click();
    await (await chooser).setFiles(backupPath);
    const restore = page.getByRole('dialog', { name: '還原備份為新遊戲局' });
    await audit(page, '還原對話框', findings);
    await restore.getByRole('button', { name: '還原為新遊戲局' }).click();
    await expect(page.getByTestId('status-game')).toHaveText(perf.game.name);

    for (const name of ['總覽', '八系', '母馬群', '產駒', '系統對照表', '資料管理']) {
      await gotoPage(page, name);
      await audit(page, name, findings);
    }

    await gotoPage(page, '母馬群');
    const card = page.getByRole('region', { name: '繁殖牝馬群' }).getByRole('article').first();
    const name = await card.getAttribute('aria-label');
    await card.getByTestId('mare-site').click();
    const drawer = page.getByRole('dialog', { name: `「${name ?? ''}」詳情` });
    for (const tab of ['概要', '配種', '產駒', '血緣', '歷程']) {
      await drawer.getByRole('tab', { name: tab }).click();
      await expect(drawer.getByRole('tabpanel')).toBeVisible();
      await audit(page, `母馬詳情：${tab}`, findings);
    }
    await closeDrawer(drawer);

    await gotoPage(page, '年度匯入');
    const sample = syntheticSample('mayMares');
    const fileName = `${String(perf.game.currentYear)}年 5月1週_繁殖牝馬.txt`;
    await page.getByLabel('選擇匯入檔（也可以把檔案拖放到這裡）').setInputFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from(buildSampleBytes({ ...sample, fileName })),
    });
    await page.getByRole('button', { name: '產生預覽' }).click();
    await expect(page.getByTestId('import-summary')).toBeVisible();
    await audit(page, '年度匯入：五月繁殖牝馬預覽', findings);

    await gotoPage(page, '資料管理');
    await page.getByRole('button', { name: '永久刪除此局' }).click();
    await expect(page.getByRole('alertdialog', { name: '永久刪除此局' })).toBeVisible();
    await audit(page, '危險區確認對話框', findings);

    console.log(`[axe] 需人工確認 ${String(reviews.length)} 項`, JSON.stringify(reviews, null, 1));
    await testInfo.attach('axe-findings.json', {
      body: JSON.stringify(findings, null, 2),
      contentType: 'application/json',
    });
    expect(findings).toEqual([]);
  });

  test('選取狀態不只靠顏色；強制色彩下仍分得出目前頁籤；降低動態時取消轉場', async ({ page }) => {
    await openApp(page);
    await createGameViaUi(page, '可及性局');
    await gotoPage(page, '母馬群');

    // 選取的切換按鈕加上勾號，按鈕名稱不變。
    const selected = page.getByRole('button', { name: '全部代數', exact: true });
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    const mark = await selected.evaluate(
      (element) => getComputedStyle(element, '::before').content,
    );
    expect(mark).toContain('✓');

    await page.emulateMedia({ forcedColors: 'active' });
    const nav = page.getByRole('navigation', { name: '主要頁面' });
    const underline = (name: string) =>
      nav
        .getByRole('button', { name, exact: true })
        .evaluate((element) => getComputedStyle(element).borderBottomColor);
    expect(await underline('母馬群')).not.toBe(await underline('總覽'));

    await page.emulateMedia({ forcedColors: 'none' });

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const transition = await nav
      .getByRole('button', { name: '總覽', exact: true })
      .evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(transition).toBe('0s');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const normal = await nav
      .getByRole('button', { name: '總覽', exact: true })
      .evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(normal).not.toBe('0s');
  });
});
