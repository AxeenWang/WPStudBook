import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_SETTINGS, checkGameName, checkGameYears } from '../../src/domain/game.ts';

describe('遊戲局輸入檢查', () => {
  it('名稱全為空白時回報 nameBlank，含前後空白的名稱照樣接受', () => {
    expect(checkGameName('')).toBe('nameBlank');
    expect(checkGameName(' 　\t')).toBe('nameBlank');
    expect(checkGameName(' 第一局 ')).toBeUndefined();
  });

  it('年份必須是 1000～9999 的整數', () => {
    expect(checkGameYears(1968, 1968)).toBeUndefined();
    expect(checkGameYears(999, 1968)).toBe('yearInvalid');
    expect(checkGameYears(1968, 10000)).toBe('yearInvalid');
    expect(checkGameYears(1968.5, 1969)).toBe('yearInvalid');
    expect(checkGameYears(Number.NaN, 1969)).toBe('yearInvalid');
  });

  it('目前遊戲年不可早於起始年', () => {
    expect(checkGameYears(1970, 1969)).toBe('currentBeforeStart');
  });

  it('預設設定依設計決策 5.2 節，活力建議門檻未設定', () => {
    expect(DEFAULT_GAME_SETTINGS).toEqual({
      retirementAge: 25,
      highAgeReminderAge: 18,
      stallionAgeReminderAge: 26,
      checkpointRetention: 15,
      display: {},
    });
    expect('vitalityThreshold' in DEFAULT_GAME_SETTINGS).toBe(false);
  });
});
