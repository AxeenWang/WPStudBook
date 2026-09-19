import type { BackupCollection } from '../../src/storage/schema.ts';

/**
 * 效能量測用的合成遊戲局（開發計畫階段 5、設計決策 7.4）：內容全部虛構，依長期遊玩的比例
 * 逐年產生紀錄，直到總筆數達到目標。產物不提交，量測時才產生。
 *
 * 每年的組成以實際遊玩推估：全世界現役種牡馬約 450 匹，每年一份年度快照（五月種牡馬總表），
 * 每年約 40 匹新種牡馬、40 匹引退；八系各 5 匹自家母馬，每年年度資料、配種、3 筆配合評價、
 * 約八成產駒，並以牝駒接替引退母馬；每次變更寫一筆事件；每年 5 份年度總表的匯入紀錄。
 * 總筆數大部分是種牡馬年度快照、事件與馬匹，與實際遊玩的分布相同。
 */

type Row = Record<string, unknown>;

export type PerfCollections = Record<BackupCollection, Row[]>;

export interface PerfGame {
  readonly game: {
    readonly name: string;
    readonly startYear: number;
    readonly currentYear: number;
  };
  readonly collections: PerfCollections;
  /** 不含設定的紀錄總數（與狀態列的筆數相同）。 */
  readonly recordCount: number;
  /** 沒有轉入繁殖牝馬圈的自家牝駒（十月全世界繁殖牝馬總表的配對對象）。 */
  readonly ownFillies: readonly {
    readonly abilityNo: number;
    readonly birthYear: number;
    readonly name: string;
  }[];
  /** 最後一年的現役種牡馬（五月種牡馬總表的配對對象）。 */
  readonly activeStallions: readonly {
    readonly abilityNo: number;
    readonly birthYear: number;
    readonly name: string;
  }[];
  /** 量測搜尋用：第 1 系一匹生產中母馬的馬名。 */
  readonly searchKeyword: string;
}

const START_YEAR = 1968;
const STALLION_POOL = 450;
const STALLION_TURNOVER = 40;
const MARES_PER_LINE = 5;
const LINES = 8;
const RATINGS_PER_MARE = 3;
const SUBSYSTEMS = [
  'ネアルコ',
  'ナスルーラ',
  'ロイヤルチャージャー',
  'ハイペリオン',
  'テディ',
  'ハンプトン',
  'セントサイモン',
  'マンノウォー',
];

/** 可重現的亂數（線性同餘法）。 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

const KATAKANA =
  'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワ';

/** 由流水號產生唯一的片假名馬名。 */
function horseName(prefix: string, serial: number): string {
  let rest = serial;
  let text = '';
  do {
    text = (KATAKANA[rest % KATAKANA.length] ?? 'ア') + text;
    rest = Math.floor(rest / KATAKANA.length);
  } while (rest > 0);
  return `${prefix}${text}`;
}

interface Stallion {
  readonly id: string;
  readonly abilityNo: number;
  readonly name: string;
  readonly birthYear: number;
}

interface Mare {
  readonly id: string;
  readonly birthYear: number;
  readonly position: number;
  readonly generation: number;
}

export function buildPerfGame(targetRecords: number, seed = 20260919): PerfGame {
  const random = createRandom(seed);
  const pick = <T>(items: readonly T[]): T => {
    const item = items[Math.floor(random() * items.length)];
    if (item === undefined) {
      throw new Error('空的候選清單');
    }
    return item;
  };
  const collections: PerfCollections = {
    gameSettings: [
      {
        retirementAge: 25,
        highAgeReminderAge: 18,
        stallionAgeReminderAge: 26,
        checkpointRetention: 15,
        display: {},
      },
    ],
    lines: [],
    systemMap: [],
    horses: [],
    mares: [],
    stallionDuties: [],
    mareYearly: [],
    stallionYearly: [],
    breedings: [],
    matingRatings: [],
    foals: [],
    recoveries: [],
    imports: [],
    events: [],
  };
  let serial = 0;
  let abilityNo = 0;
  const nextId = (prefix: string): string => {
    serial += 1;
    return `${prefix}-${pad(serial, 7)}`;
  };
  const event = (subjectId: string, type: string, gameYear: number, after: Row): void => {
    collections.events.push({
      id: nextId('event'),
      subjectId,
      type,
      gameYear,
      before: {},
      after,
      source: 'user',
      occurredAt: '2026-09-19T00:00:00.000Z',
    });
  };
  const count = (): number =>
    Object.entries(collections).reduce(
      (total, [name, rows]) => total + (name === 'gameSettings' ? 0 : rows.length),
      0,
    );

  // 八系與系統對照表。
  SUBSYSTEMS.forEach((subsystem, index) => {
    collections.lines.push({
      id: `line-${String(index + 1)}`,
      position: index + 1,
      subsystem,
      parentSystem: subsystem,
      color: `#${pad((index + 1) * 111111, 6).slice(0, 6)}`,
      branch: { targetGeneration: 1, openedYear: START_YEAR },
      establishedGenerations: [{ generation: 1, gameYear: START_YEAR }],
    });
    collections.systemMap.push({
      id: `map-${String(index + 1)}`,
      subsystem,
      parentSystem: subsystem,
    });
  });

  const addStallion = (birthYear: number, gameYear: number): Stallion => {
    abilityNo += 1;
    const id = nextId('stallion');
    const name = horseName('テスト種', abilityNo);
    collections.horses.push({
      id,
      abilityNo,
      birthYear,
      sex: 'male',
      fullName: name,
      baseName: name,
      sireName: `(外)${horseName('ソトチチ', abilityNo)}`,
      damName: horseName('ソトハハ', abilityNo),
      sireSubsystem: pick(SUBSYSTEMS),
      stageNumbers: [{ stage: 'stallion', number: abilityNo, gameYear, source: 'mayStallions' }],
      aliases: [],
      stallionListing: { lastSeenYear: gameYear },
    });
    event(id, 'horseCreated', gameYear, { fullName: name });
    return { id, abilityNo, name, birthYear };
  };

  let stallions: Stallion[] = [];
  for (let index = 0; index < STALLION_POOL; index += 1) {
    stallions.push(addStallion(START_YEAR - 4 - (index % 12), START_YEAR));
  }

  let mares: Mare[] = [];
  const addMare = (position: number, generation: number, birthYear: number, gameYear: number) => {
    abilityNo += 1;
    const id = nextId('mare');
    const name = horseName('テスト牝', abilityNo);
    collections.horses.push({
      id,
      abilityNo,
      birthYear,
      sex: 'female',
      fullName: name,
      baseName: name,
      sireName: `(外)${horseName('ソトチチ', abilityNo)}`,
      damName: horseName('ソトハハ', abilityNo),
      sireSubsystem: SUBSYSTEMS[position - 1],
      femaleLine: '',
      stageNumbers: [],
      aliases: [],
    });
    collections.mares.push({
      id,
      group: { kind: 'own', position, generation },
      origin: 'marketFound',
      status: 'producing',
      site: 32,
      succession: 'confirmed',
    });
    event(id, 'mareAdded', gameYear, { position, generation });
    mares.push({ id, birthYear, position, generation });
  };
  for (let position = 1; position <= LINES; position += 1) {
    for (let index = 0; index < MARES_PER_LINE; index += 1) {
      addMare(position, 1, START_YEAR - 4 - index, START_YEAR);
    }
  }
  collections.stallionDuties.push({
    id: 'duty-1',
    position: 1,
    generation: 0,
    horseId: stallions[0]?.id,
    role: 'current',
    dutyStatus: 'onDuty',
    startYear: START_YEAR,
  });

  /** 牝駒候選（出生 3 年後可以接替引退母馬）。 */
  const fillies: {
    id: string;
    abilityNo: number;
    name: string;
    birthYear: number;
    position: number;
    generation: number;
  }[] = [];
  const importTypes = [
    ['jan2yo', 1],
    ['aprFoals', 4],
    ['mayMares', 5],
    ['mayStallions', 5],
    ['julMares', 7],
  ] as const;

  let year = START_YEAR;
  for (; count() < targetRecords; year += 1) {
    // 種牡馬：最年長的引退、補上新種牡馬，每匹寫年度快照。
    if (year > START_YEAR) {
      stallions = [...stallions].sort((a, b) => a.birthYear - b.birthYear).slice(STALLION_TURNOVER);
      for (let index = 0; index < STALLION_TURNOVER; index += 1) {
        stallions.push(addStallion(year - 4, year));
      }
    }
    for (const stallion of stallions) {
      collections.stallionYearly.push({
        id: nextId('stallion-yearly'),
        horseId: stallion.id,
        gameYear: year,
        sp: 50 + Math.floor(random() * 30),
        st: 50 + Math.floor(random() * 30),
        subParams: { power: pick(['S', 'A', 'B', 'C']), quickness: pick(['A', 'B', 'C']) },
        subParamTotal: 30 + Math.floor(random() * 30),
        kodashi: Math.floor(random() * 16),
        studFee: 100 + Math.floor(random() * 3000),
        record: {
          starts: 10 + Math.floor(random() * 20),
          wins: Math.floor(random() * 10),
          earnings: Math.floor(random() * 500_000),
        },
      });
    }

    // 母馬：最年長的 8 匹引退，由出生滿 3 年的牝駒接替。
    if (year > START_YEAR) {
      const retiring = [...mares].sort((a, b) => a.birthYear - b.birthYear).slice(0, LINES);
      for (const mare of retiring) {
        const stored = collections.mares.find((item) => item.id === mare.id);
        if (stored !== undefined) {
          stored.status = 'left';
          stored.leftReason = 'retired';
          stored.leftYear = year;
        }
        event(mare.id, 'mareRetired', year, { leftYear: year });
      }
      mares = mares.filter((mare) => !retiring.includes(mare));
      for (const retired of retiring) {
        const successor = fillies.findIndex(
          (filly) => filly.position === retired.position && filly.birthYear <= year - 3,
        );
        const filly = successor >= 0 ? fillies.splice(successor, 1)[0] : undefined;
        if (filly === undefined) {
          addMare(retired.position, retired.generation, year - 4, year);
          continue;
        }
        collections.mares.push({
          id: filly.id,
          group: { kind: 'own', position: filly.position, generation: filly.generation },
          origin: 'ownRetired',
          status: 'producing',
          site: 32,
          succession: 'confirmed',
        });
        event(filly.id, 'mareAdded', year, { position: filly.position });
        mares.push({
          id: filly.id,
          birthYear: filly.birthYear,
          position: filly.position,
          generation: filly.generation,
        });
      }
    }

    for (const mare of mares) {
      collections.mareYearly.push({
        id: nextId('mare-yearly'),
        horseId: mare.id,
        gameYear: year,
        vitalityMay: { state: 'confirmed', value: Math.floor(random() * 100), boosted: false },
        vitalityJuly: { state: 'confirmed', value: Math.floor(random() * 100), boosted: false },
        kodashi: Math.floor(random() * 10),
        breedingYears: year - mare.birthYear - 3,
        breedingCount: year - mare.birthYear - 3,
      });
      event(mare.id, 'mareYearlyChanged', year, { gameYear: year });

      const ratedStallions = new Set<Stallion>();
      while (ratedStallions.size < RATINGS_PER_MARE) {
        ratedStallions.add(pick(stallions));
      }
      for (const stallion of ratedStallions) {
        collections.matingRatings.push({
          id: nextId('rating'),
          stallionId: stallion.id,
          mareId: mare.id,
          gameYear: year,
          overallGrade: pick(['S', 'A', 'B', 'C', 'D']),
          explosivePower: Math.floor(random() * 10),
        });
      }

      const sire = [...ratedStallions][0] ?? pick(stallions);
      const breedingId = nextId('breeding');
      const conceived = random() < 0.8;
      let foalId: string | undefined;
      if (conceived) {
        abilityNo += 1;
        foalId = nextId('foal');
        const sex = random() < 0.5 ? 'female' : 'male';
        const name = horseName('テスト駒', abilityNo);
        collections.horses.push({
          id: foalId,
          abilityNo,
          birthYear: year + 1,
          sex,
          fullName: name,
          baseName: name,
          sireId: sire.id,
          damId: mare.id,
          sireSubsystem: SUBSYSTEMS[mare.position - 1],
          stageNumbers: [],
          aliases: [],
        });
        collections.foals.push({
          id: foalId,
          damId: mare.id,
          birthYear: year + 1,
          lineage: { position: mare.position, generation: mare.generation + 1 },
          disposition: 'keep',
          freeBred: false,
          turf: pick(['◎', '○', '△', '×']),
          dirt: pick(['◎', '○', '△', '×']),
          sp: Math.floor(random() * 80),
        });
        event(foalId, 'foalBorn', year + 1, { damId: mare.id });
        if (sex === 'female') {
          fillies.push({
            id: foalId,
            abilityNo,
            name,
            birthYear: year + 1,
            position: mare.position,
            generation: mare.generation + 1,
          });
        }
      }
      collections.breedings.push({
        id: breedingId,
        mareId: mare.id,
        gameYear: year,
        breedingType: 'designated',
        stallionId: sire.id,
        conception: conceived ? '受胎' : '不受胎',
        ...(conceived ? { expectedBirthYear: year + 1 } : {}),
        ...(foalId === undefined ? {} : { foalId }),
      });
      event(breedingId, 'breedingRecorded', year, { mareId: mare.id });
    }

    for (const [type, month] of importTypes) {
      collections.imports.push({
        id: nextId('import'),
        type,
        gameYear: year,
        timing: { month, week: 1 },
        fileName: `${String(year)}年${String(month)}月1週_${type}.txt`,
        sha256: serial.toString(16).padStart(64, '0'),
        summary: { apply: mares.length, skip: 0, review: 0, warn: 0, error: 0 },
        appliedAt: '2026-09-19T00:00:00.000Z',
      });
    }
  }

  const keywordSource = mares.find((mare) => mare.position === 1);
  const keywordHorse = collections.horses.find((horse) => horse.id === keywordSource?.id);
  return {
    game: { name: `效能${String(targetRecords)}`, startYear: START_YEAR, currentYear: year },
    collections,
    recordCount: count(),
    activeStallions: stallions.map(({ abilityNo: no, birthYear, name }) => ({
      abilityNo: no,
      birthYear,
      name,
    })),
    ownFillies: fillies.map(({ abilityNo: no, birthYear, name }) => ({
      abilityNo: no,
      birthYear,
      name,
    })),
    searchKeyword: typeof keywordHorse?.fullName === 'string' ? keywordHorse.fullName : 'テスト牝',
  };
}
