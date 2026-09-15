import type { MareStatus } from './mare.ts';

/** 活力三種狀態（需求規格 8.7、設計決策 5.3 節）；0～100 總活力，只有匯入的前置 `*` 才是増強。 */
export type Vitality =
  | { readonly state: 'notApplicable' }
  | { readonly state: 'pending' }
  | { readonly state: 'confirmed'; readonly value: number; readonly boosted: boolean };

export type VitalityMonth = 5 | 7;

/** 設計決策 5.2 節 `mareYearly`：每匹母馬每年一筆，欄位皆選填。 */
export interface MareYearly {
  readonly id: string;
  readonly horseId: string;
  readonly gameYear: number;
  readonly vitalityMay?: Vitality;
  readonly vitalityJuly?: Vitality;
  readonly kodashi?: number;
  readonly breedingYears?: number;
  readonly breedingCount?: number;
}

export const VITALITY_MAX = 100;
export const KODASHI_MAX = 15;
/** 仔出正常 0～10；11～15 是 CE 擴充值但合法（需求規格 4.7、8.8）。 */
export const KODASHI_CE_MIN = 11;
export const BREEDING_TALLY_MAX = 99;

function isIntegerIn(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

export function isVitalityValue(value: number): boolean {
  return isIntegerIn(value, 0, VITALITY_MAX);
}

export function isKodashi(value: number): boolean {
  return isIntegerIn(value, 0, KODASHI_MAX);
}

export function isBreedingTally(value: number): boolean {
  return isIntegerIn(value, 0, BREEDING_TALLY_MAX);
}

export function isCeExtendedKodashi(kodashi: number): boolean {
  return kodashi >= KODASHI_CE_MIN;
}

export interface VitalityReading {
  readonly vitality: Vitality;
  readonly month: VitalityMonth | undefined;
}

/**
 * 卡片與篩選使用的活力（2026-09-15 使用者裁定）：只看目前遊戲年的紀錄，7 月已確認取 7 月，
 * 否則取 5 月，都沒有時為待更新；已離圈為不適用。
 */
export function currentVitality(
  status: MareStatus,
  record: MareYearly | undefined,
): VitalityReading {
  if (status === 'left') {
    return { vitality: { state: 'notApplicable' }, month: undefined };
  }
  const july = record?.vitalityJuly;
  if (july?.state === 'confirmed') {
    return { vitality: july, month: 7 };
  }
  const may = record?.vitalityMay;
  if (may?.state === 'confirmed') {
    return { vitality: may, month: 5 };
  }
  return { vitality: { state: 'pending' }, month: undefined };
}

/** 低於活力建議門檻（需求規格 8.7）：只影響提示與排序；増強中必定受胎（4.4），視為達到門檻。 */
export function isBelowThreshold(vitality: Vitality, threshold: number | undefined): boolean {
  return (
    threshold !== undefined &&
    vitality.state === 'confirmed' &&
    !vitality.boosted &&
    vitality.value < threshold
  );
}

export type YearlyTallyField = 'kodashi' | 'breedingYears' | 'breedingCount';

export interface YearValue {
  readonly value: number;
  readonly gameYear: number;
}

/** 仔出、繁殖年數、繁殖頭數按年保存，顯示最近一個有值的年度（需求規格 8.8）。 */
export function latestYearlyValue(
  records: readonly MareYearly[],
  field: YearlyTallyField,
): YearValue | undefined {
  let latest: YearValue | undefined;
  for (const record of records) {
    const value = record[field];
    if (value !== undefined && (latest === undefined || record.gameYear > latest.gameYear)) {
      latest = { value, gameYear: record.gameYear };
    }
  }
  return latest;
}

export function yearlyRecordFor(
  records: readonly MareYearly[],
  gameYear: number,
): MareYearly | undefined {
  return records.find((record) => record.gameYear === gameYear);
}
