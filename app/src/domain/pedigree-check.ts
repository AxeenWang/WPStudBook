import type { Lineage } from './lineage.ts';

/** 3 代前的祖先數，也是活血種數的上限（需求規格 4.3）。 */
export const ACTIVATION_ANCESTORS = 8;
export const FULL_ACTIVATION = ACTIVATION_ANCESTORS;

/** 血脈活性化成立的門檻：6 種以上（需求規格 4.3）。 */
export const ACTIVATION_THRESHOLD = 6;

/** 血脈活性化是否成立（需求規格 4.3）：只用於顯示，警告門檻是 8 種（10.2）。 */
export function isActivationEstablished(activationCount: number | undefined): boolean {
  return activationCount !== undefined && activationCount >= ACTIVATION_THRESHOLD;
}

/** インブリード 的檢查範圍：父母祖先 4 代內（需求規格 4.3）。 */
export const INBREEDING_GENERATIONS = 4;

/** 血統檢查看到的一位祖先。 */
export interface AncestorNode {
  /** 已連結內部馬匹時才有。 */
  readonly horseId?: string | undefined;
  /** 自身父系經系統對照表取得的親系統；查不到時為 undefined（需求規格 8.3、10.2）。 */
  readonly parentSystem?: string | undefined;
  /** 建系期的市場種牡馬或替代母馬：資料不足只因這種祖先時只提示（需求規格 10.2、PED-11）。 */
  readonly buildingPhaseMarket: boolean;
}

/** 祖先樹：`undefined` 代表該位置沒有資料（外部參考或空白）。 */
export interface AncestorTree {
  /** 3 代前的 8 匹祖先，依序排列；資料不足的位置為 undefined（需求規格 4.3）。 */
  readonly greatGrandparents: readonly (AncestorNode | undefined)[];
  /** 4 代內出現兩次以上的內部馬匹識別（需求規格 4.3、PED-04）。 */
  readonly duplicateAncestors: readonly string[];
  /** 4 代內資料不足、且不是建系期市場馬的位置數（需求規格 10.2、PED-11）。 */
  readonly unlinkedAncestors: number;
  /** 4 代內資料不足、來自建系期市場馬的位置數。 */
  readonly buildingPhaseGaps: number;
}

/** 血統檢查結果（需求規格 10.2；設計決策 6.3 `pedigreeCheck`）。 */
export interface PedigreeCheck {
  /** 建系期不計算活血（需求規格 10.1、PED-01）。 */
  readonly evaluated: boolean;
  /** 活血種數預估（0～8）；未計算時為 undefined。 */
  readonly activationCount?: number;
  /** 4 代內重複的馬。 */
  readonly duplicateAncestors: readonly string[];
  /** 血統資料不足。 */
  readonly insufficientPedigree: boolean;
  /** 資料不足只因建系期的市場馬：只提示，不要求確認（需求規格 10.2、PED-11）。 */
  readonly gapsOnlyFromBuildingPhase: boolean;
}

/**
 * 活血種數預估（需求規格 4.3、10.2）：3 代前 8 匹祖先的親系統種類數。
 * 查不到親系統的位置不計入種類，只會讓種數變少。
 */
export function estimateActivation(
  greatGrandparents: readonly (AncestorNode | undefined)[],
): number {
  const systems = new Set<string>();
  for (const ancestor of greatGrandparents) {
    if (ancestor?.parentSystem !== undefined && ancestor.parentSystem !== '') {
      systems.add(ancestor.parentSystem);
    }
  }
  return Math.min(systems.size, FULL_ACTIVATION);
}

/**
 * 循環期的血統檢查（需求規格 10.1、10.2）：建系期不計算活血，也不因市場馬血統不完整警告。
 * 循環期預估活血種數、檢查 4 代內重複的馬，並判斷資料是否不足。
 */
export function checkPedigree(phase: 'building' | 'cycling', tree: AncestorTree): PedigreeCheck {
  if (phase === 'building') {
    return {
      evaluated: false,
      duplicateAncestors: [],
      insufficientPedigree: false,
      gapsOnlyFromBuildingPhase: false,
    };
  }
  const gaps = tree.unlinkedAncestors + tree.buildingPhaseGaps;
  return {
    evaluated: true,
    activationCount: estimateActivation(tree.greatGrandparents),
    duplicateAncestors: [...tree.duplicateAncestors],
    insufficientPedigree: gaps > 0,
    gapsOnlyFromBuildingPhase: gaps > 0 && tree.unlinkedAncestors === 0,
  };
}

export type PedigreeWarningCode =
  'activationBelowFull' | 'duplicateAncestors' | 'insufficientPedigree';

/**
 * 需要使用者確認的血統警告（需求規格 10.2）：少於 8 種、4 代內重複或資料不足時警告並確認，不阻止。
 * 資料不足只因建系期的市場馬時只提示，不列入需要確認的警告（PED-11）。
 */
export function pedigreeWarningCodes(check: PedigreeCheck): PedigreeWarningCode[] {
  if (!check.evaluated) {
    return [];
  }
  const codes: PedigreeWarningCode[] = [];
  if (check.activationCount !== undefined && check.activationCount < FULL_ACTIVATION) {
    codes.push('activationBelowFull');
  }
  if (check.duplicateAncestors.length > 0) {
    codes.push('duplicateAncestors');
  }
  if (check.insufficientPedigree && !check.gapsOnlyFromBuildingPhase) {
    codes.push('insufficientPedigree');
  }
  return codes;
}

/** 只提示、不要求確認的說明（需求規格 10.2、PED-11）。 */
export function pedigreeNotices(check: PedigreeCheck): string[] {
  if (check.evaluated && check.insufficientPedigree && check.gapsOnlyFromBuildingPhase) {
    return ['血統資料不足只因祖先含建系期的市場馬，不影響這次配種'];
  }
  return [];
}

/** 系與代數不符的一方（需求規格 10.3）。 */
export type LineageSide = 'sire' | 'dam';

export interface LineageMismatch {
  readonly side: LineageSide;
  /** 錯的是系位置、代數，還是這匹馬根本沒有系與代數。 */
  readonly kind: 'position' | 'generation' | 'unknown';
  /** 規則指定的系與代數。 */
  readonly expected: Lineage;
  readonly actual: Lineage | undefined;
}

/**
 * 系與代數檢查（需求規格 10.3、LINE-27、LINE-34、PED-06、PED-07）：實際選擇與規則指定的對象不符時
 * 一律阻止，並指出錯誤的一方與正確的系、代數。系位置先於代數回報，因為選錯系時代數的比較沒有意義。
 */
export function checkLineageAgainstRule(
  side: LineageSide,
  expected: Lineage,
  actual: Lineage | undefined,
): LineageMismatch | undefined {
  if (actual === undefined) {
    return { side, kind: 'unknown', expected, actual };
  }
  if (actual.position !== expected.position) {
    return { side, kind: 'position', expected, actual };
  }
  if (actual.generation !== expected.generation) {
    return { side, kind: 'generation', expected, actual };
  }
  return undefined;
}
