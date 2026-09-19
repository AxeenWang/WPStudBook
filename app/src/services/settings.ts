import { DEFAULT_GAME_SETTINGS, type GameSettings } from '../domain/game.ts';
import { GAME_SUBJECT_ID } from '../domain/history-event.ts';
import type { JsonObject } from '../domain/json.ts';
import { isVitalityValue } from '../domain/mare-yearly.ts';
import { modifyGameSettings, readGameSettings } from '../storage/games.ts';
import { trackWrite, type ServiceContext } from './context.ts';
import { InputIssues, ServiceError } from './errors.ts';
import { userEvent } from './events.ts';
import { gameTouch, requireCurrentGame } from './games.ts';

/** 遊戲局的規則與提醒設定（需求規格 8.5、8.7、12.1）。 */
export interface GameRuleSettings {
  /** 定年：達到這個年齡的母馬不再列入任務，五月匯入的缺席者預設定年引退（8.5、MARE-09）。 */
  readonly retirementAge: number;
  readonly highAgeReminderAge: number;
  readonly stallionAgeReminderAge: number;
  /** 活力建議門檻；undefined 表示不使用。 */
  readonly vitalityThreshold: number | undefined;
}

export interface GameRuleSettingsInput {
  readonly retirementAge: number | undefined;
  readonly highAgeReminderAge: number | undefined;
  readonly stallionAgeReminderAge: number | undefined;
  readonly vitalityThreshold: number | undefined;
}

const REMINDER_AGE_MAX = 99;

function ruleSettingsOf(settings: GameSettings): GameRuleSettings {
  return {
    retirementAge: settings.retirementAge,
    highAgeReminderAge: settings.highAgeReminderAge,
    stallionAgeReminderAge: settings.stallionAgeReminderAge,
    vitalityThreshold: settings.vitalityThreshold,
  };
}

function ruleSettingsValue(settings: GameRuleSettings): JsonObject {
  return {
    retirementAge: settings.retirementAge,
    highAgeReminderAge: settings.highAgeReminderAge,
    stallionAgeReminderAge: settings.stallionAgeReminderAge,
    ...(settings.vitalityThreshold === undefined
      ? {}
      : { vitalityThreshold: settings.vitalityThreshold }),
  };
}

function sameRuleSettings(a: GameRuleSettings, b: GameRuleSettings): boolean {
  return (
    a.retirementAge === b.retirementAge &&
    a.highAgeReminderAge === b.highAgeReminderAge &&
    a.stallionAgeReminderAge === b.stallionAgeReminderAge &&
    a.vitalityThreshold === b.vitalityThreshold
  );
}

export async function loadGameRuleSettings(context: ServiceContext): Promise<GameRuleSettings> {
  const game = await requireCurrentGame(context);
  return ruleSettingsOf(
    (await readGameSettings(context.database, game.id)) ?? DEFAULT_GAME_SETTINGS,
  );
}

function isReminderAge(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value >= 1 && value <= REMINDER_AGE_MAX;
}

/**
 * 定年、高齡提醒年齡、種牡馬提醒年齡與活力建議門檻（需求規格 7.7、8.5、8.7）。
 * 定年會改變判斷（是否列入任務、五月缺席者的預設處置，MARE-10），其餘只影響提示與排序。
 */
export async function updateGameRuleSettings(
  context: ServiceContext,
  input: GameRuleSettingsInput,
): Promise<GameRuleSettings> {
  const game = await requireCurrentGame(context);
  const { retirementAge, highAgeReminderAge, stallionAgeReminderAge, vitalityThreshold } = input;
  const issues = new InputIssues();
  if (!isReminderAge(retirementAge)) {
    issues.add('retirementAge', `定年必須是 1～${String(REMINDER_AGE_MAX)} 的整數`);
  }
  if (!isReminderAge(highAgeReminderAge)) {
    issues.add('highAgeReminderAge', `高齡提醒年齡必須是 1～${String(REMINDER_AGE_MAX)} 的整數`);
  }
  if (!isReminderAge(stallionAgeReminderAge)) {
    issues.add(
      'stallionAgeReminderAge',
      `種牡馬提醒年齡必須是 1～${String(REMINDER_AGE_MAX)} 的整數`,
    );
  }
  if (vitalityThreshold !== undefined && !isVitalityValue(vitalityThreshold)) {
    issues.add('vitalityThreshold', '活力建議門檻必須是 0～100 的整數，或留空不使用');
  }
  issues.throwIfAny();
  if (
    !isReminderAge(retirementAge) ||
    !isReminderAge(highAgeReminderAge) ||
    !isReminderAge(stallionAgeReminderAge)
  ) {
    throw new ServiceError('invalidInput', '設定不完整');
  }
  const next: GameRuleSettings = {
    retirementAge,
    highAgeReminderAge,
    stallionAgeReminderAge,
    vitalityThreshold,
  };
  const current = ruleSettingsOf(
    (await readGameSettings(context.database, game.id)) ?? DEFAULT_GAME_SETTINGS,
  );
  if (sameRuleSettings(current, next)) {
    throw new ServiceError('invalidInput', '設定沒有變更');
  }
  const now = context.now().toISOString();
  const saved = await trackWrite(context, () =>
    modifyGameSettings(context.database, {
      gameId: game.id,
      touch: gameTouch(context, now),
      apply: ({ game: stored, settings }) => {
        const before = ruleSettingsOf(settings);
        if (sameRuleSettings(before, next)) {
          throw new ServiceError('invalidInput', '設定沒有變更');
        }
        // 逐欄列出，其他設定沿用交易內讀出的值；vitalityThreshold 為 undefined 時不保存欄位。
        const updated: GameSettings = {
          retirementAge,
          highAgeReminderAge,
          stallionAgeReminderAge,
          ...(vitalityThreshold === undefined ? {} : { vitalityThreshold }),
          checkpointRetention: settings.checkpointRetention,
          display: settings.display,
          ...(settings.annualWorkCorrections === undefined
            ? {}
            : { annualWorkCorrections: settings.annualWorkCorrections }),
        };
        const event = userEvent(context, {
          subjectId: GAME_SUBJECT_ID,
          type: 'settingsChanged',
          gameYear: stored.currentYear,
          occurredAt: now,
          before: ruleSettingsValue(before),
          after: ruleSettingsValue(next),
        });
        return { settings: updated, event };
      },
    }),
  );
  return ruleSettingsOf(saved);
}
