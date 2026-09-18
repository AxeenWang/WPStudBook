export { OUTCOME_LABELS } from '../import-labels.ts';

export function formatTiming(month: number, week: number): string {
  return `${String(month)} 月 ${String(week)} 週`;
}
