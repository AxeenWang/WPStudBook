import { describe, expect, it } from 'vitest';
import {
  MAX_REPORTED_ISSUES,
  readGameSummary,
  validateCollections,
} from '../../src/storage/backup/collections.ts';
import { emptyCollections } from '../../src/storage/backup/document.ts';

const SETTINGS = {
  retirementAge: 25,
  highAgeReminderAge: 18,
  stallionAgeReminderAge: 26,
  checkpointRetention: 15,
  display: {},
};

function collections(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...emptyCollections(), gameSettings: [SETTINGS], ...overrides };
}

function horse(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, sex: 'male', stageNumbers: [], aliases: [], ...extra };
}

/** 通過 mares 欄位規則的最小紀錄，用來測試關聯。 */
function mare(id: string): Record<string, unknown> {
  return { id, group: { kind: 'unassigned' }, origin: 'other', status: 'producing', site: 32 };
}

function issueCodes(result: ReturnType<typeof validateCollections>): string[] {
  return result.ok ? [] : result.issues.map((item) => item.code);
}

describe('validateCollections', () => {
  it('合格的資料通過，並剔除 horses.nameKeys', () => {
    const result = validateCollections(
      collections({
        horses: [
          horse('sire', { fullName: 'テストシュボバ', nameKeys: ['old-gameテストシュボバ'] }),
          horse('foal', {
            sireId: 'sire',
            sireName: '(外)ソトノチチ',
            femaleLine: '',
            abilityNo: 0,
          }),
        ],
        mares: [mare('foal')],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.collections.horses[0]).toEqual(horse('sire', { fullName: 'テストシュボバ' }));
      expect(result.collections.horses[1]).toEqual(
        horse('foal', { sireId: 'sire', sireName: '(外)ソトノチチ', femaleLine: '', abilityNo: 0 }),
      );
    }
  });

  it('缺少或不認得的資料表回報欄位錯誤', () => {
    const input = collections({ unknownTable: [] });
    delete input.horses;
    const result = validateCollections(input);
    expect(result.ok ? undefined : result.stage).toBe('fields');
    expect(issueCodes(result).sort()).toEqual(['missingCollection', 'unknownCollection']);
  });

  it('紀錄缺少 id、帶有 gameId 或含 null 時回報欄位錯誤', () => {
    const result = validateCollections(
      collections({
        horses: [{ fullName: 'x' }, horse('h1', { gameId: 'g1' }), horse('h2', { sireName: null })],
      }),
    );
    expect(issueCodes(result)).toEqual(['recordInvalid', 'recordInvalid', 'recordInvalid']);
  });

  it('gameSettings 必須剛好一筆且欄位合格', () => {
    expect(
      issueCodes(validateCollections(collections({ gameSettings: [SETTINGS, SETTINGS] }))),
    ).toEqual(['settingsInvalid']);
    expect(
      issueCodes(
        validateCollections(
          collections({
            gameSettings: [{ ...SETTINGS, retirementAge: 0, vitalityThreshold: 101 }],
          }),
        ),
      ),
    ).toEqual(['settingsInvalid', 'settingsInvalid']);
  });

  it('[DATA-04] 同一資料表有重複的 id 時回報識別錯誤', () => {
    const result = validateCollections(collections({ horses: [horse('h1'), horse('h1')] }));
    expect(result.ok ? undefined : result.stage).toBe('relations');
    expect(issueCodes(result)).toEqual(['duplicateId']);
  });

  it('[DATA-04] 違反唯一索引時回報；缺少索引欄位的紀錄不檢查', () => {
    const result = validateCollections(
      collections({
        horses: [
          horse('h1', { abilityNo: 0, birthYear: 1965 }),
          horse('h2', { abilityNo: 0, birthYear: 1965 }),
          horse('h3', { birthYear: 1965 }),
          horse('h4', { birthYear: 1965 }),
        ],
      }),
    );
    expect(issueCodes(result)).toEqual(['uniqueConflict']);
  });

  it('[DATA-04] 唯一索引欄位是陣列時也檢查重複', () => {
    const result = validateCollections(
      collections({
        horses: [horse('h1')],
        matingRatings: [
          { id: 'r1', stallionId: 'h1', mareId: 'h1', gameYear: [1968, 5] },
          { id: 'r2', stallionId: 'h1', mareId: 'h1', gameYear: [1968, 5] },
        ],
      }),
    );
    expect(issueCodes(result)).toEqual(['uniqueConflict']);
  });

  it('[DATA-04] 內部 id 參照不存在時回報缺少關聯；只有外部名稱時不檢查', () => {
    const result = validateCollections(
      collections({
        horses: [horse('h1', { sireId: 'missing' }), horse('h2', { sireName: '(外)ソトノチチ' })],
        mares: [mare('not-a-horse')],
      }),
    );
    expect(issueCodes(result)).toEqual(['missingReference', 'missingReference']);
  });

  it('欄位規則不符時回報 recordInvalid，指出資料表、位置、id 與問題', () => {
    const result = validateCollections(
      collections({ horses: [horse('h1'), horse('h2', { sex: 'unknown' })] }),
    );
    expect(result.ok ? undefined : result.stage).toBe('fields');
    expect(result.ok ? [] : result.issues).toEqual([
      { code: 'recordInvalid', message: 'horses[1]（id h2）：sex 必須是 male 或 female' },
    ]);
  });

  it('錯誤最多回報 20 筆', () => {
    const horses = Array.from({ length: 30 }, () => ({ fullName: '沒有 id' }));
    const result = validateCollections(collections({ horses }));
    expect(issueCodes(result)).toHaveLength(MAX_REPORTED_ISSUES);
  });
});

describe('readGameSummary', () => {
  it('取出局名、起始年與目前遊戲年，忽略其他欄位', () => {
    expect(
      readGameSummary({ name: 'テスト局', startYear: 1968, currentYear: 1969, extra: true }),
    ).toEqual({ ok: true, game: { name: 'テスト局', startYear: 1968, currentYear: 1969 } });
  });

  it('局名空白、年份不是整數或目前遊戲年早於起始年時拒絕', () => {
    expect(readGameSummary({ name: ' ', startYear: 1968, currentYear: 1968 }).ok).toBe(false);
    expect(readGameSummary({ name: 'a', startYear: '1968', currentYear: 1968 }).ok).toBe(false);
    expect(readGameSummary({ name: 'a', startYear: 1970, currentYear: 1969 }).ok).toBe(false);
    expect(readGameSummary(undefined).ok).toBe(false);
  });
});
