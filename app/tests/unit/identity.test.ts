import { describe, expect, it } from 'vitest';
import {
  findDuplicateAbilityNos,
  inferBirthYear,
  matchHorseIdentity,
  type KnownHorse,
} from '../../src/domain/identity.ts';

const KNOWN: readonly KnownHorse[] = [
  {
    id: 'mare-a',
    abilityNo: 0x0100,
    birthYear: 1962,
    names: ['テストヒンバ'],
    sireName: 'テストチチ',
    damName: 'テストハハ',
  },
  { id: 'foal-b', abilityNo: 0x0000, birthYear: 1968, names: [] },
  { id: 'manual-c', birthYear: 1965, names: ['テストシュドウ'] },
  { id: 'manual-d', names: ['ドウメイ'] },
  { id: 'manual-e', names: ['ドウメイ'] },
  { id: 'mare-f', abilityNo: 0x0200, birthYear: 1960, names: ['バンゴウアリ'] },
];

describe('同一匹馬判斷（需求規格 6.2）', () => {
  it('能力番号與出生年都相同時為同一匹馬；能力番号 0 是有效值，既有紀錄沒有名稱時不比對名稱', () => {
    expect(
      matchHorseIdentity(
        { abilityNo: 0x0100, birthYear: 1962, names: ['テストヒンバ'], sireName: 'テストチチ' },
        KNOWN,
      ),
    ).toEqual({ kind: 'same', horseId: 'mare-a' });
    expect(
      matchHorseIdentity({ abilityNo: 0, birthYear: 1968, names: ['テストメイ'] }, KNOWN),
    ).toEqual({ kind: 'same', horseId: 'foal-b' });
  });

  it('名稱比較忽略前後空白', () => {
    expect(
      matchHorseIdentity({ abilityNo: 0x0100, birthYear: 1962, names: [' テストヒンバ '] }, KNOWN),
    ).toEqual({ kind: 'same', horseId: 'mare-a' });
  });

  it('能力番号相同、出生年不同時是回收的番号，建立新馬', () => {
    expect(
      matchHorseIdentity({ abilityNo: 0x0100, birthYear: 1975, names: ['シンバ'] }, KNOWN),
    ).toEqual({ kind: 'new' });
  });

  it('兩者都相同但馬名或父母不符時為衝突', () => {
    expect(
      matchHorseIdentity({ abilityNo: 0x0100, birthYear: 1962, names: ['ベツノウマ'] }, KNOWN),
    ).toEqual({ kind: 'conflict', horseId: 'mare-a', reason: 'nameMismatch' });
    expect(
      matchHorseIdentity(
        { abilityNo: 0x0100, birthYear: 1962, names: ['テストヒンバ'], damName: 'ベツノハハ' },
        KNOWN,
      ),
    ).toEqual({ kind: 'conflict', horseId: 'mare-a', reason: 'parentMismatch' });
  });

  it('既有紀錄沒有能力番号時，唯一馬名相符且出生年相同或未填才補入能力番号', () => {
    expect(
      matchHorseIdentity({ abilityNo: 0x0300, birthYear: 1965, names: ['テストシュドウ'] }, KNOWN),
    ).toEqual({ kind: 'fillAbilityNo', horseId: 'manual-c' });
    expect(
      matchHorseIdentity({ abilityNo: 0x0500, birthYear: 1970, names: ['テストシュドウ'] }, KNOWN),
    ).toEqual({ kind: 'new' });
    expect(
      matchHorseIdentity({ abilityNo: 0x0400, birthYear: 1970, names: ['ドウメイ'] }, KNOWN),
    ).toEqual({ kind: 'ambiguous', horseIds: ['manual-d', 'manual-e'] });
  });

  it('唯一馬名相符但既有紀錄已有不同能力番号時為衝突，不得覆寫', () => {
    expect(
      matchHorseIdentity({ abilityNo: 0x0999, birthYear: 1960, names: ['バンゴウアリ'] }, KNOWN),
    ).toEqual({ kind: 'conflict', horseId: 'mare-f', reason: 'abilityNoMismatch' });
  });

  it('找出同一檔案內重複的能力番号，未填的列不計入', () => {
    expect(
      findDuplicateAbilityNos([
        { abilityNo: 0 },
        { abilityNo: 1 },
        { abilityNo: 0 },
        {},
        { abilityNo: 1 },
        { abilityNo: 0 },
      ]),
    ).toEqual([0, 1]);
    expect(findDuplicateAbilityNos([{ abilityNo: 5 }, {}])).toEqual([]);
  });
});

describe('出生年推算（需求規格 6.3）', () => {
  it('一月二歲馬為匯出年減 2，四月誕生幼駒為匯出年，其他總表為匯出年減馬齡', () => {
    expect(inferBirthYear('jan2yo', 1968, undefined)).toBe(1966);
    expect(inferBirthYear('aprFoals', 1968, undefined)).toBe(1968);
    expect(inferBirthYear('mayMares', 1968, 6)).toBe(1962);
    expect(inferBirthYear('mayStallions', 1968, 24)).toBe(1944);
    expect(inferBirthYear('candidateFile', 1968, 0)).toBe(1968);
    expect(inferBirthYear('julMares', 1968, undefined)).toBeUndefined();
  });
});
