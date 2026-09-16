import type { ImportType } from '../domain/import-type.ts';
import type { Timing } from '../domain/timing.ts';

/** 檔名解析結果（需求規格 11.1、IMP-02）：類型只是預選，仍由使用者確認。 */
export interface FileNameHint {
  readonly gameYear: number;
  readonly timing: Timing;
  readonly label: string;
  readonly importType: ImportType | undefined;
}

/** 開頭的「`YYYY年 M月W週`」；`年` 與月份之間的空白可有可無（需求規格 11.1）。 */
const TIMING_PREFIX = /^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})週/u;
const EXTENSION = /\.[^.]*$/u;
const LABEL_SEPARATORS = /^[._]+/u;

const MONTH_MAX = 12;
const WEEK_MAX = 5;

function labelOf(fileName: string, matched: string): string {
  return fileName.slice(matched.length).replace(EXTENSION, '').replace(LABEL_SEPARATORS, '');
}

/**
 * 依檔名的類型名稱預選匯入類型。同格式的檔案靠時點分辨（繁殖牝馬總表有五月、七月與十月三種），
 * 分不出來時不猜，交給使用者選（需求規格 11.1、IMP-03）。候選 TXT 與目標種牡馬 TXT 由使用者命名，
 * 沒有固定的類型名稱。
 */
function importTypeFor(label: string, timing: Timing): ImportType | undefined {
  if (label.includes('二歲新馬') || label.includes('二歳新馬')) {
    return 'jan2yo';
  }
  if (label.includes('幼駒誕生')) {
    return 'aprFoals';
  }
  if (label.includes('種牡馬')) {
    return timing.month === 5 ? 'mayStallions' : undefined;
  }
  if (label.includes('繁殖牝馬')) {
    switch (timing.month) {
      case 5:
        return 'mayMares';
      case 7:
        return 'julMares';
      case 10:
        return 'octWorldMares';
      default:
        return undefined;
    }
  }
  return undefined;
}

/** 解析匯入檔名；開頭不是「`YYYY年 M月W週`」或月週超出範圍時回傳 undefined，不從其他地方猜測。 */
export function parseImportFileName(fileName: string): FileNameHint | undefined {
  const matched = TIMING_PREFIX.exec(fileName);
  if (matched === null) {
    return undefined;
  }
  const [whole, year, month, week] = matched;
  const timing: Timing = { month: Number(month), week: Number(week) };
  if (timing.month < 1 || timing.month > MONTH_MAX || timing.week < 1 || timing.week > WEEK_MAX) {
    return undefined;
  }
  const label = labelOf(fileName, whole);
  return { gameYear: Number(year), timing, label, importType: importTypeFor(label, timing) };
}
