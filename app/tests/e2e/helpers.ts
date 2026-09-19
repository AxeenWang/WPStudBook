import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, type Locator, type Page } from '@playwright/test';

export const APP_URL = pathToFileURL(resolve('dist/WPStudBook.html')).href;

/**
 * 第一次畫面出現最多等 20 秒，之後的斷言照預設 5 秒。
 *
 * GitHub Actions 的 Windows 環境裡，每個 worker 的第一個測試都要 6～11 秒（之後每個約 1～1.5 秒），
 * 多出來的是冷啟動的瀏覽器第一次載入頁面。PR #25 合併後 main 的推送 CI，Chrome 第一個測試的
 * 狀態列超過 5 秒才出現而失敗，同樣內容的 PR CI 則通過。這裡驗的是程式能開啟，不是冷啟動速度；
 * 啟動時間由階段 5 的效能量測另外記錄。
 */
export async function openApp(page: Page): Promise<void> {
  await page.goto(APP_URL);
  await expect(page.getByTestId('status-game')).toBeVisible({ timeout: 20_000 });
}

export async function createGameViaUi(page: Page, name: string, startYear = 1968): Promise<void> {
  const form = page.getByRole('form', { name: '建立遊戲局' });
  await form.getByLabel('遊戲局名稱').fill(name);
  const year = form.getByLabel('起始年');
  await year.fill(String(startYear));
  await year.blur();
  await form.getByRole('button', { name: '建立遊戲局' }).click();
  await expect(page.getByTestId('status-game')).toHaveText(name);
}

export async function changeYearViaUi(page: Page, year: number): Promise<void> {
  const form = page.getByRole('form', { name: '目前遊戲年' });
  const input = form.getByLabel('新的目前遊戲年');
  await input.fill(String(year));
  await input.blur();
  await form.getByRole('button', { name: '更新遊戲年' }).click();
  await page
    .getByRole('dialog', { name: '確認更新目前遊戲年' })
    .getByRole('button', { name: '確認更新' })
    .click();
  await expect(page.getByTestId('status-year')).toHaveText(`${String(year)} 年`);
}

/**
 * 關閉詳情欄並等它真的消失（沒等就繼續操作的話，`.drawer-overlay` 會攔截之後的點擊）。
 *
 * 用「關閉」鈕而不是 Esc。這裡的呼叫點幾乎都是剛在詳情欄裡送出表單：資料改變會讓詳情欄重新
 * 載入，react-aria 的 Esc 關閉要經過鍵盤事件路由與「這個 overlay 是不是最上層」的判斷，重新
 * 渲染的那一瞬間按下的 Esc 就可能被吞掉。PR #17 與 PR #20 合併後 main 的推送 CI 各掛過一次；
 * 第一次改成把 Esc 按在對話框上（`locator.press`）只修到焦點那一半，第二次照樣發生。
 * 「關閉」鈕直接呼叫 `close()`，不經過那些判斷；再用 `toPass` 包起來，點擊剛好落在重新渲染時
 * 會重試。Esc 能關閉詳情欄（UI-02）由 `mare-detail.spec.ts` 另外直接驗，那裡前面沒有資料變動。
 */
export async function closeDrawer(drawer: Locator): Promise<void> {
  await expect(drawer).toBeVisible();
  await expect(async () => {
    if (await drawer.isVisible()) {
      await drawer.getByRole('button', { name: '關閉' }).click({ timeout: 2000 });
    }
    await expect(drawer).toBeHidden({ timeout: 2000 });
  }).toPass({ timeout: 10_000 });
}

export async function gotoPage(page: Page, name: string): Promise<void> {
  const button = page
    .getByRole('navigation', { name: '主要頁面' })
    .getByRole('button', { name, exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-current', 'page');
}

/** 系位置由總覽的任務看板開啟（需求規格 7.3、13.2）。 */
export async function openLineViaUi(
  page: Page,
  position: number,
  subsystem: string,
  founderName: string,
): Promise<void> {
  await gotoPage(page, '總覽');
  const heading = `開啟第 ${String(position)} 系`;
  const board = page.getByRole('region', { name: '任務看板' });
  const trigger = board.getByRole('button', { name: heading });
  if ((await trigger.count()) > 0) {
    await trigger.first().click();
  }
  const form = page.getByRole('form', { name: heading });
  await form.getByLabel('目前子系統').fill(subsystem);
  await form.getByLabel('親系統', { exact: true }).fill(subsystem);
  await form.getByLabel('零代市場種牡馬馬名').fill(founderName);
  await form.getByRole('button', { name: heading }).click();
  await expect(page.getByTestId(`overview-line-${String(position)}`)).toContainText(subsystem);
}

export async function openFirstLineViaUi(page: Page): Promise<void> {
  await openLineViaUi(page, 1, 'ネアルコ', 'テストシュボバ');
  await gotoPage(page, '八系');
  await expect(page.getByTestId('line-slot-1')).toContainText('テストシュボバ');
}

export interface MareUiInput {
  readonly position: number;
  readonly generation: number;
  readonly name: string;
  /** 據點的介面文字，例如「日本」。 */
  readonly site: string;
  readonly birthYear?: number;
  readonly sireSubsystem?: string;
  /** 來源的介面文字；省略時使用表單預設。 */
  readonly origin?: string;
}

/** 在母馬群頁開啟「手動新增」並送出；需要確認的警告由呼叫端處理。 */
export async function addMareViaUi(page: Page, input: MareUiInput): Promise<void> {
  const region = page.getByRole('region', { name: '繁殖牝馬群' });
  await region.getByRole('button', { name: '手動新增' }).click();
  const form = region.getByRole('form', { name: '手動新增母馬' });
  await form.getByLabel('母馬群的系').selectOption({ label: `第 ${String(input.position)} 系` });
  const generation = form.getByLabel('母馬群的代數（0＝第 1 系起點）');
  await generation.fill(String(input.generation));
  await generation.blur();
  await form.getByLabel('馬名', { exact: true }).fill(input.name);
  if (input.birthYear !== undefined) {
    const year = form.getByLabel('出生年（選填）');
    await year.fill(String(input.birthYear));
    await year.blur();
  }
  if (input.sireSubsystem !== undefined) {
    await form.getByLabel('自身父系（選填）').fill(input.sireSubsystem);
  }
  await form.getByLabel('據點').selectOption({ label: input.site });
  if (input.origin !== undefined) {
    await form.getByLabel('來源', { exact: true }).selectOption({ label: input.origin });
  }
  await form.getByRole('button', { name: '新增母馬' }).click();
}
