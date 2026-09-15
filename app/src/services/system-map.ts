import type { HistoryEvent } from '../domain/history-event.ts';
import type { JsonValue } from '../domain/json.ts';
import { stripSystemSuffix, type SystemMapEntry } from '../domain/system-map.ts';
import { listEventsOfType } from '../storage/events.ts';
import {
  findSystemMapEntry,
  getSystemMapEntry,
  listSystemMapEntries,
  writeSystemMapChange,
} from '../storage/system-map.ts';
import { trackWrite, type ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import { userEvent } from './events.ts';
import { gameTouch, requireCurrentGame } from './games.ts';

/** 手動輸入的系統名稱：去掉前後空白與結尾「系」。 */
export function normalizeSystemInput(text: string): string {
  return stripSystemSuffix(text.trim());
}

export interface SystemMapInput {
  readonly subsystem: string;
  readonly parentSystem: string;
}

/** 型別別名（不是 interface），才能直接作為事件的 JsonValue。 */
export type SystemMapValue = { readonly subsystem: string; readonly parentSystem: string };

export interface SystemMapChange {
  readonly id: string;
  readonly gameYear: number;
  readonly occurredAt: string;
  readonly before?: SystemMapValue;
  readonly after?: SystemMapValue;
}

function valueOf(entry: SystemMapEntry): SystemMapValue {
  return { subsystem: entry.subsystem, parentSystem: entry.parentSystem };
}

export async function listSystemMap(context: ServiceContext): Promise<SystemMapEntry[]> {
  const game = await requireCurrentGame(context);
  const entries = await listSystemMapEntries(context.database, game.id);
  return entries.sort((a, b) => a.subsystem.localeCompare(b.subsystem, 'ja'));
}

export async function findParentSystem(
  context: ServiceContext,
  subsystemText: string,
): Promise<string | undefined> {
  const game = await requireCurrentGame(context);
  const subsystem = normalizeSystemInput(subsystemText);
  if (subsystem === '') {
    return undefined;
  }
  return (await findSystemMapEntry(context.database, game.id, subsystem))?.parentSystem;
}

/** 以子系統為鍵新增或更新（升格）對照，保存變更年份（需求規格 7.2）。 */
export async function saveSystemMapEntry(
  context: ServiceContext,
  input: SystemMapInput,
): Promise<SystemMapEntry> {
  const game = await requireCurrentGame(context);
  const subsystem = normalizeSystemInput(input.subsystem);
  const parentSystem = normalizeSystemInput(input.parentSystem);
  if (subsystem === '' || parentSystem === '') {
    throw new ServiceError('invalidInput', '請輸入子系統與親系統');
  }
  const existing = await findSystemMapEntry(context.database, game.id, subsystem);
  if (existing?.parentSystem === parentSystem) {
    throw new ServiceError(
      'invalidInput',
      `系統對照表已記載「${subsystem}」的親系統是「${parentSystem}」`,
    );
  }
  const entry: SystemMapEntry = { id: existing?.id ?? context.newId(), subsystem, parentSystem };
  const now = context.now().toISOString();
  const event = userEvent(context, {
    subjectId: entry.id,
    type: 'systemMapChanged',
    gameYear: game.currentYear,
    occurredAt: now,
    before: existing === undefined ? undefined : valueOf(existing),
    after: valueOf(entry),
  });
  await trackWrite(context, () =>
    writeSystemMapChange(context.database, {
      gameId: game.id,
      touch: gameTouch(context, now),
      put: entry,
      event,
    }),
  );
  return entry;
}

/** 刪除對照；歷程保留刪除前的內容。 */
export async function deleteSystemMapEntry(
  context: ServiceContext,
  entryId: string,
): Promise<void> {
  const game = await requireCurrentGame(context);
  const entry = await getSystemMapEntry(context.database, game.id, entryId);
  if (entry === undefined) {
    throw new ServiceError('invalidInput', '系統對照表找不到這筆紀錄');
  }
  const now = context.now().toISOString();
  const event = userEvent(context, {
    subjectId: entry.id,
    type: 'systemMapChanged',
    gameYear: game.currentYear,
    occurredAt: now,
    before: valueOf(entry),
  });
  await trackWrite(context, () =>
    writeSystemMapChange(context.database, {
      gameId: game.id,
      touch: gameTouch(context, now),
      deleteId: entry.id,
      event,
    }),
  );
}

function readValue(value: JsonValue | undefined): SystemMapValue | undefined {
  if (typeof value !== 'object') {
    return undefined;
  }
  const subsystem: unknown = Reflect.get(value, 'subsystem');
  const parentSystem: unknown = Reflect.get(value, 'parentSystem');
  return typeof subsystem === 'string' && typeof parentSystem === 'string'
    ? { subsystem, parentSystem }
    : undefined;
}

function toChange(event: HistoryEvent): SystemMapChange {
  const before = readValue(event.before);
  const after = readValue(event.after);
  return {
    id: event.id,
    gameYear: event.gameYear,
    occurredAt: event.occurredAt,
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
  };
}

/** 對照表變更歷程，新到舊。 */
export async function listSystemMapHistory(context: ServiceContext): Promise<SystemMapChange[]> {
  const game = await requireCurrentGame(context);
  const events = await listEventsOfType(context.database, game.id, 'systemMapChanged');
  return events
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id))
    .map(toChange);
}
