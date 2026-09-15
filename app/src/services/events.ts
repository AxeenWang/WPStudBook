import type { HistoryEvent, HistoryEventType } from '../domain/history-event.ts';
import type { JsonValue } from '../domain/json.ts';
import type { Timing } from '../domain/timing.ts';
import type { ServiceContext } from './context.ts';

export interface UserEventInput {
  readonly subjectId: string;
  readonly type: HistoryEventType;
  readonly gameYear: number;
  readonly timing?: Timing | undefined;
  readonly occurredAt: string;
  readonly before?: JsonValue | undefined;
  readonly after?: JsonValue | undefined;
}

/** 使用者操作產生的事件；沒有時點、前值或後值時不寫該欄位（設計決策 5.3 節）。 */
export function userEvent(context: ServiceContext, input: UserEventInput): HistoryEvent {
  return {
    id: context.newId(),
    subjectId: input.subjectId,
    type: input.type,
    gameYear: input.gameYear,
    ...(input.timing === undefined ? {} : { timing: input.timing }),
    ...(input.before === undefined ? {} : { before: input.before }),
    ...(input.after === undefined ? {} : { after: input.after }),
    source: 'user',
    occurredAt: input.occurredAt,
  };
}
