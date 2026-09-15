import type { Lineage } from './lineage.ts';
import type { StallionDuty } from './stallion-duty.ts';

/** 七項副能力：力量、瞬發力、勝負根性、柔軟性、精神力、賢明度、健康（設計決策 6.3 節）。 */
export const SUB_PARAM_KEYS = [
  'power',
  'quickness',
  'guts',
  'flexibility',
  'spirit',
  'wisdom',
  'health',
] as const;

export type SubParamKey = (typeof SUB_PARAM_KEYS)[number];

/** 副能力等級 G～S+，依序換算 0～15（需求規格 4.7，非官方換算）。 */
export const SUB_PARAM_GRADES = [
  'G',
  'G+',
  'F',
  'F+',
  'E',
  'E+',
  'D',
  'D+',
  'C',
  'C+',
  'B',
  'B+',
  'A',
  'A+',
  'S',
  'S+',
] as const;

export type SubParamGrade = (typeof SUB_PARAM_GRADES)[number];

export type SubParams = Readonly<Partial<Record<SubParamKey, SubParamGrade>>>;

/** 芝、ダート適性：◎ > ○ > △ > ×（需求規格 4.7）。 */
export const APTITUDES = ['◎', '○', '△', '×'] as const;

export type Aptitude = (typeof APTITUDES)[number];

/** 牧場處置：保留、待售、已售出（需求規格 9.3）。 */
export const DISPOSITIONS = ['keep', 'forSale', 'sold'] as const;

export type Disposition = (typeof DISPOSITIONS)[number];

/** SP、ST 的保存範圍；遊戲實際範圍較窄，此處只擋明顯錯誤的輸入。 */
export const ABILITY_VALUE_MAX = 999;

/**
 * 產駒（設計決策 5.2 節 `foals`）：id 與馬匹相同。自由配種產駒（含沒有相符受胎紀錄、比照自由配種者）
 * 沒有系與代數，一律不保留（需求規格 9.5、11.4）。性別、父母、出生年、牝系與名稱存在馬匹紀錄。
 */
export interface Foal {
  readonly id: string;
  readonly damId: string;
  readonly birthYear: number;
  readonly lineage?: Lineage;
  readonly freeBred: boolean;
  readonly disposition: Disposition;
  readonly sp?: number;
  readonly st?: number;
  /** 只保存有值的項目；一項都沒有時不存。 */
  readonly subParams?: SubParams;
  readonly turf?: Aptitude;
  readonly dirt?: Aptitude;
  /** 距離適性保存原文，例如 `1700～3100m`。 */
  readonly distanceText?: string;
  readonly kodashi?: number;
  readonly note?: string;
}

export function isAbilityValue(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= ABILITY_VALUE_MAX;
}

/** 七項齊全時計算 `サ`（0～105），缺任何一項時為 undefined（需求規格 9.3）。 */
export function subParamTotal(subParams: SubParams | undefined): number | undefined {
  let total = 0;
  for (const key of SUB_PARAM_KEYS) {
    const grade = subParams?.[key];
    if (grade === undefined) {
      return undefined;
    }
    total += SUB_PARAM_GRADES.indexOf(grade);
  }
  return total;
}

/** 場地型摘要（推導，不取代原值）：芝型、ダート型、兼用、兩者都不擅長。 */
export type SurfaceSummary = 'turf' | 'dirt' | 'both' | 'neither';

function aptitudeRank(aptitude: Aptitude): number {
  return APTITUDES.length - 1 - APTITUDES.indexOf(aptitude);
}

/**
 * 需求規格 9.3、BRD-13（2026-09-16 補充的判斷方式）：適性較高的一邊決定芝型或ダート型；
 * 兩者相同時，○ 以上為兼用、△ 以下為兩者都不擅長。任一邊未取得時沒有摘要。
 */
export function surfaceSummary(
  turf: Aptitude | undefined,
  dirt: Aptitude | undefined,
): SurfaceSummary | undefined {
  if (turf === undefined || dirt === undefined) {
    return undefined;
  }
  const difference = aptitudeRank(turf) - aptitudeRank(dirt);
  if (difference !== 0) {
    return difference > 0 ? 'turf' : 'dirt';
  }
  return aptitudeRank(turf) >= aptitudeRank('○') ? 'both' : 'neither';
}

/** 自由配種產駒一律待售或已售出，不能保留為八系後繼（需求規格 9.5、BRD-15）。 */
export function isDispositionAllowed(freeBred: boolean, disposition: Disposition): boolean {
  return !freeBred || disposition !== 'keep';
}

export function defaultDisposition(freeBred: boolean): Disposition {
  return freeBred ? 'forSale' : 'keep';
}

/** 追蹤名：母馬名＋實際出生年，例如 `オオトリモナーコス1990`（需求規格 3 章、9.4）。 */
export function trackingName(damName: string | undefined, birthYear: number): string | undefined {
  return damName === undefined || damName === '' ? undefined : `${damName}${String(birthYear)}`;
}

/**
 * 種牡馬所在的系與代數：有任期時取任期（現任優先）的系位置與代數，否則取他本身產駒紀錄的系與代數；
 * 市場馬沒有任期時為 undefined。
 */
export function stallionLineage(
  duties: readonly Pick<StallionDuty, 'position' | 'generation' | 'role'>[],
  ownFoal: Pick<Foal, 'lineage'> | undefined,
): Lineage | undefined {
  const duty = duties.find((item) => item.role === 'current') ?? duties[0];
  return duty === undefined
    ? ownFoal?.lineage
    : { position: duty.position, generation: duty.generation };
}
