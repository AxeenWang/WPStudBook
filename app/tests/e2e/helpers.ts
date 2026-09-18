import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, type Locator, type Page } from '@playwright/test';

export const APP_URL = pathToFileURL(resolve('dist/WPStudBook.html')).href;

export async function openApp(page: Page): Promise<void> {
  await page.goto(APP_URL);
  await expect(page.getByTestId('status-game')).toBeVisible();
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
 * 關閉詳情欄並等它真的消失。只按 Esc 就繼續操作時，`.drawer-overlay` 還在的話會攔截點擊，
 * 是與速度相依的競態（main 推送 CI 的 Edge 曾因此失敗）。
 *
 * Esc 一律按在詳情欄本身而不是 `page.keyboard`：`page.keyboard.press` 送到的是目前焦點所在的
 * 元素，而詳情欄裡的表單送出後會整個卸載，焦點會落回 `body`。react-aria 的焦點收容會把焦點拉
 * 回對話框，但那是非同步的，中間那一瞬間按下的 Esc 就消失了——Edge 上真的發生過（PR #17 合併
 * 後 main 的推送 CI）。`locator.press` 會先聚焦再送鍵，鍵一定落在對話框內。
 */
export async function closeDrawer(drawer: Locator): Promise<void> {
  await expect(drawer).toBeVisible();
  await drawer.press('Escape');
  await expect(drawer).toBeHidden();
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
