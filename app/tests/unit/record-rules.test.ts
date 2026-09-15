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
});
