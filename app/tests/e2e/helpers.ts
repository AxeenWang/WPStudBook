import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, type Page } from '@playwright/test';

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

export async function gotoPage(page: Page, name: string): Promise<void> {
  const button = page
    .getByRole('navigation', { name: '主要頁面' })
    .getByRole('button', { name, exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-current', 'page');
}
