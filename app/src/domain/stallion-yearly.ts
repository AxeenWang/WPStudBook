import { SUB_PARAM_KEYS, type SubParams } from './foal.ts';

/** 戦績欄（需求規格 11.8、附錄 A.4）：出走、勝、獲得賞金、重賞勝、G1 勝。 */
export interface StallionRaceRecord {
  readonly starts?: number;
  readonly wins?: number;
  readonly earnings?: number;
  readonly gradedWins?: number;
  readonly g1Wins?: number;
}

export const RACE_RECORD_KEYS = [
  'starts',
  'wins',
  'earnings',
  'gradedWins',
  'g1Wins',
] as const satisfies readonly (keyof StallionRaceRecord)[];

/**
 * 種牡馬的當年快照（設計決策 5.2 節 `stallionYearly`）：能力、`サ`、仔出、種付料與戦績。
 * 欄位皆選填；與前一份相同時不重複保存（需求規格 11.8、STL-11）。
 */
export interface StallionYearly {
  readonly id: string;
  readonly horseId: string;
  readonly gameYear: number;
  readonly sp?: number;
  readonly st?: number;
  readonly subParams?: SubParams;
  readonly subParamTotal?: number;
  readonly kodashi?: number;
  readonly studFee?: number;
  readonly record?: StallionRaceRecord;
}

/** 一份快照的內容，不含識別與年份。 */
export type StallionSnapshot = Omit<StallionYearly, 'id' | 'horseId' | 'gameYear'>;

function sameSubParams(a: SubParams | undefined, b: SubParams | undefined): boolean {
  return SUB_PARAM_KEYS.every((key) => a?.[key] === b?.[key]);
}

function sameRecord(a: StallionRaceRecord | undefined, b: StallionRaceRecord | undefined): boolean {
  return RACE_RECORD_KEYS.every((key) => a?.[key] === b?.[key]);
}

/**
 * 與前一份相同（需求規格 11.8、STL-11）：相同就不寫新的一年，舊年度照樣查得到。
 * 未取得與有值不算相同，否則欄位從有值變成空白時會被當成沒變。
 */
export function sameSnapshot(a: StallionSnapshot, b: StallionSnapshot): boolean {
  return (
    a.sp === b.sp &&
    a.st === b.st &&
    a.subParamTotal === b.subParamTotal &&
    a.kodashi === b.kodashi &&
    a.studFee === b.studFee &&
    sameSubParams(a.subParams, b.subParams) &&
    sameRecord(a.record, b.record)
  );
}

/** 取最近一年的快照；沒有紀錄時為未取得。 */
export function latestSnapshot(records: readonly StallionYearly[]): StallionYearly | undefined {
  let latest: StallionYearly | undefined;
  for (const record of records) {
    if (latest === undefined || record.gameYear > latest.gameYear) {
      latest = record;
    }
  }
  return latest;
}
