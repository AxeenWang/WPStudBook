import type { Aptitude, SubParams } from '../domain/foal.ts';
import { APTITUDES, SUB_PARAM_KEYS } from '../domain/foal.ts';
import type { Sex } from '../domain/horse.ts';
import { APR_FOALS_COLUMNS } from './columns.ts';
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
 * 四月誕生幼駒總表的一列（附錄 A.2）。只做欄位讀取與規格點名的正規化：
 * `SP` 與 `サ` 帶括號附加值時取括號前主值（需求規格 11.1、APR-06），
 * 距離適性保存原文（9.3、BRD-14）。不判斷身分、不決定用途。
 */
export interface AprFoalValues {
  readonly lineNumber: number;
  /** 「母馬名の0歳」形式；不是正式馬名（需求規格 11.4）。 */
  readonly fullName: string | undefined;
  readonly baseName: string | undefined;
  /** `年` 欄；四月總表必須全部是 0（需求規格 11.4、APR-01）。 */
  readonly age: number | undefined;
  readonly sex: Sex | undefined;
  /** `性` 欄原文；不是 `牡`／`牝` 時整份停止。 */
  readonly sexText: string | undefined;
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
  readonly femaleLine: string | undefined;
  readonly ownerNo: number | undefined;
  readonly farmNo: number | undefined;
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
  const values: Record<string, NonNullable<SubParams[keyof SubParams]>> = {};
  for (const key of SUB_PARAM_KEYS) {
    const grade = parseSubParamGrade(cell(row, APR_FOALS_COLUMNS[key]));
    if (grade !== undefined) {
      values[key] = grade;
    }
  }
  return values;
}

/** `性` 欄：`牡` 為公、`牝` 為牝；其他文字讓整份停止（需求規格 11.4）。 */
export function parseSex(raw: string | undefined): Sex | undefined {
  const value = raw?.trim();
  if (value === '牡') {
    return 'male';
  }
  return value === '牝' ? 'female' : undefined;
}

export function readAprFoalRow(row: SourceRow): AprFoalValues {
  const columns = APR_FOALS_COLUMNS;
  const sexText = text(row, columns.sex);
  return {
    lineNumber: row.lineNumber,
    fullName: text(row, columns.name),
    baseName: text(row, columns.baseName),
    age: parseInteger(cell(row, columns.age)),
    sex: parseSex(sexText),
    sexText,
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
    ownerNo: parseInteger(cell(row, columns.owner)),
    farmNo: parseInteger(cell(row, columns.farm)),
    abilityNo: parseHexNo(cell(row, columns.abilityNo)),
    horseNo: parseHexNo(cell(row, columns.horseNo)),
  };
}

/** 只有 `(外)`、`[地]` 前綴而沒有馬名時是資料異常（需求規格 6.4）。 */
export function hasPrefixOnlyName(values: AprFoalValues): boolean {
  return isPrefixOnlyName(values.fullName);
}
