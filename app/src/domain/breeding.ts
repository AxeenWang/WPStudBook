import type { Timing } from './timing.ts';

/** 受胎狀態（設計決策 5.3、6.3 節）：欄位不存在＝未登記，否則存日文原文。不建立流產狀態（需求規格 9.1）。 */
export const CONCEPTIONS = ['空胎', '受胎', '不受胎', '未確認'] as const;

export type Conception = (typeof CONCEPTIONS)[number];

/** 配種類型：八系指定（含建系期依分支進行的配種）、自由配種（需求規格 9.1）。 */
export const BREEDING_TYPES = ['designated', 'free'] as const;

export type BreedingType = (typeof BREEDING_TYPES)[number];

/**
 * 年度繁殖紀錄（設計決策 5.2 節 `breedings`）：每匹母馬每年一筆。實際種牡馬為內部 id 或外部名稱；
 * 規則快照、血統檢查與偏離規則在階段 3 加入。
 */
export interface Breeding {
  readonly id: string;
  readonly mareId: string;
  readonly gameYear: number;
  readonly breedingType: BreedingType;
  readonly stallionId?: string;
  readonly stallionName?: string;
  readonly conception?: Conception;
  /** 只在受胎時存在，為配種年加 1。 */
  readonly expectedBirthYear?: number;
  /** 確認出生後連結的產駒。 */
  readonly foalId?: string;
}

/** 前一年受胎的幼駒在 4 月 1 週誕生（需求規格 4.1、9.1）。 */
export const BIRTH_TIMING: Timing = { month: 4, week: 1 };

export function isConception(value: string): value is Conception {
  return (CONCEPTIONS as readonly string[]).includes(value);
}

/** 受胎才建立預定產駒，預定生產年為隔年（需求規格 9.1）。 */
export function expectedBirthYearFor(
  gameYear: number,
  conception: Conception | undefined,
): number | undefined {
  return conception === '受胎' ? gameYear + 1 : undefined;
}

/** 輪空：空胎或不受胎年度，不建立產駒（需求規格 9.3）。`未確認` 不推定結果，不是輪空。 */
export function isIdleConception(conception: Conception | undefined): boolean {
  return conception === '空胎' || conception === '不受胎';
}

/** 產駒時間軸的一年（需求規格 13.4、BRD-04）；以出生年為準，對應前一年的繁殖紀錄。 */
export type FoalTimelineEntry =
  | { readonly kind: 'foal'; readonly birthYear: number; readonly foalId: string }
  | { readonly kind: 'expected'; readonly birthYear: number; readonly breeding: Breeding }
  | { readonly kind: 'idle'; readonly birthYear: number; readonly conception: Conception }
  | { readonly kind: 'unconfirmed'; readonly birthYear: number; readonly breeding: Breeding }
  | { readonly kind: 'conceptionPending'; readonly birthYear: number; readonly breeding: Breeding }
  | { readonly kind: 'unregistered'; readonly birthYear: number };

export interface TimelineFoal {
  readonly id: string;
  readonly birthYear: number;
}

export interface FoalTimelineSource {
  readonly breedings: readonly Breeding[];
  readonly foals: readonly TimelineFoal[];
  /** 母馬加入母馬群的遊戲年；加入當年出生的幼駒來自加入前的配種，沒有紀錄時不列出（BRD-19）。 */
  readonly joinedYear: number;
  /** 時間軸最後一年：生產中為目前遊戲年，已離圈為離圈年；有更晚的紀錄時延伸到該年。 */
  readonly lastYear: number;
}

/**
 * 產駒時間軸（新到舊）：有產駒顯示產駒，否則依前一年的受胎狀態顯示預定出生、輪空、未確認或待登記受胎，
 * 沒有繁殖紀錄的年度為未登記。範圍從加入隔年起，較早的產駒或紀錄會把範圍往前延伸。
 */
export function buildFoalTimeline(source: FoalTimelineSource): FoalTimelineEntry[] {
  const { breedings, foals } = source;
  const birthYears = [
    ...foals.map((foal) => foal.birthYear),
    ...breedings.map((breeding) => breeding.gameYear + 1),
  ];
  const firstYear = Math.min(source.joinedYear + 1, ...birthYears);
  const lastYear = Math.max(source.lastYear, ...birthYears);
  const entries: FoalTimelineEntry[] = [];
  for (let birthYear = lastYear; birthYear >= firstYear; birthYear -= 1) {
    const foal = foals.find((item) => item.birthYear === birthYear);
    const breeding = breedings.find((item) => item.gameYear === birthYear - 1);
    if (foal !== undefined) {
      entries.push({ kind: 'foal', birthYear, foalId: foal.id });
    } else if (breeding === undefined) {
      entries.push({ kind: 'unregistered', birthYear });
    } else if (breeding.conception === '受胎') {
      entries.push({ kind: 'expected', birthYear, breeding });
    } else if (breeding.conception === '空胎' || breeding.conception === '不受胎') {
      entries.push({ kind: 'idle', birthYear, conception: breeding.conception });
    } else if (breeding.conception === '未確認') {
      entries.push({ kind: 'unconfirmed', birthYear, breeding });
    } else {
      entries.push({ kind: 'conceptionPending', birthYear, breeding });
    }
  }
  return entries;
}
