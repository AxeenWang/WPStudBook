import type { LinePosition } from './line.ts';

export type StallionRole = 'current' | 'planned';

export type DutyStatus = 'onDuty' | 'replaced' | 'outOfService' | 'retired';

/**
 * 種牡馬任期（設計決策 5.2 節 `stallionDuties`）。本子計畫只寫入零代市場種牡馬的現任任期；
 * 預定後繼、卸任年份與更換原因在子計畫 2-4 加入。
 */
export interface StallionDuty {
  readonly id: string;
  readonly position: LinePosition;
  readonly generation: number;
  readonly horseId: string;
  readonly role: StallionRole;
  readonly dutyStatus: DutyStatus;
  readonly startYear: number;
}
