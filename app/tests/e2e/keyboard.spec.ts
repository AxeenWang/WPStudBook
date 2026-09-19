import { expect, test, type Locator, type Page } from '@playwright/test';
import { createGameViaUi, gotoPage, openApp, openFirstLineViaUi } from './helpers.ts';

/**
 * 主要表單只用鍵盤完成（需求規格 13.5、UI-05）：只按 Tab、Shift+Tab、方向鍵、Space、Enter 與輸入文字，
 * 不點滑鼠、不以程式移動焦點。送出錯誤時焦點移到第一個錯誤欄位，欄位標示 aria-invalid，
 * 錯誤訊息是欄位的可及描述；表單上方的錯誤摘要是表單的可及描述。
 */

/** 按 Tab（目標在焦點之前時按 Shift+Tab）直到焦點落在目標上；到不了就失敗。 */
async function tabTo(page: Page, target: Locator, max = 80): Promise<void> {
  const before = await target.evaluate((element) => {
    const active = document.activeElement;
    if (active === null || active === document.body) {
      return false;
    }
    return Boolean(element.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  const key = before ? 'Shift+Tab' : 'Tab';
  for (let count = 0; count < max; count += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) {
      return;
    }
    await page.keyboard.press(key);
  }
  await expect(target).toBeFocused();
}

/** 取代欄位內容：全選後輸入。 */
async function typeInto(page: Page, text: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(text);
}

async function expectFieldError(field: Locator, message: string | RegExp): Promise<void> {
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAccessibleDescription(message);
}

test.describe('只用鍵盤完成主要表單', () => {
  test('[UI-05] 建立遊戲局與更新遊戲年：錯誤時焦點移到欄位並與欄位建立關聯，修正後完成', async ({
    page,
  }) => {
    await openApp(page);
    const create = page.getByRole('form', { name: '建立遊戲局' });
    const name = create.getByLabel('遊戲局名稱');
    const startYear = create.getByLabel('起始年');
    const submit = create.getByRole('button', { name: '建立遊戲局' });

    await tabTo(page, submit);
    await page.keyboard.press('Enter');
    await expect(name).toBeFocused();
    await expectFieldError(name, '請輸入遊戲局名稱');
    await expect(create).toHaveAccessibleDescription('請輸入遊戲局名稱');

    await page.keyboard.type('鍵盤局');
    await tabTo(page, startYear);
    await typeInto(page, '99');
    await tabTo(page, submit);
    await page.keyboard.press('Enter');
    await expect(startYear).toBeFocused();
    await expectFieldError(startYear, '年份必須是 1000～9999 的整數');
    await expect(name).not.toHaveAttribute('aria-invalid', 'true');

    await typeInto(page, '1970');
    await tabTo(page, submit);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('status-game')).toHaveText('鍵盤局');

    const yearForm = page.getByRole('form', { name: '目前遊戲年' });
    const nextYear = yearForm.getByLabel('新的目前遊戲年');
    const update = yearForm.getByRole('button', { name: '更新遊戲年' });
    await tabTo(page, nextYear);
    await typeInto(page, '1970');
    await tabTo(page, update);
    await page.keyboard.press('Enter');
    await expect(nextYear).toBeFocused();
    await expectFieldError(nextYear, '目前遊戲年已經是 1970 年');

    await typeInto(page, '1971');
    await tabTo(page, update);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: '確認更新目前遊戲年' });
    await expect(dialog).toBeVisible();
    await tabTo(page, dialog.getByRole('button', { name: '確認更新' }));
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('status-year')).toHaveText('1971 年');
  });

  test('[UI-05] 手動新增母馬：多個欄位錯誤各自與欄位建立關聯，焦點移到第一個；修正後完成', async ({
    page,
  }) => {
    await openApp(page);
    await createGameViaUi(page, '鍵盤母馬局');
    await openFirstLineViaUi(page);
    await gotoPage(page, '母馬群');
    const herd = page.getByRole('region', { name: '繁殖牝馬群' });
    await tabTo(page, herd.getByRole('button', { name: '手動新增' }));
    await page.keyboard.press('Enter');

    const form = herd.getByRole('form', { name: '手動新增母馬' });
    const generation = form.getByLabel('母馬群的代數（0＝第 1 系起點）');
    const name = form.getByLabel('馬名', { exact: true });
    const site = form.getByLabel('據點');
    const submit = form.getByRole('button', { name: '新增母馬' });

    await tabTo(page, submit);
    await page.keyboard.press('Enter');
    await expectFieldError(name, '請輸入馬名');
    await expectFieldError(site, '請選擇據點');
    await expect(form.locator('[aria-invalid="true"]').first()).toBeFocused();

    await tabTo(page, generation);
    await typeInto(page, '0');
    await tabTo(page, name);
    await page.keyboard.type('テストキーボード');
    await tabTo(page, site);
    await page.keyboard.press('ArrowDown');
    await expect(site.locator('option:checked')).toHaveText('日本');
    await tabTo(page, submit);
    await page.keyboard.press('Enter');
    await expect(herd.getByRole('article', { name: 'テストキーボード' })).toBeVisible();
  });

  test('[UI-05] 遊戲局設定與系統對照表：錯誤欄位與訊息建立關聯，修正後完成', async ({ page }) => {
    await openApp(page);
    await createGameViaUi(page, '鍵盤設定局');

    const settings = page.getByRole('form', { name: '遊戲局設定' });
    const retirement = settings.getByLabel('定年');
    const save = settings.getByRole('button', { name: '保存設定' });
    await tabTo(page, retirement);
    await typeInto(page, '0');
    await tabTo(page, save);
    await page.keyboard.press('Enter');
    await expect(retirement).toBeFocused();
    await expectFieldError(retirement, /^定年必須是 1～/);
    await typeInto(page, '24');
    await tabTo(page, save);
    await page.keyboard.press('Enter');
    await expect(settings.getByRole('status')).toHaveText('已保存設定');
    await expect(retirement).not.toHaveAttribute('aria-invalid', 'true');

    await tabTo(
      page,
      page
        .getByRole('navigation', { name: '主要頁面' })
        .getByRole('button', { name: '系統對照表' }),
    );
    await page.keyboard.press('Enter');
    const map = page.getByRole('form', { name: '新增或更新對照' });
    const subsystem = map.getByLabel('子系統');
    const parent = map.getByLabel('親系統');
    const saveMap = map.getByRole('button', { name: '保存對照' });
    await tabTo(page, saveMap);
    await page.keyboard.press('Enter');
    await expect(subsystem).toBeFocused();
    await expectFieldError(subsystem, '請輸入子系統');
    await expectFieldError(parent, '請輸入親系統');
    await page.keyboard.type('ナスルーラ');
    await tabTo(page, parent);
    await page.keyboard.type('ネアルコ');
    await tabTo(page, saveMap);
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('table', { name: '系統對照表' }).getByRole('row', { name: /ナスルーラ/ }),
    ).toBeVisible();
  });

  test('[UI-05] 詳情欄的配種登記：以方向鍵切換頁籤，種牡馬錯誤與欄位建立關聯，改登記空胎後完成', async ({
    page,
  }) => {
    await openApp(page);
    await createGameViaUi(page, '鍵盤配種局');
    await openFirstLineViaUi(page);
    await gotoPage(page, '母馬群');
    const herd = page.getByRole('region', { name: '繁殖牝馬群' });
    await tabTo(page, herd.getByRole('button', { name: '手動新增' }));
    await page.keyboard.press('Enter');
    const addForm = herd.getByRole('form', { name: '手動新增母馬' });
    await tabTo(page, addForm.getByLabel('母馬群的代數（0＝第 1 系起點）'));
    await typeInto(page, '0');
    await tabTo(page, addForm.getByLabel('馬名', { exact: true }));
    await page.keyboard.type('テストハイゴウ');
    await tabTo(page, addForm.getByLabel('據點'));
    await page.keyboard.press('ArrowDown');
    await tabTo(page, addForm.getByRole('button', { name: '新增母馬' }));
    await page.keyboard.press('Enter');
    const card = herd.getByRole('article', { name: 'テストハイゴウ' });
    await expect(card).toBeVisible();

    await tabTo(page, card.getByRole('button', { name: 'テストハイゴウ', exact: true }));
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog', { name: '「テストハイゴウ」詳情' });
    await expect(drawer).toBeVisible();
    await tabTo(page, drawer.getByRole('tab', { name: '概要' }));
    await page.keyboard.press('ArrowRight');
    await expect(drawer.getByRole('tab', { name: '配種' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    const breeding = drawer.getByRole('form', { name: '登記繁殖紀錄' });
    const stallion = breeding.getByLabel('種牡馬', { exact: true });
    const conception = breeding.getByLabel('受胎狀態');
    const save = breeding.getByRole('button', { name: '保存繁殖紀錄' });
    // 預設帶入第 1 系的種牡馬；改成「不選（空胎）」而受胎狀態仍未登記時，送出應指出種牡馬欄位。
    await tabTo(page, stallion);
    await page.keyboard.press('ArrowUp');
    await expect(stallion.locator('option:checked')).toHaveText('不選（空胎）');
    await tabTo(page, save);
    await page.keyboard.press('Enter');
    await expect(stallion).toBeFocused();
    await expectFieldError(stallion, '請選擇或填寫種牡馬（沒有進行受胎作業時登記為空胎）');

    await tabTo(page, conception);
    await page.keyboard.press('ArrowDown');
    await expect(conception.locator('option:checked')).toHaveText('空胎');
    await tabTo(page, save);
    await page.keyboard.press('Enter');
    await expect(breeding.getByRole('status')).toContainText('空胎');
    await expect(stallion).not.toHaveAttribute('aria-invalid', 'true');
  });

  test('[UI-05] 年度匯入：以鍵盤選檔並產生預覽；檔案停止套用的錯誤與「產生預覽」按鈕建立關聯', async ({
    page,
  }) => {
    await openApp(page);
    await createGameViaUi(page, '鍵盤匯入局');
    await tabTo(
      page,
      page.getByRole('navigation', { name: '主要頁面' }).getByRole('button', { name: '年度匯入' }),
    );
    await page.keyboard.press('Enter');

    const input = page.getByLabel('選擇匯入檔（也可以把檔案拖放到這裡）');
    await tabTo(page, input);
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Space');
    await (
      await chooser
    ).setFiles({
      name: '1968年 5月1週_繁殖牝馬.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not a stud book export'),
    });
    const preview = page.getByRole('button', { name: '產生預覽' });
    await tabTo(page, preview);
    await page.keyboard.press('Enter');
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(preview).toHaveAccessibleDescription((await alert.textContent()) ?? '');
  });
});
