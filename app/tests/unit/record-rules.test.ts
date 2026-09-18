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
const STALLION_YEARLY = { id: 's1', horseId: 'h1', gameYear: 1968 };
const BREEDING = { id: 'b1', mareId: 'h1', gameYear: 1968, breedingType: 'designated' };
const FOAL = {
  id: 'f1',
  damId: 'h1',
  birthYear: 1969,
  lineage: { position: 1, generation: 1 },
  freeBred: false,
  disposition: 'keep',
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

  it('stallionDuties：現任離開在崗時有卸任年、更換原因與後任；在崗時不可有', () => {
    const replaced = {
      ...DUTY,
      dutyStatus: 'replaced',
      endYear: 1970,
      replaceReason: 'betterBrother',
      successorId: 'h2',
    };
    expectProblems('stallionDuties', replaced, [
      [omit(replaced, 'endYear'), 'endYear'],
      [{ ...replaced, endYear: 1967 }, '不可早於'],
      [{ ...replaced, replaceReason: 'older' }, 'replaceReason'],
      [{ ...replaced, successorId: 'h1' }, '後任不可是自己'],
      [{ ...DUTY, endYear: 1970 }, '在崗的現任不可有'],
      [{ ...DUTY, readiness: 'racing' }, '現任不可有 readiness'],
      [omit(DUTY, 'horseId'), 'horseId'],
    ]);
    expect(check('stallionDuties', { ...replaced, dutyStatus: 'retired' })).toBeUndefined();
    expect(check('stallionDuties', omit(replaced, 'successorId'))).toBeUndefined();
  });

  it('stallionDuties：預定後繼尚未誕生時只指向配種，其他就緒狀態只指向馬匹', () => {
    const unborn = {
      id: 'd2',
      position: 1,
      generation: 2,
      breedingId: 'b1',
      role: 'planned',
      readiness: 'unborn',
      startYear: 1970,
    };
    const racing = { ...omit(unborn, 'breedingId'), horseId: 'h2', readiness: 'racing' };
    expectProblems('stallionDuties', unborn, [
      [{ ...unborn, readiness: 'waiting' }, 'readiness'],
      [{ ...unborn, horseId: 'h2' }, '只有 breedingId'],
      [omit(unborn, 'breedingId'), '只有 breedingId'],
      [{ ...unborn, dutyStatus: 'onDuty' }, '預定後繼不可有'],
      [{ ...racing, breedingId: 'b1' }, '只有 horseId'],
      [omit(racing, 'horseId'), '只有 horseId'],
    ]);
    expect(check('stallionDuties', racing)).toBeUndefined();
    expect(
      check('stallionDuties', { ...racing, readiness: 'inService', endYear: 1971 }),
    ).toBeUndefined();
  });

  it('horses：去向只接受成為種牡馬與遊戲年', () => {
    const stallion = { ...HORSE, sex: 'male', fate: { kind: 'becameStallion', gameYear: 1972 } };
    expectProblems('horses', stallion, [
      [{ ...stallion, fate: { kind: 'broodmare', gameYear: 1972 } }, 'fate'],
      [{ ...stallion, fate: { kind: 'becameStallion' } }, 'fate'],
    ]);
  });

  it('[BRD-18] matingRatings：總合評價只有 S、A、B、C、D，爆發力為整數，兩者至少一項', () => {
    const rating = {
      id: 'r1',
      stallionId: 'h2',
      mareId: 'h1',
      gameYear: 1970,
      overallGrade: 'S',
      explosivePower: 16,
    };
    for (const grade of ['S', 'A', 'B', 'C', 'D']) {
      expect(check('matingRatings', { ...rating, overallGrade: grade })).toBeUndefined();
    }
    expect(check('matingRatings', omit(rating, 'overallGrade'))).toBeUndefined();
    expect(check('matingRatings', { ...rating, explosivePower: 0 })).toBeUndefined();
    expectProblems('matingRatings', omit(rating, 'explosivePower'), [
      [{ ...rating, overallGrade: 'E' }, 'overallGrade'],
      [{ ...rating, overallGrade: 's' }, 'overallGrade'],
      [{ ...rating, explosivePower: 1.5 }, 'explosivePower'],
      [{ ...rating, explosivePower: 100 }, 'explosivePower'],
      [omit(omit(rating, 'overallGrade'), 'explosivePower'), '至少要有一項'],
      [omit(rating, 'stallionId'), 'stallionId'],
      [omit(rating, 'mareId'), 'mareId'],
      [{ ...rating, gameYear: 999 }, 'gameYear'],
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

  it('[STL-11] stallionYearly：能力、仔出、種付料與戦績都是選填；超出範圍或多餘欄位時指出問題', () => {
    expect(
      check('stallionYearly', {
        ...STALLION_YEARLY,
        sp: 0,
        st: 999,
        subParams: { power: 'S+', health: 'G' },
        subParamTotal: 45,
        kodashi: 15,
        studFee: 0,
        record: { starts: 18, wins: 9, earnings: 312500, gradedWins: 4, g1Wins: 2 },
      }),
    ).toBeUndefined();
    expectProblems('stallionYearly', STALLION_YEARLY, [
      [omit(STALLION_YEARLY, 'horseId'), 'horseId'],
      [{ ...STALLION_YEARLY, gameYear: 68 }, 'gameYear'],
      [{ ...STALLION_YEARLY, sp: 1000 }, 'sp'],
      [{ ...STALLION_YEARLY, st: -1 }, 'st'],
      [{ ...STALLION_YEARLY, subParams: { power: 'Z' } }, 'subParams'],
      [{ ...STALLION_YEARLY, kodashi: 16 }, 'kodashi'],
      [{ ...STALLION_YEARLY, studFee: -1 }, 'studFee'],
      [{ ...STALLION_YEARLY, record: { starts: -1 } }, 'record'],
      [{ ...STALLION_YEARLY, record: { places: 3 } }, 'record'],
    ]);
  });

  it('[STL-10] horses：在表紀錄的缺席年份不可早於最後在表的年份', () => {
    expect(check('horses', { ...HORSE, stallionListing: { lastSeenYear: 1968 } })).toBeUndefined();
    expect(
      check('horses', { ...HORSE, stallionListing: { lastSeenYear: 1968, inactiveSince: 1969 } }),
    ).toBeUndefined();
    // 同年的更正匯入拿掉一匹時，最後在表與缺席是同一年。
    expect(
      check('horses', { ...HORSE, stallionListing: { lastSeenYear: 1969, inactiveSince: 1969 } }),
    ).toBeUndefined();
    expectProblems('horses', HORSE, [
      [{ ...HORSE, stallionListing: { inactiveSince: 1969 } }, 'stallionListing'],
      [
        { ...HORSE, stallionListing: { lastSeenYear: 1970, inactiveSince: 1969 } },
        'stallionListing',
      ],
    ]);
  });

  it('breedings：偏離規則只能是 true 或不存在（需求規格 11.6、JUL-04）', () => {
    expect(check('breedings', { ...BREEDING, deviated: true })).toBeUndefined();
    expectProblems('breedings', BREEDING, [
      [{ ...BREEDING, deviated: false }, 'deviated'],
      [{ ...BREEDING, deviated: '是' }, 'deviated'],
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

  it('[BRD-02][BRD-05] breedings：四種受胎狀態分別保存，受胎時預定隔年出生；沒有流產或其他狀態', () => {
    for (const conception of ['空胎', '不受胎', '未確認']) {
      expect(check('breedings', { ...BREEDING, conception })).toBeUndefined();
    }
    expect(
      check('breedings', {
        ...BREEDING,
        stallionId: 's1',
        conception: '受胎',
        expectedBirthYear: 1969,
        foalId: 'f1',
      }),
    ).toBeUndefined();
    expect(
      check('breedings', { ...BREEDING, breedingType: 'free', stallionName: 'ソトノタネウマ' }),
    ).toBeUndefined();
    expectProblems('breedings', BREEDING, [
      [omit(BREEDING, 'mareId'), 'mareId'],
      [{ ...BREEDING, gameYear: 999 }, 'gameYear'],
      [{ ...BREEDING, breedingType: 'rotation' }, 'breedingType'],
      [{ ...BREEDING, stallionName: '' }, 'stallionName'],
      [{ ...BREEDING, conception: '流産' }, 'conception'],
      [{ ...BREEDING, conception: '' }, 'conception'],
      [{ ...BREEDING, conception: '受胎' }, 'expectedBirthYear'],
      [{ ...BREEDING, conception: '受胎', expectedBirthYear: 1968 }, 'expectedBirthYear'],
      [{ ...BREEDING, conception: '不受胎', expectedBirthYear: 1969 }, 'expectedBirthYear'],
      [{ ...BREEDING, conception: '空胎', foalId: 'f1' }, '連結產駒'],
    ]);
  });

  it('[BRD-13][BRD-15] foals：芝與ダート分開保存；自由配種產駒沒有系與代數且不可保留', () => {
    expect(
      check('foals', {
        ...FOAL,
        sp: 0,
        st: 999,
        subParams: { power: 'S+', health: 'G' },
        turf: '◎',
        dirt: '×',
        distanceText: '1700～3100m',
        kodashi: 0,
        note: '備註',
      }),
    ).toBeUndefined();
    expect(
      check('foals', { ...omit(FOAL, 'lineage'), freeBred: true, disposition: 'sold' }),
    ).toBeUndefined();
    expectProblems('foals', FOAL, [
      [omit(FOAL, 'damId'), 'damId'],
      [{ ...FOAL, birthYear: '1969' }, 'birthYear'],
      [omit(FOAL, 'lineage'), 'lineage'],
      [{ ...FOAL, lineage: { position: 1, generation: 0 } }, 'lineage'],
      [{ ...FOAL, freeBred: true }, 'lineage'],
      [{ ...omit(FOAL, 'lineage'), freeBred: true }, '不可保留'],
      [{ ...FOAL, disposition: 'retired' }, 'disposition'],
      [{ ...FOAL, sp: 1000 }, 'sp'],
      [{ ...FOAL, subParams: {} }, 'subParams'],
      [{ ...FOAL, subParams: { speed: 'A' } }, 'subParams'],
      [{ ...FOAL, subParams: { power: 'SS' } }, 'subParams'],
      [{ ...FOAL, turf: 'o' }, 'turf'],
      [{ ...FOAL, dirt: '◯' }, 'dirt'],
      [{ ...FOAL, distanceText: '' }, 'distanceText'],
      [{ ...FOAL, kodashi: 16 }, 'kodashi'],
    ]);
  });
});
