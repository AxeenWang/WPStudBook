import { isGameTiming, type GameTiming, type ImportType } from '../core/imports'

/** 從檔名讀出的年、時點與預選的類型（需求規格 11.1） */
export interface ImportFileName {
  year: number
  timing: GameTiming
  /** 依類型名稱預選的類型；認不出時留空，由使用者選 */
  type: ImportType | null
}

/** 檔名開頭的「YYYY年 M月W週」（`年` 與月份之間的空白可有可無），後面接 `_` 或 `._` 與類型名稱（附錄 A） */
const NAME_PATTERN = /^(\d{4})年 ?(\d{1,2})月(\d)週(\.?_)?/

/** 繁殖牝馬格式依月份預選：五月繁殖圈名單、七月受胎名單、十月全世界繁殖牝馬總表 */
const BROODMARE_TYPES: Partial<Record<number, ImportType>> = {
  5: 'may-herd',
  7: 'july-conception',
  10: 'october-mares',
}

/**
 * 解析匯出檔的檔名（需求規格 11.1、技術設計 4.4「解析」）：開頭是「YYYY年 M月W週」時回傳年與時點，
 * 並依 `_` 或 `._` 之後的類型名稱預選類型。開頭不符、月不在 1～12 或週不在 1～4 時回傳 null，
 * 由使用者選類型並輸入年份（IMP-03）。
 */
export function parseImportFileName(fileName: string): ImportFileName | null {
  const match = NAME_PATTERN.exec(fileName)
  if (match === null) return null
  const timing = { month: Number(match[2]), week: Number(match[3]) }
  if (!isGameTiming(timing)) return null
  const typeName = match[4] === undefined ? '' : fileName.slice(match[0].length)
  return { year: Number(match[1]), timing, type: presetType(typeName, timing.month) }
}

/**
 * 依類型名稱預選類型；名稱後面可以有其他文字（例如另存時加上的「 (2)」）。
 * 候選 TXT 與目標種牡馬 TXT 沒有樣本（需求規格 Q-03），不預選
 */
function presetType(typeName: string, month: number): ImportType | null {
  if (typeName.startsWith('二歲新馬')) return 'january-two-year-olds'
  if (typeName.startsWith('幼駒誕生')) return 'april-foals'
  if (typeName.startsWith('種牡馬')) return 'stallion-list'
  if (typeName.startsWith('繁殖牝馬')) return BROODMARE_TYPES[month] ?? null
  return null
}
