import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { buildPerfGame, encodePerfBackup, type PerfGame } from '../../scripts/lib/perf-game.ts';
import {
  buildSampleBytes,
  syntheticSample,
  type SyntheticSample,
} from '../../scripts/lib/synthetic-samples.ts';
import { closeDrawer, gotoPage, openApp } from './helpers.ts';

/**
 * 效能量測（開發計畫階段 5、設計決策 7.1）：以 1 萬、3 萬、5 萬筆合成資料量測啟動、篩選、搜尋、
 * 血緣展開、備份與還原，以及 5,000 筆十月全世界繁殖牝馬總表的匯入時間。只記錄結果，不設門檻；
 * 以 `npm run perf` 執行，一般端到端測試與 CI 不跑。合成資料臨時產生到 `tests/fixtures/generated/`。
 */

const SIZES = [10_000, 30_000, 50_000] as const;
const OCT_ROWS = 5_000;
const OCT_MATCHES = 200;
/** 一月二歲馬總表的筆數，與 `.references/` 的 1968 年實檔（1,160 筆）同一量級。 */
const JAN_ROWS = 1_200;
/** 單一步驟最多等待的時間；只是避免無限等待，不是效能門檻。 */
const STEP_TIMEOUT = 300_000;
const GENERATED = resolve('tests/fixtures/generated');

function formatCount(count: number): string {
  return `${count.toLocaleString('en-US')} 筆`;
}

async function writePerfBackup(perf: PerfGame, size: number): Promise<string> {
  mkdirSync(GENERATED, { recursive: true });
  const path = resolve(GENERATED, `perf-${String(size)}.json.gz`);
  writeFileSync(path, await encodePerfBackup(perf));
  return path;
}

function hex(value: number): string {
  return `0x${value.toString(16).toUpperCase()}`;
}

function sampleRow(sample: SyntheticSample, name: string): Readonly<Record<string, string>> {
  const found = sample.rows.find((row) => row.name === name);
  if (found === undefined) {
    throw new Error(`樣本沒有${name}`);
  }
  return found;
}

/** 十月總表：5,000 筆，其中 200 筆是沒有轉入繁殖牝馬圈的自家牝駒，出現在牧場 150。 */
function octWorldMares(perf: PerfGame) {
  const sample = syntheticSample('octWorldMares');
  const template = sampleRow(sample, 'テストメス020');
  const year = perf.game.currentYear;
  const fillies = perf.ownFillies.filter((filly) => filly.birthYear <= year - 3);
  const matches = fillies.slice(-OCT_MATCHES).map((filly) => ({
    ...template,
    name: filly.name,
    baseName: filly.name,
    abilityNo: hex(filly.abilityNo),
    age: String(year - filly.birthYear),
    farm: '150',
  }));
  const others = Array.from({ length: OCT_ROWS - matches.length }, (_, index) => ({
    ...template,
    name: `テスト他場${String(index).padStart(4, '0')}`,
    baseName: `テスト他場${String(index).padStart(4, '0')}`,
    abilityNo: hex(0xc000 + index),
    horseNo: hex(0xa000 + index),
    farm: String((index % 200) + 50),
  }));
  const fileName = `${String(year)}年10月1週_繁殖牝馬.txt`;
  return {
    fileName,
    matched: matches.length,
    payload: {
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from(buildSampleBytes({ ...sample, fileName, rows: [...matches, ...others] })),
    },
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * 五月種牡馬總表：最後一年的現役種牡馬全部列出（約 450 筆，與實檔 443 筆同一量級）。父母與父系
 * 照既有紀錄填，每一筆都配對到既有的馬並比對前一份年度快照，不會因血統不符而被略過。
 */
function mayStallions(perf: PerfGame, fileName: string): SyntheticSample {
  const sample = syntheticSample('mayStallions');
  const template = sampleRow(sample, 'テストウマ001');
  const year = perf.game.currentYear;
  const byAbilityNo = new Map(perf.collections.horses.map((horse) => [horse.abilityNo, horse]));
  const rows = perf.activeStallions.map((stallion) => {
    const horse = byAbilityNo.get(stallion.abilityNo);
    return {
      ...template,
      name: stallion.name,
      baseName: stallion.name,
      age: String(year - stallion.birthYear),
      abilityNo: hex(stallion.abilityNo),
      horseNo: hex(stallion.abilityNo),
      sire: text(horse?.sireName),
      dam: text(horse?.damName),
      sireSystem: `${text(horse?.sireSubsystem)}系`,
      femaleLine: '',
      historical: '',
    };
  });
  return { ...sample, fileName, rows };
}

/**
 * 五月與七月繁殖牝馬總表：自家牧場的生產中母馬全部列出，父母、父系與能力番号照既有紀錄填；
 * 七月另填受胎與配種的種牡馬（現役種牡馬輪流）。
 */
function broodmares(
  perf: PerfGame,
  id: 'mayMares' | 'julMares',
  fileName: string,
): SyntheticSample {
  const sample = syntheticSample(id);
  const template = sample.rows[0];
  if (template === undefined) {
    throw new Error(`樣本 ${id} 沒有資料列`);
  }
  const year = perf.game.currentYear;
  const horses = new Map(perf.collections.horses.map((horse) => [horse.id, horse]));
  const rows = perf.collections.mares
    .filter((mare) => mare.status === 'producing')
    .map((mare, index) => {
      const horse = horses.get(mare.id);
      const name = text(horse?.fullName);
      const stallion = perf.activeStallions[index % perf.activeStallions.length];
      return {
        ...template,
        name,
        baseName: name,
        age: String(year - (horse?.birthYear as number)),
        abilityNo: hex(horse?.abilityNo as number),
        horseNo: hex(horse?.abilityNo as number),
        sire: text(horse?.sireName),
        dam: text(horse?.damName),
        sireSystem: `${text(horse?.sireSubsystem)}系`,
        femaleLine: '',
        farm: '32',
        vitality: String(40 + (index % 60)),
        ...(id === 'julMares'
          ? { status: '受胎', matedStallion: stallion?.name ?? '' }
          : { status: '空胎' }),
      };
    });
  return { ...sample, fileName, rows };
}

/** 一月二歲馬總表：1,200 筆，其中是兩年前出生的自家產駒，其餘是其他馬主的馬。 */
function jan2yo(perf: PerfGame, fileName: string): SyntheticSample {
  const sample = syntheticSample('jan2yo');
  const own = sampleRow(sample, 'テストウマ010');
  const other = sampleRow(sample, '[地]テストウマ011');
  const birthYear = perf.game.currentYear - 2;
  const foalIds = new Set(
    perf.collections.foals.filter((foal) => foal.birthYear === birthYear).map((foal) => foal.id),
  );
  const names = new Map(perf.collections.horses.map((horse) => [horse.id, text(horse.fullName)]));
  const ownRows = perf.collections.horses
    .filter((horse) => foalIds.has(text(horse.id)))
    .map((horse) => ({
      ...own,
      name: text(horse.fullName),
      baseName: text(horse.fullName),
      sex: horse.sex === 'female' ? '牝' : '牡',
      abilityNo: hex(horse.abilityNo as number),
      sire: names.get(horse.sireId) ?? '',
      dam: names.get(horse.damId) ?? '',
      sireSystem: `${text(horse.sireSubsystem)}系`,
      femaleLine: '',
    }));
  const others = Array.from({ length: JAN_ROWS - ownRows.length }, (_, index) => ({
    ...other,
    name: `テスト他駒${String(index).padStart(4, '0')}`,
    baseName: `テスト他駒${String(index).padStart(4, '0')}`,
    abilityNo: hex(0xd000 + index),
    horseNo: hex(0xe000 + index),
  }));
  return { ...sample, fileName, rows: [...ownRows, ...others] };
}

async function heapMegabytes(page: Page): Promise<number | undefined> {
  return page.evaluate(() => {
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    return memory === undefined ? undefined : Math.round(memory.usedJSHeapSize / 1024 / 1024);
  });
}

test.describe('效能量測 @perf', () => {
  for (const size of SIZES) {
    test(`[DATA-12] ${formatCount(size)}合成資料 @perf`, async ({ page }, testInfo) => {
      test.setTimeout(30 * 60_000);
      const perf = buildPerfGame(size);
      const backupPath = await writePerfBackup(perf, size);
      const results: Record<string, number | string> = {
        瀏覽器: `${testInfo.project.name} ${page.context().browser()?.version() ?? ''}`,
        筆數: perf.recordCount,
        遊戲年: `${String(perf.game.startYear)}～${String(perf.game.currentYear)}`,
      };
      const measure = async (label: string, action: () => Promise<void>): Promise<void> => {
        const start = Date.now();
        await action();
        results[label] = Date.now() - start;
      };
      const statusRecords = page.getByTestId('status-records');

      await measure('開啟（空資料庫）ms', () => openApp(page));

      // 還原：選檔後驗證並預覽，確認後寫入。
      const backup = page.getByRole('region', { name: '備份與還原' });
      const dialog = page.getByRole('dialog', { name: '還原備份為新遊戲局' });
      await measure('備份檔驗證與預覽 ms', async () => {
        const chooser = page.waitForEvent('filechooser');
        await backup.getByRole('button', { name: '選擇備份檔' }).click();
        await (await chooser).setFiles(backupPath);
        await expect(dialog).toBeVisible({ timeout: STEP_TIMEOUT });
      });
      await measure('還原寫入 ms', async () => {
        await dialog.getByRole('button', { name: '還原為新遊戲局' }).click();
        await expect(statusRecords).toHaveText(formatCount(perf.recordCount), {
          timeout: STEP_TIMEOUT,
        });
      });
      results['還原後記憶體 MB'] = (await heapMegabytes(page)) ?? '—';

      await measure('重新整理後啟動 ms', async () => {
        await page.reload();
        await expect(statusRecords).toHaveText(formatCount(perf.recordCount), {
          timeout: STEP_TIMEOUT,
        });
      });

      // 母馬群：第 1 系全部代數，篩選與搜尋；清單只建立目前一頁的卡片（DATA-12）。
      const herd = page.getByRole('region', { name: '繁殖牝馬群' });
      const filters = herd.getByRole('group', { name: '篩選' });
      const matchCount = herd.getByText(/^符合條件 \d+ 匹$/);
      const lineOne = perf.collections.mares.filter(
        (mare) => (mare.group as { position?: number }).position === 1,
      );
      const producing = lineOne.filter((mare) => mare.status === 'producing').length;
      await measure('開啟母馬群 ms', async () => {
        await gotoPage(page, '母馬群');
        await expect(herd.getByRole('article').first()).toBeVisible({ timeout: STEP_TIMEOUT });
      });
      await herd.getByLabel('系', { exact: true }).selectOption({ label: '第 1 系' });
      await herd.getByRole('group', { name: '代數' }).getByText('全部代數').click();
      await expect(matchCount).toHaveText(`符合條件 ${String(producing)} 匹`, {
        timeout: STEP_TIMEOUT,
      });
      await measure('篩選：狀態改為全部 ms', async () => {
        await filters.getByLabel('狀態').selectOption({ label: '全部' });
        await expect(matchCount).toHaveText(`符合條件 ${String(lineOne.length)} 匹`, {
          timeout: STEP_TIMEOUT,
        });
      });
      expect(await herd.getByRole('article').count()).toBeLessThanOrEqual(24);
      results['母馬卡片數（第 1 系全部）'] = await herd.getByRole('article').count();
      await measure('搜尋馬名 ms', async () => {
        await filters.getByLabel('關鍵字（馬名）').fill(perf.searchKeyword);
        await expect(matchCount).toHaveText('符合條件 1 匹', { timeout: STEP_TIMEOUT });
      });

      // 血緣按需展開：開啟詳情欄時不建立血緣表，切到「血緣」頁籤才載入。
      const card = herd.getByRole('article', { name: perf.searchKeyword });
      const drawer = page.getByRole('dialog', { name: `「${perf.searchKeyword}」詳情` });
      await measure('開啟母馬詳情 ms', async () => {
        await card.getByTestId('mare-site').click();
        await expect(drawer).toBeVisible({ timeout: STEP_TIMEOUT });
      });
      await expect(drawer.getByRole('region', { name: '血緣表' })).toHaveCount(0);
      await measure('展開血緣 ms', async () => {
        await drawer.getByRole('tab', { name: '血緣' }).click();
        await expect(drawer.getByRole('region', { name: '血緣表' })).toBeVisible({
          timeout: STEP_TIMEOUT,
        });
      });
      await closeDrawer(drawer);

      // 產駒清單：只建立目前一頁的列。
      const foalList = page.getByRole('list', { name: '產駒清單' });
      await measure('開啟產駒 ms', async () => {
        await gotoPage(page, '產駒');
        await expect(foalList.getByRole('listitem').first()).toBeVisible({
          timeout: STEP_TIMEOUT,
        });
      });
      results['產駒列數'] = await foalList.getByRole('listitem').count();
      results['產駒總數'] = perf.collections.foals.length;

      // 備份匯出。
      await gotoPage(page, '資料管理');
      await measure('下載備份 ms', async () => {
        const download = page.waitForEvent('download', { timeout: STEP_TIMEOUT });
        await backup.getByRole('button', { name: '下載備份' }).click();
        await download;
        await expect(page.getByTestId('export-summary')).toBeVisible({ timeout: STEP_TIMEOUT });
      });

      // 其他年度總表的預覽：檔名改為目前遊戲年，只預覽不套用。預覽會讀出整局的相關資料。
      const year = String(perf.game.currentYear);
      const stallionFile = `${year}年5月1週_種牡馬.txt`;
      const janFile = `${year}年 1月1週._二歲新馬.txt`;
      const mayFile = `${year}年 5月1週_繁殖牝馬.txt`;
      const julFile = `${year}年 7月1週_繁殖牝馬.txt`;
      const previews: readonly (readonly [string, SyntheticSample])[] = [
        [
          `五月種牡馬總表 ${String(perf.activeStallions.length)} 筆預覽 ms`,
          mayStallions(perf, stallionFile),
        ],
        ['五月繁殖牝馬總表預覽 ms', broodmares(perf, 'mayMares', mayFile)],
        ['七月繁殖牝馬總表預覽 ms', broodmares(perf, 'julMares', julFile)],
        [`一月二歲馬總表 ${String(JAN_ROWS)} 筆預覽 ms`, jan2yo(perf, janFile)],
      ];
      for (const [label, sample] of previews) {
        // 換頁再回來，讓上一份預覽卸載，避免把舊的摘要當成這一份完成。
        await gotoPage(page, '資料管理');
        await gotoPage(page, '年度匯入');
        await measure(label, async () => {
          await page.getByLabel('選擇匯入檔（也可以把檔案拖放到這裡）').setInputFiles({
            name: sample.fileName,
            mimeType: 'text/plain',
            buffer: Buffer.from(buildSampleBytes(sample)),
          });
          await page.getByRole('button', { name: '產生預覽' }).click();
          await expect(page.getByTestId('import-summary')).toBeVisible({ timeout: STEP_TIMEOUT });
        });
        results[label.replace(' ms', '摘要')] =
          (await page.getByTestId('import-summary').textContent()) ?? '';
      }

      // 十月全世界繁殖牝馬總表 5,000 筆。
      const oct = octWorldMares(perf);
      await gotoPage(page, '資料管理');
      await gotoPage(page, '年度匯入');
      await measure('十月總表 5,000 筆預覽 ms', async () => {
        await page.getByLabel('選擇匯入檔（也可以把檔案拖放到這裡）').setInputFiles(oct.payload);
        await page.getByRole('button', { name: '產生預覽' }).click();
        await expect(page.getByTestId('import-progress')).toHaveText(
          `處理進度：${OCT_ROWS.toLocaleString('en-US')}／${OCT_ROWS.toLocaleString('en-US')} 筆`,
          { timeout: STEP_TIMEOUT },
        );
        await expect(page.getByTestId('oct-overview')).toContainText(`總數 ${String(OCT_ROWS)}`, {
          timeout: STEP_TIMEOUT,
        });
      });
      results['十月配對筆數'] = oct.matched;
      await measure('十月總表 5,000 筆套用 ms', async () => {
        for (const box of await page
          .getByTestId('import-confirmations')
          .getByRole('checkbox')
          .all()) {
          await box.check();
        }
        await page.getByRole('button', { name: '套用這份總表' }).click();
        await expect(page.getByTestId('import-history')).toContainText(oct.fileName, {
          timeout: STEP_TIMEOUT,
        });
      });
      results['結束時記憶體 MB'] = (await heapMegabytes(page)) ?? '—';

      console.log(`[perf] ${formatCount(size)}\n${JSON.stringify(results, null, 2)}`);
      await testInfo.attach(`perf-${String(size)}.json`, {
        body: JSON.stringify(results, null, 2),
        contentType: 'application/json',
      });
      writeFileSync(
        resolve(GENERATED, `perf-${String(size)}-${testInfo.project.name}.json`),
        JSON.stringify(results, null, 2),
      );
    });
  }
});
