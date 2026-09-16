import type { Vitality } from '../domain/mare-yearly.ts';
import { BROODMARE_COLUMNS } from './columns.ts';
import { cell, type SourceRow } from './parse.ts';
import {
  isPrefixOnlyName,
  optionalText,
  parseHexNo,
  parseInteger,
  parseVitality,
  stripSystemSuffix,
} from './values.ts';

/**
 * 繁殖牝馬總表的一列（附錄 A.3）：五月、七月、十月與候選 TXT 共用這個格式。
 * 只做欄位讀取與規格點名的正規化，不判斷身分、不決定用途。
 */
export interface BroodmareValues {
  readonly lineNumber: number;
  readonly fullName: string | undefined;
  readonly baseName: string | undefined;
  readonly country: string | undefined;
  /** `年` 欄是馬齡，不是年份；出生年由匯出年推算（需求規格 6.3）。 */
  readonly age: number | undefined;
  readonly sp: number | undefined;
  readonly st: number | undefined;
  readonly subParamTotal: number | undefined;
  readonly kodashi: number | undefined;
  readonly turf: string | undefined;
  readonly dirt: string | undefined;
  readonly distanceText: string | undefined;
  readonly vitality: Vitality | undefined;
  readonly breedingYears: number | undefined;
  readonly breedingCount: number | undefined;
  readonly sireName: string | undefined;
  readonly sireSubsystem: string | undefined;
  readonly damName: string | undefined;
  /**
   * 牝系名稱；空白視為未取得而不是「不屬於具名牝系」（需求規格 8.8）。匯出檔的空白欄分不出
   * 這兩件事，猜成「不屬於具名牝系」會寫進一個使用者沒說過的結論。
   */
  readonly femaleLine: string | undefined;
  readonly farmNo: number | undefined;
  readonly status: string | undefined;
  readonly matedStallionName: string | undefined;
  readonly abilityNo: number | undefined;
  readonly horseNo: number | undefined;
}

/** `状態` 的四個有效值（附錄 A.3）；其他文字讓整份停止（需求規格 11.6）。 */
export const CONCEPTION_STATUSES = ['空胎', '受胎', '不受胎', '未確認'] as const;

function text(row: SourceRow, position: number): string | undefined {
  return optionalText(cell(row, position));
}

export function readBroodmareRow(row: SourceRow): BroodmareValues {
  const columns = BROODMARE_COLUMNS;
  return {
    lineNumber: row.lineNumber,
    fullName: text(row, columns.name),
    baseName: text(row, columns.baseName),
    country: text(row, columns.country),
    age: parseInteger(cell(row, columns.age)),
    sp: parseInteger(cell(row, columns.sp)),
    st: parseInteger(cell(row, columns.st)),
    subParamTotal: parseInteger(cell(row, columns.subParamTotal)),
    kodashi: parseInteger(cell(row, columns.kodashi)),
    turf: text(row, columns.turf),
    dirt: text(row, columns.dirt),
    distanceText: text(row, columns.distance),
    vitality: parseVitality(cell(row, columns.vitality)),
    breedingYears: parseInteger(cell(row, columns.breedingYears)),
    breedingCount: parseInteger(cell(row, columns.breedingCount)),
    sireName: text(row, columns.sire),
    sireSubsystem: stripSystemSuffix(cell(row, columns.sireSystem)),
    damName: text(row, columns.dam),
    femaleLine: text(row, columns.femaleLine),
    farmNo: parseInteger(cell(row, columns.farm)),
    status: text(row, columns.status),
    matedStallionName: text(row, columns.matedStallion),
    abilityNo: parseHexNo(cell(row, columns.abilityNo)),
    horseNo: parseHexNo(cell(row, columns.horseNo)),
  };
}

/** 只有 `(外)`、`[地]` 前綴而沒有馬名時是資料異常，匯入時警告並略過該筆（需求規格 6.4）。 */
export function hasPrefixOnlyName(values: BroodmareValues): boolean {
  return isPrefixOnlyName(values.fullName);
}
