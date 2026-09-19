export type PageKey = 'overview' | 'lines' | 'mares' | 'foals' | 'imports' | 'systemMap' | 'data';

export interface PageInfo {
  readonly key: PageKey;
  readonly label: string;
  /** 側欄的圖示，只是視覺提示，按鈕名稱仍是 label。 */
  readonly icon: string;
}

/** 側欄分組：日常照顧八系與馬匹，其餘是匯入與資料維護。 */
export const PAGE_GROUPS: ReadonlyArray<{
  readonly label: string;
  readonly pages: readonly PageInfo[];
}> = [
  {
    label: '八系繁殖',
    pages: [
      { key: 'overview', label: '總覽', icon: '⌂' },
      { key: 'lines', label: '八系', icon: '⑧' },
      { key: 'mares', label: '母馬群', icon: '♞' },
      { key: 'foals', label: '產駒', icon: '♘' },
    ],
  },
  {
    label: '資料',
    pages: [
      { key: 'imports', label: '年度匯入', icon: '⇩' },
      { key: 'systemMap', label: '系統對照表', icon: '☰' },
      { key: 'data', label: '資料管理', icon: '⚙' },
    ],
  },
];

export function pageLabel(key: PageKey): string {
  for (const group of PAGE_GROUPS) {
    const page = group.pages.find((item) => item.key === key);
    if (page !== undefined) {
      return page.label;
    }
  }
  return key;
}
