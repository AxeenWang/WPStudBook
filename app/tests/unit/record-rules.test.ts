import { describe, expect, it } from 'vitest';
import { RECORD_RULES } from '../../src/storage/backup/record-rules.ts';
import type { RecordCollection } from '../../src/storage/schema.ts';

type RecordInput = Record<string, unknown>;

function check(collection: RecordCollection, record: RecordInput): string | undefined {
  const rule = RECORD_RULES[collection];
  if (rule === undefined) {
    throw new Error(`沒有 ${collection} 的欄位規則`);
  }
  return rule(record);
}

function omit(record: RecordInput, field: string): RecordInput {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== field));
}

function expectProblems(
  collection: RecordCollection,
  valid: RecordInput,
  cases: readonly (readonly [RecordInput, string])[],
): void {
  expect(check(collection, valid)).toBeUndefined();
  for (const [record, expected] of cases) {
    expect(check(collection, record), JSON.stringify(record)).toContain(expected);
  }
}

const HORSE = { id: 'h1', sex: 'female', stageNumbers: [], aliases: [] };
const LINE = {
  id: 'l1',
  position: 1,
  subsystem: 'ネアルコ',
  parentSystem: 'ネアルコ',
  color: '#c62828',
  branch: { targetGeneration: 1, openedYear: 1968 },
  establishedGenerations: [],
};
const MAP_ENTRY = { id: 'm1', subsystem: 'マンノウォー', parentSystem: 'マッチェム' };
const DUTY = {
  id: 'd1',
  position: 1,
  generation: 0,
  horseId: 'h1',
  role: 'current',
  dutyStatus: 'onDuty',
  startYear: 1968,
};
const EVENT = {
  id: 'e1',
  subjectId: 'h1',
  type: 'horseCreated',
  gameYear: 1968,
  source: 'user',
  occurredAt: '2026-09-15T00:00:00.000Z',
};
const MARE = {
  id: 'h1',
  group: { kind: 'substitute', position: 2, generation: 1 },
  origin: 'marketFound',
  status: 'producing',
  site: 32,
};
const MARE_YEARLY = { id: 'y1', horseId: 'h1', gameYear: 1968 };

describe('資料表欄位規則', () => {
  it('horses：能力番号 0、空字串牝系、階段馬番号與別名都是有效值', () => {
    expect(
      check('horses', {
        ...HORSE,
        abilityNo: 0,
        birthYear: 1962,
        fullName: '(外)テストウマ',
        baseName: 'テストウマ',
        sireId: 's1',
        sireName: 'ソトノチチ',
        femaleLine: '',
        stageNumbers: [{ stage: 'foal', number: 0, gameYear: 1968, source: 'aprFoals' }],
        aliases: [{ kind: 'manual', name: 'キュウメイ', gameYear: 1969 }],
      }),
    ).toBeUndefined();
  });

  it('horses：欄位錯誤時指出問題', () => {
    expectProblems('horses', HORSE, [
      [omit(HORSE, 'sex'), 'sex'],
      [{ ...HORSE, sex: '牝' }, 'sex'],
      [{ ...HORSE, abilityNo: 65536 }, 'abilityNo'],
      [{ ...HORSE, birthYear: 999 }, 'birthYear'],
      [{ ...HORSE, fullName: '' }, 'fullName'],
      [{ ...HORSE, femaleLine: 0 }, 'femaleLine'],
      [{ ...HORSE, sireId: 'h1' }, '父母不可是自己'],
      [omit(HORSE, 'stageNumbers'), 'stageNumbers'],
      [
        { ...HORSE, stageNumbers: [{ stage: 'x', number: 1, gameYear: 1968, source: 'manual' }] },
        'stageNumbers',
      ],
      [{ ...HORSE, aliases: [{ kind: 'manual', name: '', gameYear: 1968 }] }, 'aliases'],
    ]);
  });

  it('lines：系位置、名稱、代表色、分支與成立世代', () => {
    expectProblems('lines', LINE, [
      [{ ...LINE, position: 9 }, 'position'],
      [{ ...LINE, subsystem: '' }, 'subsystem'],
      [{ ...LINE, color: 'red' }, 'color'],
      [{ ...LINE, branch: { targetGeneration: 0, openedYear: 1968 } }, 'branch'],
      [
        {
          ...LINE,
          establishedGenerations: [
            { generation: 1, gameYear: 1969 },
            { generation: 1, gameYear: 1970 },
          ],
        },
        'establishedGenerations',
      ],
    ]);
  });

  it('systemMap：子系統與親系統必須是非空字串', () => {
    expectProblems('systemMap', MAP_ENTRY, [
      [{ ...MAP_ENTRY, parentSystem: '' }, 'parentSystem'],
      [omit(MAP_ENTRY, 'subsystem'), 'subsystem'],
    ]);
  });

  it('stallionDuties：系位置、代數、馬匹、角色、任期狀態與起始年', () => {
    expectProblems('stallionDuties', DUTY, [
      [{ ...DUTY, generation: -1 }, 'generation'],
      [{ ...DUTY, horseId: '' }, 'horseId'],
      [{ ...DUTY, role: 'founder' }, 'role'],
      [{ ...DUTY, dutyStatus: 'active' }, 'dutyStatus'],
      [{ ...DUTY, startYear: '1968' }, 'startYear'],
    ]);
  });

  it('events：對象、型別、遊戲年、時點、來源與現實時間', () => {
    expect(
      check('events', {
        ...EVENT,
        timing: { month: 5, week: 1 },
        before: { site: 32 },
        after: { site: 33 },
      }),
    ).toBeUndefined();
    expectProblems('events', EVENT, [
      [{ ...EVENT, subjectId: '' }, 'subjectId'],
      [{ ...EVENT, type: 'siteChanged' }, 'type'],
      [{ ...EVENT, timing: { month: 13, week: 1 } }, 'timing'],
      [{ ...EVENT, source: 'import' }, 'source'],
      [{ ...EVENT, occurredAt: 'yesterday' }, 'occurredAt'],
    ]);
  });
  it('mares：母馬群、來源、狀態、離圈原因、據點、接替狀態與今年計畫', () => {
    expect(
      check('mares', {
        ...MARE,
        group: { kind: 'starter', position: 1, generation: 0 },
        originNote: 'セール購入',
        status: 'left',
        leftReason: 'sold',
        site: 33,
        succession: 'sold',
        yearPlan: { plan: 'rest', gameYear: 1968 },
      }),
    ).toBeUndefined();
    expect(check('mares', { ...MARE, group: { kind: 'unassigned' } })).toBeUndefined();
    expectProblems('mares', MARE, [
      [omit(MARE, 'group'), 'group.kind'],
      [{ ...MARE, group: { kind: 'market', position: 2, generation: 1 } }, 'group.kind'],
      [{ ...MARE, group: { kind: 'own', position: 9, generation: 1 } }, 'group.position'],
      [{ ...MARE, group: { kind: 'substitute', position: 2, generation: 0 } }, 'group.generation'],
      [{ ...MARE, group: { kind: 'starter', position: 2, generation: 0 } }, '起點母馬群'],
      [{ ...MARE, origin: 'market' }, 'origin'],
      [{ ...MARE, originNote: '' }, 'originNote'],
      [{ ...MARE, status: 'retired' }, 'status'],
      [{ ...MARE, status: 'left' }, 'leftReason'],
      [{ ...MARE, leftReason: 'sold' }, 'leftReason'],
      [{ ...MARE, site: 36 }, 'site'],
      [{ ...MARE, site: '32' }, 'site'],
      [{ ...MARE, succession: 'candidate' }, 'succession'],
      [{ ...MARE, yearPlan: 'rest' }, 'yearPlan'],
      [{ ...MARE, yearPlan: { plan: 'sleep', gameYear: 1968 } }, 'yearPlan'],
    ]);
  });

  it('[MARE-13][MARE-17] mareYearly：活力 0 與 100、仔出 0 與 15 都是有效值；超出範圍或狀態不明時指出問題', () => {
    expect(
      check('mareYearly', {
        ...MARE_YEARLY,
        vitalityMay: { state: 'confirmed', value: 0, boosted: false },
        vitalityJuly: { state: 'confirmed', value: 100, boosted: true },
        kodashi: 15,
        breedingYears: 0,
        breedingCount: 99,
      }),
    ).toBeUndefined();
    expect(
      check('mareYearly', {
        ...MARE_YEARLY,
        vitalityMay: { state: 'pending' },
        vitalityJuly: { state: 'notApplicable' },
        kodashi: 0,
      }),
    ).toBeUndefined();
    expectProblems('mareYearly', MARE_YEARLY, [
      [omit(MARE_YEARLY, 'horseId'), 'horseId'],
      [{ ...MARE_YEARLY, gameYear: 68 }, 'gameYear'],
      [{ ...MARE_YEARLY, vitalityMay: 73 }, 'vitalityMay'],
      [
        { ...MARE_YEARLY, vitalityMay: { state: 'confirmed', value: 101, boosted: false } },
        'vitalityMay',
      ],
      [{ ...MARE_YEARLY, vitalityJuly: { state: 'confirmed', value: 73 } }, 'vitalityJuly'],
      [{ ...MARE_YEARLY, vitalityJuly: { state: 'unknown' } }, 'vitalityJuly'],
      [{ ...MARE_YEARLY, kodashi: 16 }, 'kodashi'],
      [{ ...MARE_YEARLY, breedingYears: -1 }, 'breedingYears'],
      [{ ...MARE_YEARLY, breedingCount: 1.5 }, 'breedingCount'],
    ]);
  });

  it('events：繁殖牝馬與設定的事件型別', () => {
    for (const type of [
      'mareAdded',
      'mareSold',
      'mareTransferred',
      'mareYearlyChanged',
      'settingsChanged',
    ]) {
      expect(check('events', { ...EVENT, type }), type).toBeUndefined();
    }
  });
});
