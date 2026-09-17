import { describe, expect, it } from 'vitest';
import {
  latestSnapshot,
  sameSnapshot,
  type StallionSnapshot,
  type StallionYearly,
} from '../../src/domain/stallion-yearly.ts';

const BASE: StallionSnapshot = {
  sp: 95,
  st: 88,
  subParams: { power: 'B', quickness: 'A' },
  subParamTotal: 45,
  kodashi: 8,
  studFee: 2450,
  record: { starts: 18, wins: 9 },
};

function omit(snapshot: StallionSnapshot, field: keyof StallionSnapshot): StallionSnapshot {
  return Object.fromEntries(Object.entries(snapshot).filter(([key]) => key !== field));
}

function yearly(gameYear: number, snapshot: StallionSnapshot): StallionYearly {
  return { id: `y${String(gameYear)}`, horseId: 'h1', gameYear, ...snapshot };
}

describe('種牡馬年度資料（需求規格 11.8、STL-11）', () => {
  it('內容相同時視為同一份，不必再寫一年', () => {
    expect(sameSnapshot(BASE, { ...BASE })).toBe(true);
    expect(sameSnapshot(BASE, { ...BASE, subParams: { quickness: 'A', power: 'B' } })).toBe(true);
  });

  it('任何一項不同就是新的一份', () => {
    expect(sameSnapshot(BASE, { ...BASE, sp: 96 })).toBe(false);
    expect(sameSnapshot(BASE, { ...BASE, studFee: 2500 })).toBe(false);
    expect(sameSnapshot(BASE, { ...BASE, kodashi: 9 })).toBe(false);
    expect(sameSnapshot(BASE, { ...BASE, subParams: { power: 'B+', quickness: 'A' } })).toBe(false);
    expect(sameSnapshot(BASE, { ...BASE, record: { starts: 18, wins: 10 } })).toBe(false);
  });

  it('未取得與有值不算相同，否則欄位變空白時會被當成沒變', () => {
    const withoutFee = omit(BASE, 'studFee');
    expect(sameSnapshot(BASE, withoutFee)).toBe(false);
    const withoutRecord = omit(BASE, 'record');
    expect(sameSnapshot(BASE, withoutRecord)).toBe(false);
    // 沒有戦績與空的戦績都是「一項都沒有」，算同一份。
    expect(sameSnapshot(withoutRecord, { ...withoutRecord, record: {} })).toBe(true);
  });

  it('舊年度照樣查得到，取最近一年的快照', () => {
    const records = [
      yearly(1968, BASE),
      yearly(1970, { ...BASE, studFee: 3000 }),
      yearly(1969, { ...BASE, studFee: 2600 }),
    ];
    expect(latestSnapshot(records)?.gameYear).toBe(1970);
    expect(latestSnapshot(records)?.studFee).toBe(3000);
    expect(latestSnapshot([])).toBeUndefined();
  });
});
