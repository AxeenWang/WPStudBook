import { SUB_PARAM_GRADES, type SubParamGrade } from '../domain/foal.ts';
import { toBaseName } from '../domain/horse.ts';
import { isVitalityValue } from '../domain/mare-yearly.ts';
import type { Vitality } from '../domain/mare-yearly.ts';

const OPENING_BRACKET = /[(（]/u;
const THOUSANDS_SEPARATOR = /,/gu;
const INTEGER = /^[+-]?\d+$/u;
const HEX_NUMBER = /^0x[0-9a-f]{1,8}$/iu;
const SYSTEM_SUFFIX = /系$/u;

/**
 * 欄位內容視為未取得（需求規格 11.1）：只有空白的欄位當成空白，有內容時原樣保留，
 * 因為 `戦績` 等欄位的空白有格式意義，不做全面修剪。
 */
export function optionalText(raw: string | undefined): string | undefined {
  return raw === undefined || raw.trim() === '' ? undefined : raw;
}

/** 數值帶括號附加值時取括號前主值（需求規格 11.1），例如 `72(72)`、`42( +0)`。 */
export function mainValue(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const [head] = raw.split(OPENING_BRACKET);
  return head === undefined ? undefined : head.trim();
}

/** `父系` 去掉結尾「系」保存（需求規格 11.1、IMP-17），例如 `エクリプス系` → `エクリプス`。 */
export function stripSystemSuffix(raw: string | undefined): string | undefined {
  const text = optionalText(raw);
  if (text === undefined) {
    return undefined;
  }
  const stripped = text.trim().replace(SYSTEM_SUFFIX, '');
  return stripped === '' ? undefined : stripped;
}

/** 整數欄位：取括號前主值，去掉千分位逗號（附錄 A 的 `2,450`）；不是整數時為未取得。 */
export function parseInteger(raw: string | undefined): number | undefined {
  const text = mainValue(raw)?.replace(THOUSANDS_SEPARATOR, '');
  if (text === undefined || text === '' || !INTEGER.test(text)) {
    return undefined;
  }
  return Number(text);
}

/**
 * 能力番号與馬番号：`0x` 開頭的十六進位文字（附錄 A）。
 * `0x0000` 是有效值，不是空白或未知（需求規格 11.1、ID-12）。
 */
export function parseHexNo(raw: string | undefined): number | undefined {
  const text = raw?.trim();
  if (text === undefined || !HEX_NUMBER.test(text)) {
    return undefined;
  }
  return Number.parseInt(text, 16);
}

/** 活力（附錄 A.3）：0～100 整數，前置 `*` 表示増強中。 */
export function parseVitality(raw: string | undefined): Vitality | undefined {
  const text = raw?.trim();
  if (text === undefined || text === '') {
    return undefined;
  }
  const boosted = text.startsWith('*');
  const value = parseInteger(boosted ? text.slice(1) : text);
  if (value === undefined || !isVitalityValue(value)) {
    return undefined;
  }
  return { state: 'confirmed', value, boosted };
}

/** 副能力欄：`G`～`S+` 之一（需求規格 4.7）；其他文字視為未取得。 */
export function parseSubParamGrade(raw: string | undefined): SubParamGrade | undefined {
  const text = raw?.trim();
  return SUB_PARAM_GRADES.find((grade) => grade === text);
}

/** 馬名欄：`(外)`、`[地]` 前綴後面一定接著馬名，只有前綴時是資料異常（需求規格 6.4）。 */
export function isPrefixOnlyName(raw: string | undefined): boolean {
  const text = optionalText(raw);
  return text !== undefined && toBaseName(text).trim() === '';
}
