import type { Aptitude, SubParamGrade, SubParams } from '../domain/foal.ts';
import { APTITUDES, SUB_PARAM_KEYS } from '../domain/foal.ts';
import { RACE_RECORD_KEYS, type StallionRaceRecord } from '../domain/stallion-yearly.ts';
import { STALLION_COLUMNS } from './columns.ts';
import { cell, type SourceRow } from './parse.ts';
import {
  isPrefixOnlyName,
  optionalText,
  parseHexNo,
  parseInteger,
  parseSubParamGrade,
  stripSystemSuffix,
} from './values.ts';

/**
 * 種牡馬總表的一列（附錄 A.4）：五月種牡馬總表與目標種牡馬 TXT 共用這個格式。
 * 只做欄位讀取與規格點名的正規化，不判斷身分、不決定用途。
 */
export interface StallionValues {
  readonly lineNumber: number;
  readonly fullName: string | undefined;
  readonly baseName: string | undefined;
  readonly country: string | undefined;
  /** `年` 欄是馬齡，不是年份；出生年由匯出年推算（需求規格 6.3、11.8）。 */
  readonly age: number | undefined;
  readonly sp: number | undefined;
  readonly st: number | undefined;
  readonly subParams: SubParams;
  readonly subParamTotal: number | undefined;
  readonly kodashi: number | undefined;
  readonly turf: Aptitude | undefined;
  readonly dirt: Aptitude | undefined;
  readonly distanceText: string | undefined;
  readonly sireName: string | undefined;
  readonly sireSubsystem: string | undefined;
  readonly damName: string | undefined;
  /** 牝系名稱；空白視為未取得而不是「不屬於具名牝系」（需求規格 8.8，同繁殖牝馬總表）。 */
  readonly femaleLine: string | undefined;
  readonly studFee: number | undefined;
  readonly record: StallionRaceRecord;
  /**
   * 繋養牧場番号；種牡馬總表不套用範圍檢查（需求規格 11.8、Q-07），
   * 因為可能是任何牧場的番号，包含尚未取得樣本的自家種牡馬廄舍。
   */
  readonly farmNo: number | undefined;
  readonly active: string | undefined;
  readonly abilityNo: number | undefined;
  readonly horseNo: number | undefined;
}

function text(row: SourceRow, position: number): string | undefined {
  return optionalText(cell(row, position));
}

function aptitude(row: SourceRow, position: number): Aptitude | undefined {
  const value = cell(row, position)?.trim();
  return APTITUDES.find((item) => item === value);
}

function readSubParams(row: SourceRow): SubParams {
  const values: Record<string, SubParamGrade> = {};
  for (const key of SUB_PARAM_KEYS) {
    const grade = parseSubParamGrade(cell(row, STALLION_COLUMNS[key]));
    if (grade !== undefined) {
      values[key] = grade;
    }
  }
  return values;
}

function readRecord(row: SourceRow): StallionRaceRecord {
  const values: Record<string, number> = {};
  for (const key of RACE_RECORD_KEYS) {
    const value = parseInteger(cell(row, STALLION_COLUMNS[key]));
    // 未知值不是零值（設計決策 5.3）：沒有值的欄位不放進紀錄。
    if (value !== undefined) {
      values[key] = value;
    }
  }
  return values;
}

export function readStallionRow(row: SourceRow): StallionValues {
  const columns = STALLION_COLUMNS;
  return {
    lineNumber: row.lineNumber,
    fullName: text(row, columns.name),
    baseName: text(row, columns.baseName),
    country: text(row, columns.country),
    age: parseInteger(cell(row, columns.age)),
    sp: parseInteger(cell(row, columns.sp)),
    st: parseInteger(cell(row, columns.st)),
    subParams: readSubParams(row),
    subParamTotal: parseInteger(cell(row, columns.subParamTotal)),
    kodashi: parseInteger(cell(row, columns.kodashi)),
    turf: aptitude(row, columns.turf),
    dirt: aptitude(row, columns.dirt),
    distanceText: text(row, columns.distance),
    sireName: text(row, columns.sire),
    sireSubsystem: stripSystemSuffix(cell(row, columns.sireSystem)),
    damName: text(row, columns.dam),
    femaleLine: text(row, columns.femaleLine),
    studFee: parseInteger(cell(row, columns.studFee)),
    record: readRecord(row),
    farmNo: parseInteger(cell(row, columns.farm)),
    active: text(row, columns.active),
    abilityNo: parseHexNo(cell(row, columns.abilityNo)),
    horseNo: parseHexNo(cell(row, columns.horseNo)),
  };
}

/** 只有 `(外)`、`[地]` 前綴而沒有馬名時是資料異常，匯入時警告並略過該筆（需求規格 6.4）。 */
export function hasPrefixOnlyName(values: StallionValues): boolean {
  return isPrefixOnlyName(values.fullName);
}
