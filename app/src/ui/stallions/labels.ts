import type { ChangeReason, DutyStatus, PlannedReadiness } from '../../domain/stallion-duty.ts';
import type { BrotherStatus } from '../../services/stallions.ts';

export const DUTY_STATUS_LABELS: Readonly<Record<DutyStatus, string>> = {
  onDuty: '在崗',
  replaced: '已被取代',
  outOfService: '退出生產行列',
  retired: '已引退',
};

export const READINESS_LABELS: Readonly<Record<PlannedReadiness, string>> = {
  unborn: '尚未誕生',
  racing: '競走中',
  retiredPendingAssignment: '已引退待指定',
  inService: '正式供用',
};

export const CHANGE_REASON_LABELS: Readonly<Record<ChangeReason, string>> = {
  brotherBetter: '弟弟較優',
  predecessorRetired: '前任引退',
  unavailable: '無法供用',
  recovery: '斷血補系',
  historicalRetirement: '遊戲依史實引退',
  other: '其他',
};

export const BROTHER_STATUS_LABELS: Readonly<Record<BrotherStatus, string>> = {
  ...DUTY_STATUS_LABELS,
  notCurrent: '未擔任現任',
};
