import { describe, expect, it } from 'vitest';
import {
  buildFoalTimeline,
  expectedBirthYearFor,
  type Breeding,
} from '../../src/domain/breeding.ts';
import {
  isDispositionAllowed,
  namingStatus,
  stallionLineage,
  subParamTotal,
  surfaceSummary,
  trackingName,
} from '../../src/domain/foal.ts';
import { horseDisplayName, nameForTracking, type Horse } from '../../src/domain/horse.ts';
import { sortFoalCards, type FoalCard } from '../../src/services/foals.ts';

function breeding(gameYear: number, overrides: Partial<Breeding> = {}): Breeding {
  return {
    id: `b-${String(gameYear)}`,
    mareId: 'm1',
    gameYear,
    breedingType: 'designated',
    ...overrides,
  };
}

const HORSE: Horse = { id: 'h1', sex: 'female', stageNumbers: [], aliases: [] };

describe('受胎狀態與預定出生（需求規格 9.1）', () => {
  it('[BRD-01] 遊戲年 Y 受胎時預定 Y+1 年出生，其他狀態不建立預定產駒', () => {
    expect(expectedBirthYearFor(1968, '受胎')).toBe(1969);
    expect(expectedBirthYearFor(1968, '空胎')).toBeUndefined();
    expect(expectedBirthYearFor(1968, '不受胎')).toBeUndefined();
    expect(expectedBirthYearFor(1968, '未確認')).toBeUndefined();
    expect(expectedBirthYearFor(1968, undefined)).toBeUndefined();
  });
});

describe('產駒時間軸（需求規格 13.4）', () => {
  it('[BRD-04] 空胎與不受胎顯示輪空，未確認與待登記受胎各自區分', () => {
    const entries = buildFoalTimeline({
      breedings: [
        breeding(1968, { conception: '空胎' }),
        breeding(1969, { conception: '不受胎' }),
        breeding(1971, { conception: '未確認' }),
        breeding(1972),
        breeding(1973, { conception: '受胎', expectedBirthYear: 1974 }),
      ],
      foals: [{ id: 'f1', birthYear: 1971 }],
      joinedYear: 1968,
      lastYear: 1973,
    });
    expect(entries.map((entry) => [entry.birthYear, entry.kind])).toEqual([
      [1974, 'expected'],
      [1973, 'conceptionPending'],
      [1972, 'unconfirmed'],
      [1971, 'foal'],
      [1970, 'idle'],
      [1969, 'idle'],
    ]);
    expect(entries[4]).toMatchObject({ conception: '不受胎' });
    expect(entries[5]).toMatchObject({ conception: '空胎' });
  });

  it('[BRD-04] 沒有繁殖紀錄的年度列為未登記，與輪空不同', () => {
    const entries = buildFoalTimeline({
      breedings: [breeding(1969, { conception: '空胎' })],
      foals: [],
      joinedYear: 1968,
      lastYear: 1971,
    });
    expect(entries.map((entry) => entry.kind)).toEqual(['unregistered', 'idle', 'unregistered']);
  });

  it('[BRD-19] 加入的第一年沒有自產幼駒時時間軸是零筆，不列未登記', () => {
    expect(
      buildFoalTimeline({ breedings: [], foals: [], joinedYear: 1968, lastYear: 1968 }),
    ).toEqual([]);
  });

  it('比加入更早的產駒會把範圍往前延伸', () => {
    const entries = buildFoalTimeline({
      breedings: [],
      foals: [{ id: 'f1', birthYear: 1968 }],
      joinedYear: 1968,
      lastYear: 1968,
    });
    expect(entries).toEqual([{ kind: 'foal', birthYear: 1968, foalId: 'f1' }]);
  });
});

describe('追蹤名與顯示名稱（需求規格 9.4）', () => {
  it('[BRD-07] 1990 年出生的未命名產駒顯示母馬名＋完整出生年', () => {
    expect(trackingName('オオトリモナーコス', 1990)).toBe('オオトリモナーコス1990');
    expect(trackingName(undefined, 1990)).toBeUndefined();
  });

  it('追蹤名使用去除前綴的母馬名；主要名稱優先完整馬名與正式馬名，都沒有時用追蹤名', () => {
    expect(nameForTracking({ ...HORSE, fullName: '(外)オオトリ', baseName: 'オオトリ' })).toBe(
      'オオトリ',
    );
    expect(nameForTracking({ ...HORSE, fullName: '[地]オオトリ' })).toBe('オオトリ');
    expect(nameForTracking(HORSE)).toBeUndefined();
    expect(horseDisplayName(HORSE, 'オオトリ1990')).toBe('オオトリ1990');
    expect(horseDisplayName({ ...HORSE, officialName: 'セイシキメイ' }, 'オオトリ1990')).toBe(
      'セイシキメイ',
    );
  });
});

describe('能力與適性（需求規格 4.7、9.3）', () => {
  it('七項副能力齊全時換算 サ（G=0～S+=15），缺任何一項時不計算', () => {
    expect(
      subParamTotal({
        power: 'S+',
        quickness: 'S+',
        guts: 'S+',
        flexibility: 'S+',
        spirit: 'S+',
        wisdom: 'S+',
        health: 'S+',
      }),
    ).toBe(105);
    expect(
      subParamTotal({
        power: 'G',
        quickness: 'G+',
        guts: 'F',
        flexibility: 'C',
        spirit: 'B+',
        wisdom: 'A',
        health: 'S',
      }),
    ).toBe(48);
    expect(subParamTotal({ power: 'A' })).toBeUndefined();
    expect(subParamTotal(undefined)).toBeUndefined();
  });

  it('[BRD-13] 場地型摘要：較高的一邊決定芝型或ダート型；相同時 ○ 以上兼用、△ 以下都不擅長', () => {
    expect(surfaceSummary('◎', '×')).toBe('turf');
    expect(surfaceSummary('△', '○')).toBe('dirt');
    expect(surfaceSummary('○', '○')).toBe('both');
    expect(surfaceSummary('◎', '◎')).toBe('both');
    expect(surfaceSummary('△', '△')).toBe('neither');
    expect(surfaceSummary('◎', undefined)).toBeUndefined();
  });

  it('[BRD-15] 自由配種產駒只能待售或已售出', () => {
    expect(isDispositionAllowed(true, 'keep')).toBe(false);
    expect(isDispositionAllowed(true, 'forSale')).toBe(true);
    expect(isDispositionAllowed(true, 'sold')).toBe(true);
    expect(isDispositionAllowed(false, 'keep')).toBe(true);
  });

  it('種牡馬的系與代數：有任期時取任期，否則取他本身的產駒紀錄', () => {
    expect(stallionLineage([{ position: 1, generation: 0, role: 'current' }], undefined)).toEqual({
      position: 1,
      generation: 0,
    });
    expect(stallionLineage([], { lineage: { position: 2, generation: 3 } })).toEqual({
      position: 2,
      generation: 3,
    });
    expect(stallionLineage([], undefined)).toBeUndefined();
  });
});

function foalCard(id: string, overrides: Partial<FoalCard> = {}): FoalCard {
  return {
    id,
    name: id,
    named: true,
    trackingName: undefined,
    searchNames: [id],
    sex: 'male',
    birthYear: 1970,
    age: 0,
    damId: 'm1',
    damName: undefined,
    sireName: undefined,
    lineage: undefined,
    freeBred: false,
    disposition: 'keep',
    sp: undefined,
    st: undefined,
    subParams: {},
    subParamTotal: undefined,
    turf: undefined,
    dirt: undefined,
    surface: undefined,
    distanceText: undefined,
    kodashi: undefined,
    note: undefined,
    isMare: false,
    isStallion: false,
    mareElsewhere: undefined,
    naming: 'done',
    ...overrides,
  };
}

describe('產駒排序（需求規格 9.3）', () => {
  const cards = [
    foalCard('a', { sp: 60, st: 40 }),
    foalCard('b', { sp: 75, st: 90 }),
    foalCard('c'),
    foalCard('d', { sp: 70, st: 10, birthYear: 1971 }),
  ];

  it('[BRD-12] SP 依高低排序；ST 只依數值大小排序，雙向都可選；沒有數值的排在最後', () => {
    expect(sortFoalCards(cards, 'spDesc').map((card) => card.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(sortFoalCards(cards, 'stAsc').map((card) => card.id)).toEqual(['d', 'a', 'b', 'c']);
    expect(sortFoalCards(cards, 'stDesc').map((card) => card.id)).toEqual(['b', 'a', 'd', 'c']);
    expect(sortFoalCards(cards, 'birthYearDesc').map((card) => card.id)).toEqual([
      'd',
      'a',
      'b',
      'c',
    ]);
  });
});

describe('補名管理（需求規格 9.4）', () => {
  const unnamed: Horse = { id: 'f1', sex: 'male', stageNumbers: [], aliases: [] };
  const foal = { birthYear: 1968, disposition: 'keep' } as const;
  const status = (
    horse: Horse,
    options: { currentYear?: number; listed?: boolean; sold?: boolean } = {},
  ) =>
    namingStatus(
      horse,
      { ...foal, ...(options.sold === true ? { disposition: 'sold' as const } : {}) },
      {
        currentYear: options.currentYear ?? 1970,
        janListYears: new Set(options.listed === true ? [1970] : []),
      },
    );

  it('[BRD-20] 區分等待總表、需人工補名、無法唯一配對、已由總表更新、已完成', () => {
    // 1970 年的一月總表還沒匯入，而且還沒過 1970 年。
    expect(status(unnamed, { currentYear: 1969 })).toBe('waiting');
    expect(status(unnamed, { currentYear: 1970 })).toBe('waiting');
    // 那一年沒有匯入一月總表就過去了。
    expect(status(unnamed, { currentYear: 1971 })).toBe('manual');
    // 總表匯入過，有能力番号卻沒補到名：沒出現在總表。
    expect(status({ ...unnamed, abilityNo: 0x3001 }, { listed: true })).toBe('manual');
    // 總表匯入過，仍沒有能力番号：父母配對零筆或多筆。
    expect(status(unnamed, { listed: true })).toBe('unmatched');
    expect(
      status({ ...unnamed, officialName: 'テストウマ010', officialNameSource: 'jan2yo' }),
    ).toBe('fromList');
    expect(status({ ...unnamed, officialName: 'テスト手動名' }, { listed: true })).toBe('done');
    expect(status({ ...unnamed, officialName: 'テスト手動名' }, { currentYear: 1969 })).toBe(
      'done',
    );
  });

  it('[BRD-20] 已售出未命名者不列人工待辦；總表匯入前仍是等待總表', () => {
    expect(status(unnamed, { listed: true, sold: true })).toBe('soldUnnamed');
    expect(status(unnamed, { currentYear: 1971, sold: true })).toBe('soldUnnamed');
    expect(status(unnamed, { currentYear: 1969, sold: true })).toBe('waiting');
  });
});
