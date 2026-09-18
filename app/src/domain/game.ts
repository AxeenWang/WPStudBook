import type { ImportType } from './import-type.ts';

export interface LastBackup {
  readonly fileName: string;
  readonly exportedAt: string;
  readonly sizeBytes: number;
  readonly recordCount: number;
}

export interface Game {
  readonly id: string;
  readonly name: string;
  readonly startYear: number;
  readonly currentYear: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** 最後寫入此局的程式版本（需求規格 12.1「版本」）。 */
  readonly appVersion: string;
  readonly lastBackup?: LastBackup;
}

export type DisplaySettings = Readonly<Record<string, string | number | boolean>>;

/**
 * 年度工作清單的人工更正（需求規格 13.2「可人工更正」）：某一年某一項的完成狀態不依匯入紀錄推導，
 * 改用使用者指定的值。與匯入紀錄推導的結果相同時不保存，清單就回到自動標示。
 */
export interface AnnualWorkCorrection {
  readonly gameYear: number;
  readonly type: ImportType;
  readonly done: boolean;
}

export interface GameSettings {
  readonly retirementAge: number;
  readonly highAgeReminderAge: number;
  readonly stallionAgeReminderAge: number;
  readonly vitalityThreshold?: number;
  readonly checkpointRetention: number;
  readonly display: DisplaySettings;
  /** 沒有更正時不保存。 */
  readonly annualWorkCorrections?: readonly AnnualWorkCorrection[];
}

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  retirementAge: 25,
  highAgeReminderAge: 18,
  stallionAgeReminderAge: 26,
  checkpointRetention: 15,
  display: {},
};

export const MIN_GAME_YEAR = 1000;
export const MAX_GAME_YEAR = 9999;

export type GameInputIssue = 'nameBlank' | 'yearInvalid' | 'currentBeforeStart';

export function checkGameName(name: string): GameInputIssue | undefined {
  return name.trim() === '' ? 'nameBlank' : undefined;
}

function isGameYear(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_GAME_YEAR && value <= MAX_GAME_YEAR;
}

export function checkGameYears(startYear: number, currentYear: number): GameInputIssue | undefined {
  if (!isGameYear(startYear) || !isGameYear(currentYear)) {
    return 'yearInvalid';
  }
  return currentYear < startYear ? 'currentBeforeStart' : undefined;
}
