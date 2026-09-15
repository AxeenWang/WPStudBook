import type { Conception } from '../domain/breeding.ts';
import type { GameSettings } from '../domain/game.ts';
import type { Horse } from '../domain/horse.ts';
import type { LinePosition } from '../domain/line.ts';
import {
  ageInYear,
  effectiveYearPlan,
  isHighAge,
  mareGeneration,
  type LeftReason,
  type Mare,
  type MareGroup,
  type MareOrigin,
  type MareSite,
  type MareStatus,
  type YearPlan,
} from '../domain/mare.ts';
import {
  currentVitality,
  isBelowThreshold,
  latestYearlyValue,
  yearlyRecordFor,
  type MareYearly,
  type VitalityReading,
  type YearValue,
} from '../domain/mare-yearly.ts';

/** 母馬群清單的一張卡片（需求規格 13.3、UI-01）。 */
export interface MareCard {
  readonly id: string;
  readonly name: string;
  /** 完整馬名、基本馬名、正式馬名與別名，供關鍵字比對。 */
  readonly searchNames: readonly string[];
  readonly group: MareGroup;
  /** 母馬本身的代數；待指定用途為 undefined。 */
  readonly generation: number | undefined;
  readonly sireSubsystem: string | undefined;
  readonly site: MareSite;
  readonly age: number | undefined;
  readonly highAge: boolean;
  readonly vitality: VitalityReading;
  readonly belowThreshold: boolean;
  readonly conception: Conception | undefined;
  readonly yearPlan: YearPlan;
  readonly status: MareStatus;
  readonly leftReason: LeftReason | undefined;
  readonly origin: MareOrigin;
  readonly femaleLine: string | undefined;
  readonly kodashi: YearValue | undefined;
}

export interface MareCardSource {
  readonly mare: Mare;
  readonly horse: Horse | undefined;
  /** 這匹母馬全部年度的資料。 */
  readonly yearly: readonly MareYearly[];
  readonly conception: Conception | undefined;
  readonly currentYear: number;
  readonly settings: Pick<GameSettings, 'highAgeReminderAge' | 'vitalityThreshold'>;
}

export function buildMareCard(source: MareCardSource): MareCard {
  const { mare, horse, currentYear, settings } = source;
  const vitality = currentVitality(mare.status, yearlyRecordFor(source.yearly, currentYear));
  const age = ageInYear(horse?.birthYear, currentYear);
  const names = [
    horse?.fullName,
    horse?.baseName,
    horse?.officialName,
    ...(horse?.aliases ?? []).map((alias) => alias.name),
  ].filter((name): name is string => name !== undefined && name !== '');
  return {
    id: mare.id,
    name: horse?.fullName ?? horse?.officialName ?? horse?.baseName ?? '（沒有馬名）',
    searchNames: [...new Set(names)],
    group: mare.group,
    generation: mareGeneration(mare.group),
    sireSubsystem: horse?.sireSubsystem,
    site: mare.site,
    age,
    highAge: mare.status === 'producing' && isHighAge(age, settings.highAgeReminderAge),
    vitality,
    belowThreshold: isBelowThreshold(vitality.vitality, settings.vitalityThreshold),
    conception: source.conception,
    yearPlan: effectiveYearPlan(mare.yearPlan, currentYear),
    status: mare.status,
    leftReason: mare.leftReason,
    origin: mare.origin,
    femaleLine: horse?.femaleLine,
    kodashi: latestYearlyValue(source.yearly, 'kodashi'),
  };
}

/** 清單單位：第 q 系 N 代母馬群，或同一系的全部代數（歷史檢視）。 */
export interface MareGroupView {
  readonly position: LinePosition;
  readonly generation: number | 'all';
}

export type MareStatusFilter = 'producing' | 'left' | 'all';

/** 有無牝系：不限、有具名牝系、不屬於具名牝系；未取得的牝系兩者都不符合。 */
export type FemaleLineFilter = 'any' | 'named' | 'none';

export interface MareFilterOptions {
  readonly site: MareSite | undefined;
  readonly vitalityMin: number | undefined;
  readonly vitalityMax: number | undefined;
  readonly boostedOnly: boolean;
  readonly pendingOnly: boolean;
  readonly yearPlan: YearPlan | undefined;
  readonly status: MareStatusFilter;
  readonly origin: MareOrigin | undefined;
  readonly femaleLine: FemaleLineFilter;
  readonly femaleLineName: string;
  readonly kodashiMin: number | undefined;
  readonly kodashiMax: number | undefined;
  readonly keyword: string;
}

export const DEFAULT_MARE_FILTER: MareFilterOptions = {
  site: undefined,
  vitalityMin: undefined,
  vitalityMax: undefined,
  boostedOnly: false,
  pendingOnly: false,
  yearPlan: undefined,
  status: 'producing',
  origin: undefined,
  femaleLine: 'any',
  femaleLineName: '',
  kodashiMin: undefined,
  kodashiMax: undefined,
  keyword: '',
};

/** 範圍條件都沒填時不限制；有填時未知值不符合。 */
function inRange(
  value: number | undefined,
  min: number | undefined,
  max: number | undefined,
): boolean {
  if (min === undefined && max === undefined) {
    return true;
  }
  return (
    value !== undefined &&
    (min === undefined || value >= min) &&
    (max === undefined || value <= max)
  );
}

function matchesFemaleLine(femaleLine: string | undefined, filter: FemaleLineFilter): boolean {
  if (filter === 'named') {
    return femaleLine !== undefined && femaleLine !== '';
  }
  return filter === 'none' ? femaleLine === '' : true;
}

/** 系、代數與所有篩選條件取交集（需求規格 13.3、UI-07）。 */
export function matchesMareFilter(
  card: MareCard,
  view: MareGroupView,
  options: MareFilterOptions,
): boolean {
  const { group } = card;
  const { vitality } = card.vitality;
  const confirmed = vitality.state === 'confirmed' ? vitality : undefined;
  const lineName = options.femaleLineName.trim();
  const keyword = options.keyword.trim();
  return (
    group.kind !== 'unassigned' &&
    group.position === view.position &&
    (view.generation === 'all' || group.generation === view.generation) &&
    (options.status === 'all' || card.status === options.status) &&
    (options.site === undefined || card.site === options.site) &&
    inRange(confirmed?.value, options.vitalityMin, options.vitalityMax) &&
    (!options.boostedOnly || confirmed?.boosted === true) &&
    (!options.pendingOnly || vitality.state === 'pending') &&
    (options.yearPlan === undefined || card.yearPlan === options.yearPlan) &&
    (options.origin === undefined || card.origin === options.origin) &&
    matchesFemaleLine(card.femaleLine, options.femaleLine) &&
    (lineName === '' || card.femaleLine?.includes(lineName) === true) &&
    inRange(card.kodashi?.value, options.kodashiMin, options.kodashiMax) &&
    (keyword === '' || card.searchNames.some((name) => name.includes(keyword)))
  );
}

function statusRank(card: MareCard): number {
  return card.status === 'producing' ? 0 : 1;
}

/** 0：達到門檻或沒有門檻的確認值（含増強中）；1：低於門檻；2：今年沒有確認值。 */
function vitalityRank(card: MareCard, threshold: number | undefined): number {
  const { vitality } = card.vitality;
  if (vitality.state !== 'confirmed') {
    return 2;
  }
  return isBelowThreshold(vitality, threshold) ? 1 : 0;
}

function vitalityValue(card: MareCard): number {
  const { vitality } = card.vitality;
  return vitality.state === 'confirmed' ? vitality.value : -1;
}

/** 2026-09-15 使用者裁定的排序；活力建議門檻只影響排序與提示（需求規格 8.7、MARE-16）。 */
export function sortMareCards(
  cards: readonly MareCard[],
  threshold: number | undefined,
): MareCard[] {
  return [...cards].sort(
    (a, b) =>
      statusRank(a) - statusRank(b) ||
      vitalityRank(a, threshold) - vitalityRank(b, threshold) ||
      vitalityValue(b) - vitalityValue(a) ||
      a.name.localeCompare(b.name, 'ja') ||
      a.id.localeCompare(b.id),
  );
}

/** 階段 2 長清單以分頁顯示，每頁 24 筆（開發計畫階段 2）。 */
export const MARE_PAGE_SIZE = 24;

export interface CardPage<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
}

export function paginate<T>(
  items: readonly T[],
  page: number,
  pageSize: number = MARE_PAGE_SIZE,
): CardPage<T> {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, Math.floor(page)), pageCount);
  const start = (current - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: current,
    pageCount,
    total: items.length,
  };
}

export interface GenerationTab {
  readonly generation: number;
  readonly producing: number;
  readonly left: number;
}

/** 某系已有母馬的代數與各代的生產中、已離圈數，代數由小到大。 */
export function generationTabs(
  cards: readonly MareCard[],
  position: LinePosition,
): GenerationTab[] {
  const counts = new Map<number, { producing: number; left: number }>();
  for (const card of cards) {
    const { group } = card;
    if (group.kind === 'unassigned' || group.position !== position) {
      continue;
    }
    const count = counts.get(group.generation) ?? { producing: 0, left: 0 };
    if (card.status === 'producing') {
      count.producing += 1;
    } else {
      count.left += 1;
    }
    counts.set(group.generation, count);
  }
  return [...counts]
    .map(([generation, count]) => ({ generation, ...count }))
    .sort((a, b) => a.generation - b.generation);
}

/** 預設代數：有生產中母馬的最高代數，其次為最高代數；該系沒有母馬時為全部代數。 */
export function defaultGeneration(
  cards: readonly MareCard[],
  position: LinePosition,
): number | 'all' {
  const tabs = generationTabs(cards, position);
  return (
    tabs.filter((tab) => tab.producing > 0).at(-1)?.generation ?? tabs.at(-1)?.generation ?? 'all'
  );
}
