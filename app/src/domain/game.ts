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

export interface GameSettings {
  readonly retirementAge: number;
  readonly highAgeReminderAge: number;
  readonly stallionAgeReminderAge: number;
  readonly vitalityThreshold?: number;
  readonly checkpointRetention: number;
  readonly display: DisplaySettings;
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
