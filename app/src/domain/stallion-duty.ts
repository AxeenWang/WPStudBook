import type { LinePosition } from './line.ts';

export type StallionRole = 'current' | 'planned';

/** 現任的任期狀態：在崗、已被取代、退出生產行列、已引退（需求規格 7.7）。 */
export const DUTY_STATUSES = ['onDuty', 'replaced', 'outOfService', 'retired'] as const;

export type DutyStatus = (typeof DUTY_STATUSES)[number];

/** 預定後繼的就緒狀態：尚未誕生、競走中、已引退待指定、正式供用（需求規格 7.7）。 */
export const PLANNED_READINESS = ['unborn', 'racing', 'retiredPending', 'inService'] as const;

export type PlannedReadiness = (typeof PLANNED_READINESS)[number];

/** 更換現任的原因：弟弟較優、前任引退、無法供用、斷血補系、遊戲依史實引退、其他（需求規格 7.7）。 */
export const REPLACE_REASONS = [
  'betterBrother',
  'predecessorRetired',
  'unavailable',
  'recovery',
  'historicalRetirement',
  'other',
] as const;

export type ReplaceReason = (typeof REPLACE_REASONS)[number];

interface DutyBase {
  readonly id: string;
  readonly position: LinePosition;
  readonly generation: number;
  readonly startYear: number;
  /** 現任：離開在崗的年份。預定後繼：指定結束（改指定、取消或正式接任）的年份。 */
  readonly endYear?: number;
}

/** 現任種牡馬的任期；每系每代同時只有一匹在崗（需求規格 7.7）。 */
export interface CurrentDuty extends DutyBase {
  readonly role: 'current';
  readonly horseId: string;
  readonly dutyStatus: DutyStatus;
  /** 由更換現任結束任期時的原因。 */
  readonly replaceReason?: ReplaceReason;
  /** 由更換現任結束任期時的後任馬匹。 */
  readonly successorId?: string;
}

/**
 * 預定後繼（需求規格 7.7）：每系同時只有一筆進行中的指定（沒有 endYear）。尚未誕生時指向已受胎的
 * 八系指定配種（breedingId），其他就緒狀態指向馬匹（horseId）。
 */
export interface PlannedDuty extends DutyBase {
  readonly role: 'planned';
  readonly horseId?: string;
  readonly breedingId?: string;
  readonly readiness: PlannedReadiness;
}

/** 種牡馬任期（設計決策 5.2 節 `stallionDuties`）。 */
export type StallionDuty = CurrentDuty | PlannedDuty;

export function isOnDuty(duty: StallionDuty): duty is CurrentDuty {
  return duty.role === 'current' && duty.dutyStatus === 'onDuty';
}

export function isActivePlanned(duty: StallionDuty): duty is PlannedDuty {
  return duty.role === 'planned' && duty.endYear === undefined;
}

/** 更換現任後前任的狀態：引退類原因為已引退，無法供用為退出生產行列，其他為已被取代。 */
export function statusForReplaceReason(reason: ReplaceReason): DutyStatus {
  switch (reason) {
    case 'predecessorRetired':
    case 'historicalRetirement':
      return 'retired';
    case 'unavailable':
      return 'outOfService';
    case 'betterBrother':
    case 'recovery':
    case 'other':
      return 'replaced';
  }
}

/** 種牡馬提醒年齡（需求規格 7.7、LINE-26）：在崗現任達到提醒年齡時提醒準備後繼，只提示。 */
export function reachesStallionReminderAge(age: number | undefined, reminderAge: number): boolean {
  return age !== undefined && age >= reminderAge;
}
