import { isLinePosition, type LinePosition } from './line.ts';
import { MARKET_GENERATION } from './lineage.ts';
import { parentSystemOf, type SystemMapEntry } from './system-map.ts';

/** 繋養牧場番号：32 日本、33 分場（俱樂部牧場，同一據點）、34 美國、35 歐洲（需求規格 3 章、8.6）。 */
export const MARE_SITES = [32, 33, 34, 35] as const;

export type MareSite = (typeof MARE_SITES)[number];

export function isMareSite(value: number): value is MareSite {
  return (MARE_SITES as readonly number[]).includes(value);
}

/** 來源：市場創系、市場補血、市場混血、市場補系、所屬競走馬引退轉入、其他（需求規格 8.1）。 */
export const MARE_ORIGINS = [
  'marketFound',
  'marketReplenish',
  'marketMixed',
  'marketRecovery',
  'ownRetired',
  'other',
] as const;

export type MareOrigin = (typeof MARE_ORIGINS)[number];

/** 今年計畫：待定、八系指定配種、自由配種、等待活力、輪休（需求規格 8.7）。 */
export const YEAR_PLANS = ['undecided', 'designated', 'free', 'waitVitality', 'rest'] as const;

export type YearPlan = (typeof YEAR_PLANS)[number];

export type MareStatus = 'producing' | 'left';

export type LeftReason = 'sold' | 'retired';

export type Succession = 'provisional' | 'sisterCandidate' | 'confirmed' | 'replaced' | 'sold';

export type AssignedGroupKind = 'own' | 'substitute' | 'starter';

/** 第 q 系 N 代母馬群（需求規格 3 章「母馬群」）；起點母馬群固定為第 1 系、代數 0。 */
export interface AssignedMareGroup {
  readonly kind: AssignedGroupKind;
  readonly position: LinePosition;
  readonly generation: number;
}

/** 待指定用途（需求規格 8.4）。 */
export interface UnassignedMareGroup {
  readonly kind: 'unassigned';
}

export type MareGroup = AssignedMareGroup | UnassignedMareGroup;

/** 今年計畫連同設定時的遊戲年保存；年份不同時視為待定（2026-09-15 使用者裁定）。 */
export interface MareYearPlan {
  readonly plan: YearPlan;
  readonly gameYear: number;
}

/** 設計決策 5.2 節 `mares`；id 與馬匹相同。 */
export interface Mare {
  readonly id: string;
  readonly group: MareGroup;
  readonly origin: MareOrigin;
  readonly originNote?: string;
  readonly status: MareStatus;
  /** 只在已離圈時存在。 */
  readonly leftReason?: LeftReason;
  readonly site: MareSite;
  /** 姊妹接替狀態：只有自家母駒轉入後才有（需求規格 8.9）。 */
  readonly succession?: Succession;
  readonly yearPlan?: MareYearPlan;
}

/** 母馬群的目標數，只是提醒（需求規格 7.5）。 */
export const MARE_GROUP_TARGET = 5;

/** 與資料表欄位規則的代數上限相同。 */
export const MAX_GENERATION = 9999;

export type MarketGroupIssue = 'positionInvalid' | 'generationInvalid' | 'starterOnlyFirstLine';

/** 市場母馬入群的系與代數：代數 0 只能是第 1 系起點母馬群。 */
export function checkMarketGroup(position: number, generation: number): MarketGroupIssue | undefined {
  if (!isLinePosition(position)) {
    return 'positionInvalid';
  }
  if (!Number.isInteger(generation) || generation < 0 || generation > MAX_GENERATION) {
    return 'generationInvalid';
  }
  return generation === MARKET_GENERATION && position !== 1 ? 'starterOnlyFirstLine' : undefined;
}

/** 代數 0 為第 1 系起點用，1 以上為替代第 q 系 N 代（需求規格 8.3）。先以 checkMarketGroup 檢查。 */
export function marketGroupFor(position: LinePosition, generation: number): AssignedMareGroup {
  return {
    kind: generation === MARKET_GENERATION ? 'starter' : 'substitute',
    position,
    generation,
  };
}

/** 母馬本身的代數（需求規格 8.2）：自家母馬為所屬世代，市場母馬為零代；待指定用途未知。 */
export function mareGeneration(group: MareGroup): number | undefined {
  if (group.kind === 'unassigned') {
    return undefined;
  }
  return group.kind === 'own' ? group.generation : MARKET_GENERATION;
}

/** 第 q 系 N 代母馬群包含該系該代的自家母馬與替代母馬（需求規格 3 章、MARE-02）。 */
export function isSameGroup(group: MareGroup, position: LinePosition, generation: number): boolean {
  return (
    group.kind !== 'unassigned' && group.position === position && group.generation === generation
  );
}

/** 市場母馬的預設來源：起點用或替代尚未開啟的系為市場創系，替代已開啟的系為市場補血。 */
export function defaultMarketOrigin(
  group: AssignedMareGroup,
  openedPositions: readonly LinePosition[],
): MareOrigin {
  return group.kind === 'starter' || !openedPositions.includes(group.position)
    ? 'marketFound'
    : 'marketReplenish';
}

/** 需求規格 4.6：出生當年為 0 歲，每年 1 月加 1。 */
export function ageInYear(birthYear: number | undefined, gameYear: number): number | undefined {
  return birthYear === undefined ? undefined : gameYear - birthYear;
}

/** 高齡提醒（需求規格 8.5）：只提示，不影響任何操作。 */
export function isHighAge(age: number | undefined, reminderAge: number): boolean {
  return age !== undefined && age >= reminderAge;
}

export function effectiveYearPlan(
  yearPlan: MareYearPlan | undefined,
  currentYear: number,
): YearPlan {
  return yearPlan?.gameYear === currentYear ? yearPlan.plan : 'undecided';
}

export interface LineParentSystem {
  readonly position: LinePosition;
  readonly parentSystem: string;
}

export type UndeterminedReason = 'sireSubsystemMissing' | 'lineNotOpened' | 'notInSystemMap';

export type SubstituteSireCheck =
  | { readonly result: 'notSubstitute' }
  | { readonly result: 'sameParentSystem' }
  | {
      readonly result: 'differentParentSystem';
      readonly sireParentSystem: string;
      readonly lineParentSystem: string;
    }
  | { readonly result: 'undetermined'; readonly reason: UndeterminedReason };

/**
 * 替代母馬的自身父系是否屬於替代的系（需求規格 8.3、10.3）：自身父系經系統對照表取得的親系統，
 * 與第 q 系目前的親系統比較。自身父系留空、第 q 系尚未成立或對照表查不到時無法判斷。
 */
export function checkSubstituteSire(
  group: MareGroup,
  sireSubsystem: string | undefined,
  systemMap: readonly SystemMapEntry[],
  lines: readonly LineParentSystem[],
): SubstituteSireCheck {
  if (group.kind !== 'substitute') {
    return { result: 'notSubstitute' };
  }
  if (sireSubsystem === undefined) {
    return { result: 'undetermined', reason: 'sireSubsystemMissing' };
  }
  const line = lines.find((item) => item.position === group.position);
  if (line === undefined) {
    return { result: 'undetermined', reason: 'lineNotOpened' };
  }
  const sireParentSystem = parentSystemOf(systemMap, sireSubsystem);
  if (sireParentSystem === undefined) {
    return { result: 'undetermined', reason: 'notInSystemMap' };
  }
  return sireParentSystem === line.parentSystem
    ? { result: 'sameParentSystem' }
    : { result: 'differentParentSystem', sireParentSystem, lineParentSystem: line.parentSystem };
}
