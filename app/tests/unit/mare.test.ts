import { describe, expect, it } from 'vitest';
import {
  ageInYear,
  checkMarketGroup,
  checkSubstituteSire,
  defaultMarketOrigin,
  effectiveYearPlan,
  isHighAge,
  isMareSite,
  isSameGroup,
  mareGeneration,
  marketGroupFor,
} from '../../src/domain/mare.ts';
import {
  currentVitality,
  isBelowThreshold,
  isCeExtendedKodashi,
  isKodashi,
  isVitalityValue,
  latestYearlyValue,
  yearlyRecordFor,
  type MareYearly,
} from '../../src/domain/mare-yearly.ts';

const SYSTEM_MAP = [
  { id: 'm1', subsystem: 'マンノウォー', parentSystem: 'マッチェム' },
  { id: 'm2', subsystem: 'ネアルコ', parentSystem: 'ネアルコ' },
  { id: 'm3', subsystem: 'ロイヤルチャージャー', parentSystem: 'ネアルコ' },
];
const LINES = [{ position: 1 as const, parentSystem: 'ネアルコ' }];

describe('母馬群', () => {
  it('市場母馬入群：代數 0 只能是第 1 系起點母馬群，1 以上為替代；系與代數必須是整數範圍', () => {
    expect(checkMarketGroup(1, 0)).toBeUndefined();
    expect(checkMarketGroup(8, 12)).toBeUndefined();
    expect(checkMarketGroup(2, 0)).toBe('starterOnlyFirstLine');
    expect(checkMarketGroup(0, 1)).toBe('positionInvalid');
    expect(checkMarketGroup(9, 1)).toBe('positionInvalid');
    expect(checkMarketGroup(1, -1)).toBe('generationInvalid');
    expect(checkMarketGroup(1, 1.5)).toBe('generationInvalid');
    expect(checkMarketGroup(1, 10000)).toBe('generationInvalid');
    expect(marketGroupFor(1, 0)).toEqual({ kind: 'starter', position: 1, generation: 0 });
    expect(marketGroupFor(2, 1)).toEqual({ kind: 'substitute', position: 2, generation: 1 });
  });

  it('[LINE-07] 起點用與替代的市場母馬本身為零代，自家母馬為所屬世代，待指定用途未知', () => {
    expect(mareGeneration({ kind: 'starter', position: 1, generation: 0 })).toBe(0);
    expect(mareGeneration({ kind: 'substitute', position: 3, generation: 6 })).toBe(0);
    expect(mareGeneration({ kind: 'own', position: 3, generation: 6 })).toBe(6);
    expect(mareGeneration({ kind: 'unassigned' })).toBeUndefined();
  });

  it('同一個母馬群比對系與代數，不分自家或替代', () => {
    expect(isSameGroup({ kind: 'own', position: 3, generation: 3 }, 3, 3)).toBe(true);
    expect(isSameGroup({ kind: 'substitute', position: 3, generation: 3 }, 3, 3)).toBe(true);
    expect(isSameGroup({ kind: 'substitute', position: 3, generation: 2 }, 3, 3)).toBe(false);
    expect(isSameGroup({ kind: 'unassigned' }, 3, 3)).toBe(false);
  });

  it('預設來源：起點用或替代尚未開啟的系為市場創系，替代已開啟的系為市場補血', () => {
    expect(defaultMarketOrigin({ kind: 'starter', position: 1, generation: 0 }, [1])).toBe(
      'marketFound',
    );
    expect(defaultMarketOrigin({ kind: 'substitute', position: 2, generation: 1 }, [1])).toBe(
      'marketFound',
    );
    expect(defaultMarketOrigin({ kind: 'substitute', position: 1, generation: 2 }, [1])).toBe(
      'marketReplenish',
    );
  });

  it('[MARE-18] 繋養牧場番号只接受 32～35', () => {
    expect([32, 33, 34, 35].every(isMareSite)).toBe(true);
    expect([0, 31, 36].some(isMareSite)).toBe(false);
  });
});

describe('年齡、今年計畫與替代判斷', () => {
  it('[MARE-25] 年齡為遊戲年減出生年；達到提醒年齡才提示，提醒年齡改變後依新年齡判斷', () => {
    const age = ageInYear(1950, 1968);
    expect(age).toBe(18);
    expect(isHighAge(age, 18)).toBe(true);
    expect(isHighAge(age, 19)).toBe(false);
    expect(isHighAge(ageInYear(undefined, 1968), 18)).toBe(false);
  });

  it('[MARE-22] 今年計畫只在設定年份等於目前遊戲年時有效，否則為待定', () => {
    expect(effectiveYearPlan({ plan: 'rest', gameYear: 1968 }, 1968)).toBe('rest');
    expect(effectiveYearPlan({ plan: 'rest', gameYear: 1968 }, 1969)).toBe('undecided');
    expect(effectiveYearPlan(undefined, 1968)).toBe('undecided');
  });

  it('[LINE-29] 替代母馬自身父系的親系統與該系不同時為不同；相同時通過', () => {
    const substitute = { kind: 'substitute' as const, position: 1 as const, generation: 2 };
    expect(checkSubstituteSire(substitute, 'マンノウォー', SYSTEM_MAP, LINES)).toEqual({
      result: 'differentParentSystem',
      sireParentSystem: 'マッチェム',
      lineParentSystem: 'ネアルコ',
    });
    expect(checkSubstituteSire(substitute, 'ロイヤルチャージャー', SYSTEM_MAP, LINES)).toEqual({
      result: 'sameParentSystem',
    });
  });

  it('[LINE-29] 自身父系留空、該系尚未成立或對照表查不到時無法判斷；非替代母馬不判斷', () => {
    const substitute = { kind: 'substitute' as const, position: 1 as const, generation: 2 };
    expect(checkSubstituteSire(substitute, undefined, SYSTEM_MAP, LINES)).toEqual({
      result: 'undetermined',
      reason: 'sireSubsystemMissing',
    });
    expect(
      checkSubstituteSire({ ...substitute, position: 2 }, 'マンノウォー', SYSTEM_MAP, LINES),
    ).toEqual({ result: 'undetermined', reason: 'lineNotOpened' });
    expect(checkSubstituteSire(substitute, 'テストケイ', SYSTEM_MAP, LINES)).toEqual({
      result: 'undetermined',
      reason: 'notInSystemMap',
    });
    expect(
      checkSubstituteSire(
        { kind: 'starter', position: 1, generation: 0 },
        'マンノウォー',
        SYSTEM_MAP,
        LINES,
      ),
    ).toEqual({ result: 'notSubstitute' });
  });
});

function yearly(gameYear: number, fields: Partial<MareYearly> = {}): MareYearly {
  return { id: `y${String(gameYear)}`, horseId: 'mare-1', gameYear, ...fields };
}

describe('年度資料', () => {
  it('[MARE-13] 活力 0、73、100 都是有效確認值；只看目前遊戲年，7 月優先；沒有確認值為待更新；已離圈為不適用', () => {
    expect([0, 73, 100].every(isVitalityValue)).toBe(true);
    expect([-1, 101, 7.5].some(isVitalityValue)).toBe(false);

    const may = { state: 'confirmed', value: 0, boosted: false } as const;
    const july = { state: 'confirmed', value: 100, boosted: false } as const;
    expect(currentVitality('producing', yearly(1968, { vitalityMay: may }))).toEqual({
      vitality: may,
      month: 5,
    });
    expect(
      currentVitality('producing', yearly(1968, { vitalityMay: may, vitalityJuly: july })),
    ).toEqual({ vitality: july, month: 7 });
    expect(
      currentVitality('producing', yearly(1968, { vitalityMay: may, vitalityJuly: { state: 'pending' } })),
    ).toEqual({ vitality: may, month: 5 });
    expect(currentVitality('producing', undefined)).toEqual({
      vitality: { state: 'pending' },
      month: undefined,
    });
    expect(currentVitality('left', yearly(1968, { vitalityJuly: july }))).toEqual({
      vitality: { state: 'notApplicable' },
      month: undefined,
    });
    expect(yearlyRecordFor([yearly(1967), yearly(1968)], 1968)?.id).toBe('y1968');
    expect(yearlyRecordFor([yearly(1967)], 1968)).toBeUndefined();
  });

  it('[MARE-16] 活力建議門檻只判斷低於門檻的確認值；増強中視為達到門檻；沒有門檻時不提示', () => {
    const low = { state: 'confirmed', value: 40, boosted: false } as const;
    expect(isBelowThreshold(low, 50)).toBe(true);
    expect(isBelowThreshold({ ...low, value: 50 }, 50)).toBe(false);
    expect(isBelowThreshold({ ...low, value: 13, boosted: true }, 50)).toBe(false);
    expect(isBelowThreshold({ state: 'pending' }, 50)).toBe(false);
    expect(isBelowThreshold(low, undefined)).toBe(false);
  });

  it('[MARE-17] 仔出接受 0～15，11～15 為 CE 擴充值；最新年度值略過沒有值的年度，0 是有效值', () => {
    expect([0, 10, 11, 15].every(isKodashi)).toBe(true);
    expect([-1, 16, 3.5].some(isKodashi)).toBe(false);
    expect([10, 11, 15].map(isCeExtendedKodashi)).toEqual([false, true, true]);
    const records = [yearly(1966, { kodashi: 12 }), yearly(1968), yearly(1967, { kodashi: 0 })];
    expect(latestYearlyValue(records, 'kodashi')).toEqual({ value: 0, gameYear: 1967 });
    expect(latestYearlyValue([yearly(1968)], 'kodashi')).toBeUndefined();
  });
});
