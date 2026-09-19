import type { CSSProperties } from 'react';

/**
 * 系代表色的樣式：左邊框與 CSS 變數 `--line-color`，版面用它畫出系的勝負服色塊。
 * 尚未開啟的系沒有代表色，回傳 undefined。
 */
export function lineColorStyle(color: string | undefined): CSSProperties | undefined {
  if (color === undefined) {
    return undefined;
  }
  // CSSProperties 沒有列出自訂屬性，以型別斷言加上 --line-color。
  return { borderLeftColor: color, '--line-color': color } as CSSProperties;
}
