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
