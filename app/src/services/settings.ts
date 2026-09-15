import { DEFAULT_GAME_SETTINGS, type GameSettings } from '../domain/game.ts';
import { GAME_SUBJECT_ID } from '../domain/history-event.ts';
import type { JsonObject } from '../domain/json.ts';
import { isVitalityValue } from '../domain/mare-yearly.ts';
import { modifyGameSettings, readGameSettings } from '../storage/games.ts';
import { trackWrite, type ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import { userEvent } from './events.ts';
import { gameTouch, requireCurrentGame } from './games.ts';

/** 本子計畫提供的提醒設定；定年與種牡馬提醒年齡在用到的子計畫加入。 */
export interface ReminderSettings {
  readonly highAgeReminderAge: number;
  /** 活力建議門檻；undefined 表示不使用。 */
  readonly vitalityThreshold: number | undefined;
}

export interface ReminderSettingsInput {
  readonly highAgeReminderAge: number | undefined;
  readonly vitalityThreshold: number | undefined;
}

const REMINDER_AGE_MAX = 99;

function reminderOf(settings: GameSettings): ReminderSettings {
  return {
    highAgeReminderAge: settings.highAgeReminderAge,
    vitalityThreshold: settings.vitalityThreshold,
  };
}

function reminderValue(settings: ReminderSettings): JsonObject {
  return {
    highAgeReminderAge: settings.highAgeReminderAge,
    ...(settings.vitalityThreshold === undefined
      ? {}
      : { vitalityThreshold: settings.vitalityThreshold }),
  };
}

function sameReminder(a: ReminderSettings, b: ReminderSettings): boolean {
  return (
    a.highAgeReminderAge === b.highAgeReminderAge && a.vitalityThreshold === b.vitalityThreshold
  );
}

export async function loadReminderSettings(context: ServiceContext): Promise<ReminderSettings> {
  const game = await requireCurrentGame(context);
  return reminderOf((await readGameSettings(context.database, game.id)) ?? DEFAULT_GAME_SETTINGS);
}

/** 高齡提醒年齡與活力建議門檻（需求規格 8.5、8.7）：只影響提示與排序。 */
export async function updateReminderSettings(
  context: ServiceContext,
  input: ReminderSettingsInput,
): Promise<ReminderSettings> {
  const game = await requireCurrentGame(context);
  const { highAgeReminderAge, vitalityThreshold } = input;
  const issues: string[] = [];
  if (
    highAgeReminderAge === undefined ||
    !Number.isInteger(highAgeReminderAge) ||
    highAgeReminderAge < 1 ||
    highAgeReminderAge > REMINDER_AGE_MAX
  ) {
    issues.push(`高齡提醒年齡必須是 1～${String(REMINDER_AGE_MAX)} 的整數`);
  }
  if (vitalityThreshold !== undefined && !isVitalityValue(vitalityThreshold)) {
    issues.push('活力建議門檻必須是 0～100 的整數，或留空不使用');
  }
  if (issues.length > 0 || highAgeReminderAge === undefined) {
    throw new ServiceError('invalidInput', issues.join('；'));
  }
  const next: ReminderSettings = { highAgeReminderAge, vitalityThreshold };
  const current = reminderOf(
    (await readGameSettings(context.database, game.id)) ?? DEFAULT_GAME_SETTINGS,
  );
  if (sameReminder(current, next)) {
    throw new ServiceError('invalidInput', '設定沒有變更');
  }
  const now = context.now().toISOString();
  const saved = await trackWrite(context, () =>
    modifyGameSettings(context.database, {
      gameId: game.id,
      touch: gameTouch(context, now),
      apply: ({ game: stored, settings }) => {
        const before = reminderOf(settings);
        if (sameReminder(before, next)) {
          throw new ServiceError('invalidInput', '設定沒有變更');
        }
        // 逐欄列出，其他設定沿用交易內讀出的值；vitalityThreshold 為 undefined 時不保存欄位。
        const updated: GameSettings = {
          retirementAge: settings.retirementAge,
          highAgeReminderAge,
          stallionAgeReminderAge: settings.stallionAgeReminderAge,
          ...(vitalityThreshold === undefined ? {} : { vitalityThreshold }),
          checkpointRetention: settings.checkpointRetention,
          display: settings.display,
        };
        const event = userEvent(context, {
          subjectId: GAME_SUBJECT_ID,
          type: 'settingsChanged',
          gameYear: stored.currentYear,
          occurredAt: now,
          before: reminderValue(before),
          after: reminderValue(next),
        });
        return { settings: updated, event };
      },
    }),
  );
  return reminderOf(saved);
}
