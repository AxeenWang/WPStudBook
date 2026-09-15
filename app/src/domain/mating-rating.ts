/** 總合評價：S > A > B > C > D（需求規格 4.7、9.2）。 */
export const OVERALL_GRADES = ['S', 'A', 'B', 'C', 'D'] as const;

export type OverallGrade = (typeof OVERALL_GRADES)[number];

/** 爆發力是遊戲顯示的整數；保存範圍只擋明顯錯誤的輸入。 */
export const EXPLOSIVE_POWER_MAX = 99;

/**
 * 配種評價（設計決策 5.2 節 `matingRatings`）：屬於「種牡馬＋繁殖牝馬」組合與遊戲年，不是母馬固定能力。
 * 同年編輯直接更新，跨年各自保存（需求規格 9.2）。總合評價與爆發力至少有一項。
 */
export interface MatingRating {
  readonly id: string;
  readonly stallionId: string;
  readonly mareId: string;
  readonly gameYear: number;
  readonly overallGrade?: OverallGrade;
  readonly explosivePower?: number;
}

export function isExplosivePower(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= EXPLOSIVE_POWER_MAX;
}
