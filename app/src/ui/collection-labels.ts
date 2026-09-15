/** 備份資料表的介面名稱（設計決策第 6 節）。 */
export const COLLECTION_LABELS: Readonly<Record<string, string>> = {
  gameSettings: '設定',
  lines: '系位置',
  systemMap: '系統對照表',
  horses: '馬匹',
  mares: '繁殖牝馬',
  stallionDuties: '種牡馬任期',
  mareYearly: '繁殖牝馬年度資料',
  stallionYearly: '種牡馬年度資料',
  breedings: '年度繁殖紀錄',
  matingRatings: '配種評價',
  foals: '產駒',
  recoveries: '斷血補系',
  imports: '匯入批次',
  events: '事件',
};
