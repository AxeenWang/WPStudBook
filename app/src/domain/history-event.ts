import type { JsonValue } from './json.ts';
import type { Timing } from './timing.ts';

/** 整局層級事件的對象。不使用 gameId，還原為新遊戲局時不必改寫事件。 */
export const GAME_SUBJECT_ID = 'game';

export type HistoryEventType =
  | 'gameYearChanged'
  | 'schemaMigrated'
  /** 系統對照表新增、修改或刪除；subjectId 為對照表紀錄 id。 */
  | 'systemMapChanged'
  /** 手動建立馬匹；subjectId 為馬匹 id。 */
  | 'horseCreated'
  /** 開啟系位置；subjectId 為系位置 id。 */
  | 'lineOpened'
  /** 種牡馬開始任期；subjectId 為馬匹 id。 */
  | 'stallionDutyStarted';

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
