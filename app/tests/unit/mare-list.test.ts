import { describe, expect, it } from 'vitest';
import type { Horse } from '../../src/domain/horse.ts';
import type { Mare } from '../../src/domain/mare.ts';
import type { VitalityReading } from '../../src/domain/mare-yearly.ts';
import {
  DEFAULT_MARE_FILTER,
  buildMareCard,
  defaultGeneration,
  generationTabs,
  handoverGenerations,
  matchesMareFilter,
  paginate,
  sortMareCards,
  type MareCard,
  type MareFilterOptions,
  type MareGroupView,
} from '../../src/services/mare-list.ts';

function card(id: string, overrides: Partial<MareCard> = {}): MareCard {
  return {
    id,
    name: id,
    searchNames: [id],
    group: { kind: 'substitute', position: 3, generation: 3 },
    generation: 0,
    sireSubsystem: undefined,
    site: 32,
    age: undefined,
    highAge: false,
    vitality: { vitality: { state: 'pending' }, month: undefined },
    belowThreshold: false,
    conception: undefined,
    yearPlan: 'undecided',
    status: 'producing',
    leftReason: undefined,
    origin: 'marketFound',
    femaleLine: undefined,
    kodashi: undefined,
    succession: undefined,
    hasUnnamedFoal: false,
    suggestSellMother: false,
    ...overrides,
  };
}

function confirmed(value: number, boosted = false): VitalityReading {
  return { vitality: { state: 'confirmed', value, boosted }, month: 5 };
}

const NOT_APPLICABLE: VitalityReading = { vitality: { state: 'notApplicable' }, month: undefined };

function filterIds(
  cards: readonly MareCard[],
  view: MareGroupView,
  options: Partial<MareFilterOptions> = {},
): string[] {
  return cards
    .filter((item) => matchesMareFilter(item, view, { ...DEFAULT_MARE_FILTER, ...options }))
    .map((item) => item.id);
}

const HORSE: Horse = {
  id: 'mare-1',
  sex: 'female',
  birthYear: 1950,
  fullName: '(外)テストヒンバ',
  baseName: 'テストヒンバ',
  sireSubsystem: 'マンノウォー',
  femaleLine: 'テストケイ',
  stageNumbers: [],
  aliases: [{ kind: 'manual', name: 'テストベツメイ', gameYear: 1967 }],
};

/** 出生年未知（手動新增時可留空）。 */
const HORSE_WITHOUT_BIRTH_YEAR: Horse = {
  id: 'mare-1',
  sex: 'female',
  fullName: '(外)テストヒンバ',
  stageNumbers: [],
  aliases: [],
};

const MARE: Mare = {
  id: 'mare-1',
  group: { kind: 'starter', position: 1, generation: 0 },
  origin: 'ownRetired',
  status: 'producing',
  site: 34,
  yearPlan: { plan: 'rest', gameYear: 1968 },
};

const SETTINGS = { highAgeReminderAge: 18, vitalityThreshold: 50 };

describe('卡片資料', () => {
  it('[UI-01] 卡片含馬名、代數、自身父系與用途、據點、年齡、今年活力、本年度受胎、今年計畫、狀態與來源', () => {
    const result = buildMareCard({
      mare: MARE,
      horse: HORSE,
      yearly: [
        {
          id: 'y1',
          horseId: 'mare-1',
          gameYear: 1968,
          vitalityMay: { state: 'confirmed', value: 40, boosted: false },
          kodashi: 12,
        },
      ],
      conception: '受胎',
      currentYear: 1968,
      settings: SETTINGS,
    });

    expect(result).toEqual({
      id: 'mare-1',
      name: '(外)テストヒンバ',
      searchNames: ['(外)テストヒンバ', 'テストヒンバ', 'テストベツメイ'],
      group: { kind: 'starter', position: 1, generation: 0 },
      generation: 0,
      sireSubsystem: 'マンノウォー',
      site: 34,
      age: 18,
      highAge: true,
      vitality: confirmed(40),
      belowThreshold: true,
      conception: '受胎',
      yearPlan: 'rest',
      status: 'producing',
      leftReason: undefined,
      origin: 'ownRetired',
      femaleLine: 'テストケイ',
      kodashi: { value: 12, gameYear: 1968 },
      succession: undefined,
      hasUnnamedFoal: false,
      suggestSellMother: false,
    });
  });

  it('[MARE-25] 生產中的母馬達到高齡提醒年齡時提示；修改提醒年齡後依新年齡判斷；已離圈不提示', () => {
    const source = {
      mare: MARE,
      horse: HORSE,
      yearly: [],
      conception: undefined,
      currentYear: 1968,
      settings: SETTINGS,
    };
    expect(buildMareCard(source).highAge).toBe(true);
    expect(buildMareCard({ ...source, settings: { highAgeReminderAge: 19 } }).highAge).toBe(false);
    expect(
      buildMareCard({ ...source, mare: { ...MARE, status: 'left', leftReason: 'sold' } }).highAge,
    ).toBe(false);
    expect(buildMareCard({ ...source, horse: HORSE_WITHOUT_BIRTH_YEAR }).age).toBeUndefined();
    expect(buildMareCard({ ...source, horse: HORSE_WITHOUT_BIRTH_YEAR }).highAge).toBe(false);
  });

  it('[MARE-17][MARE-22] 仔出取最近一個有值的年度，0 是有效值；今年計畫的年份不是目前遊戲年時為待定', () => {
    const result = buildMareCard({
      mare: { ...MARE, yearPlan: { plan: 'rest', gameYear: 1967 } },
      horse: HORSE,
      yearly: [
        { id: 'y1966', horseId: 'mare-1', gameYear: 1966, kodashi: 12 },
        { id: 'y1967', horseId: 'mare-1', gameYear: 1967, kodashi: 0 },
        { id: 'y1968', horseId: 'mare-1', gameYear: 1968 },
      ],
      conception: undefined,
      currentYear: 1968,
      settings: SETTINGS,
    });
    expect(result.kodashi).toEqual({ value: 0, gameYear: 1967 });
    expect(result.yearPlan).toBe('undecided');
    expect(result.vitality).toEqual({ vitality: { state: 'pending' }, month: undefined });
  });
});
describe('篩選', () => {
  it('[MARE-02] 選擇第 3 系 3 代只顯示該系該代的自家母馬與替代母馬；全部代數只看同一系', () => {
    const cards = [
      card('own-3-3', { group: { kind: 'own', position: 3, generation: 3 }, generation: 3 }),
      card('sub-3-3'),
      card('own-3-2', { group: { kind: 'own', position: 3, generation: 2 }, generation: 2 }),
      card('sub-4-3', { group: { kind: 'substitute', position: 4, generation: 3 } }),
      card('unassigned', { group: { kind: 'unassigned' }, generation: undefined }),
    ];
    expect(filterIds(cards, { position: 3, generation: 3 })).toEqual(['own-3-3', 'sub-3-3']);
    expect(filterIds(cards, { position: 3, generation: 'all' })).toEqual([
      'own-3-3',
      'sub-3-3',
      'own-3-2',
    ]);
  });

  it('[UI-07] 多個篩選以交集套用，不混入其他系或代數', () => {
    const cards = [
      card('a', {
        site: 34,
        yearPlan: 'rest',
        femaleLine: 'テストケイ',
        kodashi: { value: 12, gameYear: 1968 },
        vitality: confirmed(73, true),
        searchNames: ['テストアルファ'],
      }),
      card('b', { site: 34, yearPlan: 'rest', femaleLine: '', vitality: confirmed(40) }),
      card('c', { site: 32, yearPlan: 'rest', femaleLine: 'テストケイ', vitality: confirmed(80) }),
      card('d', {
        group: { kind: 'substitute', position: 4, generation: 3 },
        site: 34,
        femaleLine: 'テストケイ',
        vitality: confirmed(90, true),
      }),
      card('e', {
        site: 34,
        status: 'left',
        leftReason: 'sold',
        femaleLine: 'テストケイ',
        vitality: NOT_APPLICABLE,
      }),
    ];
    const view = { position: 3, generation: 3 } as const;
    expect(filterIds(cards, view, { site: 34 })).toEqual(['a', 'b']);
    expect(filterIds(cards, view, { site: 34, femaleLine: 'named' })).toEqual(['a']);
    expect(filterIds(cards, view, { site: 34, femaleLine: 'none' })).toEqual(['b']);
    expect(filterIds(cards, view, { femaleLineName: 'ケイ' })).toEqual(['a', 'c']);
    expect(filterIds(cards, view, { vitalityMin: 50, boostedOnly: true })).toEqual(['a']);
    expect(filterIds(cards, view, { vitalityMin: 50, vitalityMax: 75 })).toEqual(['a']);
    expect(filterIds(cards, view, { kodashiMin: 11, kodashiMax: 15 })).toEqual(['a']);
    expect(filterIds(cards, view, { keyword: 'アルファ', site: 32 })).toEqual([]);
    expect(filterIds(cards, view, { keyword: 'アルファ' })).toEqual(['a']);
    expect(filterIds(cards, view, { status: 'all', site: 34 })).toEqual(['a', 'b', 'e']);
    expect(filterIds(cards, view, { status: 'left' })).toEqual(['e']);
    expect(filterIds(cards, view, { origin: 'marketReplenish' })).toEqual([]);
  });

  it('[MARE-22][MARE-13] 依今年計畫篩選；待更新只含今年沒有活力確認值者；活力範圍不含待更新，0 算在範圍內', () => {
    const cards = [
      card('rest', { yearPlan: 'rest', vitality: confirmed(0) }),
      card('designated', { yearPlan: 'designated' }),
      card('undecided'),
    ];
    const view = { position: 3, generation: 3 } as const;
    expect(filterIds(cards, view, { yearPlan: 'rest' })).toEqual(['rest']);
    expect(filterIds(cards, view, { yearPlan: 'undecided' })).toEqual(['undecided']);
    expect(filterIds(cards, view, { pendingOnly: true })).toEqual(['designated', 'undecided']);
    expect(filterIds(cards, view, { vitalityMin: 0 })).toEqual(['rest']);
  });
});

describe('排序、分頁與代數按鈕', () => {
  it('[MARE-16] 活力建議門檻只改變排序：生產中在前，達到門檻（含増強中）在前，同組依活力高到低，待更新在後', () => {
    const cards = [
      card('pending', { name: 'アア' }),
      card('v40', { vitality: confirmed(40) }),
      card('b13', { vitality: confirmed(13, true) }),
      card('v80', { vitality: confirmed(80) }),
      card('left', { status: 'left', leftReason: 'sold', vitality: NOT_APPLICABLE }),
    ];
    expect(sortMareCards(cards, undefined).map((item) => item.id)).toEqual([
      'v80',
      'v40',
      'b13',
      'pending',
      'left',
    ]);
    expect(sortMareCards(cards, 50).map((item) => item.id)).toEqual([
      'v80',
      'b13',
      'v40',
      'pending',
      'left',
    ]);
    expect(cards.map((item) => item.id)).toEqual(['pending', 'v40', 'b13', 'v80', 'left']);
  });

  it('同活力依馬名排序', () => {
    const cards = [
      card('b', { name: 'テストイ', vitality: confirmed(50) }),
      card('a', { name: 'テストア', vitality: confirmed(50) }),
    ];
    expect(sortMareCards(cards, undefined).map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('分頁每頁 24 筆，頁碼超出範圍時取最近的有效頁', () => {
    const many = Array.from({ length: 50 }, (_, index) =>
      card(`m${String(index).padStart(2, '0')}`),
    );
    const first = paginate(many, 1);
    expect([first.page, first.pageCount, first.total, first.items.length]).toEqual([1, 3, 50, 24]);
    expect(paginate(many, 3).items.map((item) => item.id)).toEqual(['m48', 'm49']);
    expect(paginate(many, 9).page).toBe(3);
    expect(paginate(many, 0).page).toBe(1);
    expect(paginate([], 1)).toEqual({ items: [], page: 1, pageCount: 1, total: 0 });
  });

  it('代數按鈕列出該系各代的生產中與已離圈數；預設代數為有生產中母馬的最高代數', () => {
    const starter = { kind: 'starter', position: 1, generation: 0 } as const;
    const cards = [
      card('s0', { group: starter }),
      card('s0-left', { group: starter, status: 'left', leftReason: 'sold' }),
      card('sub2', {
        group: { kind: 'substitute', position: 1, generation: 2 },
        status: 'left',
        leftReason: 'sold',
      }),
      card('other', { group: { kind: 'substitute', position: 2, generation: 1 } }),
    ];
    expect(generationTabs(cards, 1)).toEqual([
      { generation: 0, producing: 1, pendingSuccession: 0, left: 1 },
      { generation: 2, producing: 0, pendingSuccession: 0, left: 1 },
    ]);
    expect(defaultGeneration(cards, 1)).toBe(0);
    expect(defaultGeneration(cards, 3)).toBe('all');
    expect(defaultGeneration([cards[2] ?? card('x')], 1)).toBe(2);
  });

  it('[MARE-03] 交接中取該系都有生產中母馬的相鄰代數中最新的一組；待接替數只算生產中的暫定保留與候選', () => {
    const own = (generation: number) => ({ kind: 'own', position: 1, generation }) as const;
    const cards = [
      card('g1', { group: own(1) }),
      card('g2', { group: own(2), status: 'left', leftReason: 'sold' }),
      card('g3', { group: own(3), succession: 'provisional' }),
      card('g4a', { group: own(4), succession: 'sisterCandidate' }),
      card('g4b', { group: own(4), succession: 'replaced' }),
      card('g4c', { group: own(4), succession: 'sold', status: 'left', leftReason: 'sold' }),
    ];
    expect(handoverGenerations(cards, 1)).toEqual({ handover: [3, 4] });
    expect(handoverGenerations(cards.slice(0, 3), 1)).toBeUndefined();
    expect(generationTabs(cards, 1).find((tab) => tab.generation === 4)).toEqual({
      generation: 4,
      producing: 2,
      pendingSuccession: 1,
      left: 1,
    });
  });
});
