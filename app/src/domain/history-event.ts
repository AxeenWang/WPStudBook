import type { JsonValue } from './json.ts';
import type { Timing } from './timing.ts';

/** 整局層級事件的對象。不使用 gameId，還原為新遊戲局時不必改寫事件。 */
export const GAME_SUBJECT_ID = 'game';

export type HistoryEventType = 'gameYearChanged' | 'schemaMigrated';

export type HistoryEventSource = 'user' | 'migration';

export interface HistoryEvent {
  readonly id: string;
  readonly subjectId: string;
  readonly type: HistoryEventType;
  readonly gameYear: number;
  readonly timing?: Timing;
  readonly before?: JsonValue;
  readonly after?: JsonValue;
  readonly source: HistoryEventSource;
  readonly occurredAt: string;
}
