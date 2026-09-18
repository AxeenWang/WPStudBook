import type { Sex } from '../domain/horse.ts';
import { parseSex } from './apr-foal.ts';
import { JAN2YO_COLUMNS } from './columns.ts';
import { cell, type SourceRow } from './parse.ts';
import { optionalText, parseHexNo, parseInteger } from './values.ts';

/**
 * 一月二歲馬總表的一列（附錄 A.1）。只讀一月匯入用得到的欄位：馬名、身分與父母。
 *
 * 第 1 欄與第 77 欄的欄名都是 `馬名`，依位置讀取（需求規格 11.1、JAN-06）。
 * 第 73 欄史実番号 `0x7FFF` 不作為識別（需求規格 11.3、JAN-07），所以不讀。
 */
export interface Jan2yoValues {
  readonly lineNumber: number;
  /** 第 1 欄：完整馬名。 */
  readonly fullName: string | undefined;
  /** 第 77 欄：基本馬名。 */
  readonly baseName: string | undefined;
  /** `年` 欄；一月總表必須全部是 2（附錄 A.1）。 */
  readonly age: number | undefined;
  readonly sex: Sex | undefined;
  readonly sireName: string | undefined;
  readonly damName: string | undefined;
  readonly abilityNo: number | undefined;
  /** 競走馬馬番号（需求規格 6.4、JAN-05）。 */
  readonly horseNo: number | undefined;
}

function text(row: SourceRow, position: number): string | undefined {
  return optionalText(cell(row, position));
}

export function readJan2yoRow(row: SourceRow): Jan2yoValues {
  const columns = JAN2YO_COLUMNS;
  return {
    lineNumber: row.lineNumber,
    fullName: text(row, columns.name),
    baseName: text(row, columns.baseName),
    age: parseInteger(cell(row, columns.age)),
    sex: parseSex(cell(row, columns.sex)),
    sireName: text(row, columns.sire),
    damName: text(row, columns.dam),
    abilityNo: parseHexNo(cell(row, columns.abilityNo)),
    horseNo: parseHexNo(cell(row, columns.horseNo)),
  };
}
