import type { LinePosition } from './line.ts';

/**
 * 斷血的哪一側（需求規格 7.6）：公系是該系沒有可用的種牡馬，母系是母馬群斷了。
 * 兩側同時斷時記為 `both`。
 */
export const RECOVERY_SIDES = ['sire', 'dam', 'both'] as const;

export type RecoverySide = (typeof RECOVERY_SIDES)[number];

/** 補系的進行狀態（需求規格 7.6）：進行中會暫停新增下一系與循環換代（LINE-21）。 */
export const RECOVERY_STATUSES = ['inProgress', 'completed', 'cancelled'] as const;

export type RecoveryStatus = (typeof RECOVERY_STATUSES)[number];

/**
 * 斷血補系（設計決策 5.2 節 `recoveries`）：保存斷血的系、原因、年度、中斷的公系或母系、
 * 補入的市場親馬、採用的其他系血統與重新加入的產駒。原支線歷史保留，其餘七系不受影響。
 */
export interface Recovery {
  readonly id: string;
  readonly position: LinePosition;
  /** 斷血時該系已成立的最新代數；補系產出下一代（需求規格 7.6）。 */
  readonly generation: number;
  /** 宣告斷血的遊戲年。 */
  readonly gameYear: number;
  readonly side: RecoverySide;
  /** 使用者填寫的原因。 */
  readonly reason: string;
  readonly status: RecoveryStatus;
  /** 補入的零代市場種牡馬。 */
  readonly sireId?: string;
  /** 補入的零代市場母馬。 */
  readonly damId?: string;
  /** 採用其他系血統時記錄來源系位置。 */
  readonly bloodFromPosition?: LinePosition;
  /** 重新加入的產駒；補系完成時連結。 */
  readonly foalId?: string;
  /** 補系結束（完成或取消）的遊戲年。 */
  readonly endYear?: number;
}

/** 補系產出的代數（需求規格 7.6）：斷血的代數加 1，例如第 5 系 12 代斷血 → 補系產出 13 代。 */
export function recoveryTargetGeneration(recovery: Pick<Recovery, 'generation'>): number {
  return recovery.generation + 1;
}

export function isRecoveryInProgress(recovery: Pick<Recovery, 'status'>): boolean {
  return recovery.status === 'inProgress';
}

/** 母馬群待補（需求規格 7.6、LINE-18）：已成立的世代在圈母馬降為 0 時提醒，不自動宣告斷血。 */
export function needsReplenish(established: boolean, producingMares: number): boolean {
  return established && producingMares === 0;
}

/** 斷血時使用者可以選的處理（需求規格 7.6、LINE-19）：系統只列出選項，不代選。 */
export const RECOVERY_CHOICES = ['retry', 'replenish', 'recovery'] as const;

export type RecoveryChoice = (typeof RECOVERY_CHOICES)[number];
