import { describe, expect, it } from 'vitest';
import {
  CONCEPTION_OPTIONS,
  loadMareBreedings,
  saveBreeding,
  type BreedingInput,
} from '../../src/services/breedings.ts';
import type { ServiceContext } from '../../src/services/context.ts';
import {
  DEFAULT_FOAL_FILTER,
  checkRegisterFoal,
  loadFoalList,
  loadMareFoals,
  matchesFoalFilter,
  nameFoal,
  registerFoal,
  updateFoal,
  type FoalInput,
} from '../../src/services/foals.ts';
import { changeCurrentYear, createGame } from '../../src/services/games.ts';
import { openLine } from '../../src/services/lines.ts';
import { addMarketMare, loadMareHerd, sellMare } from '../../src/services/mares.ts';
import { getHorse } from '../../src/storage/horses.ts';
import { readRecords, type StoredRecord } from '../../src/storage/records.ts';
import { RECORD_COLLECTIONS, type RecordCollection } from '../../src/storage/schema.ts';
import { useServiceContexts } from './helpers.ts';

interface Setup {
  readonly gameId: string;
  readonly founderId: string;
  readonly mareId: string;
}

/** 1968 年開局：第 1 系零代種牡馬與一匹起點母馬。 */
async function setup(context: ServiceContext): Promise<Setup> {
  const game = await createGame(context, { name: '產駒局', startYear: 1968 });
  await openLine(context, {
    position: 1,
    subsystem: 'ネアルコ',
    parentSystem: 'ネアルコ',
    color: '#c62828',
    founder: { fullName: 'テストシュボバ', abilityNo: '', sireName: '', damName: '' },
  });
  const added = await addMarketMare(context, {
    position: 1,
    generation: 0,
    fullName: '(外)オオトリモナーコス',
    abilityNo: '',
    birthYear: 1960,
    sireName: '',
    damName: '',
    sireSubsystem: 'マンノウォー',
    femaleLine: 'テスト牝系',
    noNamedFemaleLine: false,
    site: 32,
    origin: 'marketFound',
    originNote: '',
  });
  const breedings = await loadMareBreedings(context, added.horse.id);
  const founderOption = breedings.stallionOptions[0];
  if (founderOption === undefined) {
    throw new Error('找不到零代種牡馬');
  }
  return { gameId: game.id, founderId: founderOption.id, mareId: added.horse.id };
}

function breedingInput(setupValue: Setup, overrides: Partial<BreedingInput> = {}): BreedingInput {
  return {
    mareId: setupValue.mareId,
    gameYear: 1968,
    breedingType: 'designated',
    stallionId: setupValue.founderId,
    stallionName: '',
    conception: '受胎',
    ...overrides,
  };
}

function foalInput(damId: string, overrides: Partial<FoalInput> = {}): FoalInput {
  return {
    damId,
    birthYear: 1969,
    sex: 'female',
    sireName: '',
    disposition: undefined,
    sp: undefined,
    st: undefined,
    subParams: {},
    turf: undefined,
    dirt: undefined,
    distanceText: '',
    kodashi: undefined,
    note: '',
    ...overrides,
  };
}

async function snapshot(
  context: ServiceContext,
  gameId: string,
): Promise<Record<RecordCollection, StoredRecord[]>> {
  const entries = await Promise.all(
    RECORD_COLLECTIONS.map(
      async (collection) =>
        [collection, await readRecords(context.database, gameId, collection)] as const,
    ),
  );
  return Object.fromEntries(entries) as Record<RecordCollection, StoredRecord[]>;
}

describe('年度繁殖紀錄（需求規格 9.1）', () => {
  const open = useServiceContexts();

  it('[BRD-02] 四種受胎狀態分別保存與顯示，空胎與不受胎不合併，未確認不是未登記', async () => {
    const context = await open();
    const value = await setup(context);
    expect(CONCEPTION_OPTIONS).toEqual(['空胎', '受胎', '不受胎', '未確認']);

    const idle = await saveBreeding(
      context,
      breedingInput(value, { conception: '空胎', stallionId: undefined }),
    );
    expect(idle).toMatchObject({ conception: '空胎' });
    expect(idle).not.toHaveProperty('stallionId');
    expect((await loadMareHerd(context)).cards[0]?.conception).toBe('空胎');

    for (const conception of ['不受胎', '未確認', '受胎'] as const) {
      await saveBreeding(context, breedingInput(value, { conception }));
      expect((await loadMareHerd(context)).cards[0]?.conception).toBe(conception);
    }
    const rows = (await loadMareBreedings(context, value.mareId)).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.record).toMatchObject({ conception: '受胎', expectedBirthYear: 1969 });

    await saveBreeding(context, breedingInput(value, { conception: undefined }));
    const pending = (await loadMareBreedings(context, value.mareId)).rows[0]?.record;
    expect(pending).not.toHaveProperty('conception');
    expect(pending).not.toHaveProperty('expectedBirthYear');
    expect((await loadMareHerd(context)).cards[0]?.conception).toBeUndefined();

    const events = await readRecords(context.database, value.gameId, 'events');
    expect(events.filter((event) => event.type === 'breedingRecorded')).toHaveLength(5);
  });

  it('沒有種牡馬只能登記空胎；八系指定配種必須是有系位置的內部種牡馬；沒有變更時拒絕', async () => {
    const context = await open();
    const value = await setup(context);
    await expect(
      saveBreeding(context, breedingInput(value, { stallionId: undefined, conception: '受胎' })),
    ).rejects.toThrow('請選擇或填寫種牡馬');
    await expect(
      saveBreeding(
        context,
        breedingInput(value, { stallionId: undefined, stallionName: 'ソトノタネウマ' }),
      ),
    ).rejects.toThrow('八系指定配種必須選擇有系位置的內部種牡馬');
    await expect(saveBreeding(context, breedingInput(value, { gameYear: 1969 }))).rejects.toThrow(
      '配種年必須是',
    );
    const free = await saveBreeding(
      context,
      breedingInput(value, {
        breedingType: 'free',
        stallionId: undefined,
        stallionName: 'ソトノタネウマ',
      }),
    );
    expect(free).toMatchObject({ breedingType: 'free', stallionName: 'ソトノタネウマ' });
    await expect(
      saveBreeding(
        context,
        breedingInput(value, {
          breedingType: 'free',
          stallionId: undefined,
          stallionName: 'ソトノタネウマ',
        }),
      ),
    ).rejects.toThrow('繁殖紀錄沒有變更');
  });
});

describe('產駒（需求規格 9.3、9.4）', () => {
  const open = useServiceContexts();

  it('[BRD-01][LINE-08] 1968 年受胎 → 1969 年 4 月 1 週預定出生；確認出生後才建立產駒，第 1 系零代 × 起點母馬 = 第 1 系 1 代', async () => {
    const context = await open();
    const value = await setup(context);
    await saveBreeding(context, breedingInput(value));

    let breedings = await loadMareBreedings(context, value.mareId);
    expect(breedings.rows[0]).toMatchObject({
      record: { expectedBirthYear: 1969 },
      canConfirmBirth: false,
    });
    await expect(registerFoal(context, foalInput(value.mareId))).rejects.toThrow(
      '出生年必須是 1000～1968 的整數',
    );
    expect(await readRecords(context.database, value.gameId, 'foals')).toEqual([]);

    await changeCurrentYear(context, 1969);
    breedings = await loadMareBreedings(context, value.mareId);
    expect(breedings.rows[0]?.canConfirmBirth).toBe(true);
    expect((await loadMareFoals(context, value.mareId)).timeline).toEqual([
      expect.objectContaining({ kind: 'expected', birthYear: 1969 }),
    ]);

    const check = await checkRegisterFoal(context, foalInput(value.mareId));
    expect(check).toEqual({
      issues: [],
      fields: {},
      warnings: [],
      preview: {
        breedingYear: 1968,
        freeBred: false,
        lineage: { position: 1, generation: 1 },
        sireLabel: 'テストシュボバ',
        trackingName: 'オオトリモナーコス1969',
      },
    });
    const registered = await registerFoal(context, foalInput(value.mareId));
    expect(registered.foal).toEqual({
      id: registered.horse.id,
      damId: value.mareId,
      birthYear: 1969,
      lineage: { position: 1, generation: 1 },
      freeBred: false,
      disposition: 'keep',
    });
    expect(registered.horse).toMatchObject({
      sex: 'female',
      birthYear: 1969,
      sireId: value.founderId,
      damId: value.mareId,
      sireSubsystem: 'ネアルコ',
      femaleLine: 'テスト牝系',
    });
    expect(registered.horse).not.toHaveProperty('officialName');
    expect(registered.trackingName).toBe('オオトリモナーコス1969');

    const dam = await getHorse(context.database, value.gameId, value.mareId);
    expect(dam?.sireSubsystem).toBe('マンノウォー');
    breedings = await loadMareBreedings(context, value.mareId);
    expect(breedings.rows[0]).toMatchObject({
      record: { foalId: registered.horse.id },
      foalName: 'オオトリモナーコス1969',
      canConfirmBirth: false,
    });
    const foals = await loadMareFoals(context, value.mareId);
    expect(foals.timeline).toEqual([
      { kind: 'foal', birthYear: 1969, foalId: registered.horse.id },
    ]);
    expect(foals.cards[0]).toMatchObject({
      name: 'オオトリモナーコス1969',
      named: false,
      lineage: { position: 1, generation: 1 },
      sireName: 'テストシュボバ',
      damName: '(外)オオトリモナーコス',
    });

    await expect(
      saveBreeding(context, breedingInput(value, { conception: '不受胎' })),
    ).rejects.toThrow('已連結產駒');
  });

  it('[BRD-06] 同一母馬同一出生年新增第二匹產駒 → 阻止並指出既有產駒', async () => {
    const context = await open();
    const value = await setup(context);
    await saveBreeding(context, breedingInput(value));
    await changeCurrentYear(context, 1969);
    await registerFoal(context, foalInput(value.mareId));
    const before = await snapshot(context, value.gameId);

    const check = await checkRegisterFoal(context, foalInput(value.mareId, { sex: 'male' }));
    expect(check.issues).toContain(
      '1969 年出生的產駒已有「オオトリモナーコス1969」，同一母馬同一出生年只能有一匹',
    );
    // 問題記在出生年欄位，介面據此把錯誤與欄位建立關聯（UI-05）。
    expect(check.fields.birthYear).toBe(
      '1969 年出生的產駒已有「オオトリモナーコス1969」，同一母馬同一出生年只能有一匹',
    );
    await expect(registerFoal(context, foalInput(value.mareId, { sex: 'male' }))).rejects.toThrow(
      '已有「オオトリモナーコス1969」',
    );
    expect(await snapshot(context, value.gameId)).toEqual(before);
  });

  it('[BRD-15][BRD-16] 自由配種產駒一律待售、沒有系與代數；售出後仍可從母馬紀錄查到父母、出生年、追蹤名與正式馬名', async () => {
    const context = await open();
    const value = await setup(context);
    await saveBreeding(
      context,
      breedingInput(value, {
        breedingType: 'free',
        stallionId: undefined,
        stallionName: 'ソトノタネウマ',
      }),
    );
    await changeCurrentYear(context, 1969);
    await expect(
      registerFoal(context, foalInput(value.mareId, { disposition: 'keep' })),
    ).rejects.toThrow('自由配種產駒只能待售或已售出');
    const registered = await registerFoal(context, foalInput(value.mareId, { sex: 'male' }));
    expect(registered.foal).toEqual({
      id: registered.horse.id,
      damId: value.mareId,
      birthYear: 1969,
      freeBred: true,
      disposition: 'forSale',
    });
    expect(registered.horse).toMatchObject({ sireName: 'ソトノタネウマ', damId: value.mareId });
    await expect(
      updateFoal(context, {
        foalId: registered.horse.id,
        disposition: 'keep',
        sp: undefined,
        st: undefined,
        subParams: {},
        turf: undefined,
        dirt: undefined,
        distanceText: '',
        kodashi: undefined,
        note: '',
      }),
    ).rejects.toThrow('不能保留');

    await updateFoal(context, {
      foalId: registered.horse.id,
      disposition: 'sold',
      sp: undefined,
      st: undefined,
      subParams: {},
      turf: undefined,
      dirt: undefined,
      distanceText: '',
      kodashi: undefined,
      note: '',
    });
    await nameFoal(context, { foalId: registered.horse.id, officialName: 'ウリモノ' });
    const card = (await loadMareFoals(context, value.mareId)).cards[0];
    expect(card).toMatchObject({
      name: 'ウリモノ',
      trackingName: 'オオトリモナーコス1969',
      birthYear: 1969,
      sireName: 'ソトノタネウマ',
      damName: '(外)オオトリモナーコス',
      disposition: 'sold',
      freeBred: true,
      lineage: undefined,
    });
  });

  it('沒有相符受胎紀錄（例如購入時已受胎）→ 警告並確認後比照自由配種產駒登記', async () => {
    const context = await open();
    const value = await setup(context);
    const check = await checkRegisterFoal(
      context,
      foalInput(value.mareId, { birthYear: 1968, sireName: 'ソトノチチ' }),
    );
    expect(check.issues).toEqual([]);
    expect(check.warnings.map((warning) => warning.code)).toEqual(['noConceptionRecord']);
    expect(check.warnings[0]?.message).toContain('1967 年沒有繁殖紀錄');
    await expect(
      registerFoal(context, foalInput(value.mareId, { birthYear: 1968 })),
    ).rejects.toThrow('1967 年沒有繁殖紀錄');
    const registered = await registerFoal(
      context,
      foalInput(value.mareId, {
        birthYear: 1968,
        sireName: 'ソトノチチ',
        acceptedWarnings: ['noConceptionRecord'],
      }),
    );
    expect(registered.foal).toMatchObject({ freeBred: true, disposition: 'forSale' });
    expect(registered.horse).toMatchObject({ sireName: 'ソトノチチ' });
    const events = await readRecords(context.database, value.gameId, 'events');
    expect(events.find((event) => event.type === 'foalBorn')).toMatchObject({
      subjectId: registered.horse.id,
      gameYear: 1968,
      timing: { month: 4, week: 1 },
      after: { confirmations: ['noConceptionRecord'], freeBred: true },
    });
  });

  it('產駒已比照自由配種登記時，前一年不能改登記為受胎，也不顯示確認出生；其他狀態可以登記', async () => {
    const context = await open();
    const value = await setup(context);
    await saveBreeding(context, breedingInput(value, { conception: '未確認' }));
    await changeCurrentYear(context, 1969);
    await registerFoal(
      context,
      foalInput(value.mareId, { acceptedWarnings: ['noConceptionRecord'] }),
    );
    await expect(saveBreeding(context, breedingInput(value))).rejects.toThrow(
      '1969 年已登記沒有連結繁殖紀錄的產駒，不能把 1968 年改登記為受胎',
    );
    await saveBreeding(context, breedingInput(value, { conception: '不受胎' }));
    const rows = (await loadMareBreedings(context, value.mareId)).rows;
    expect(rows[0]).toMatchObject({ record: { conception: '不受胎' }, canConfirmBirth: false });
  });

  it('[BRD-07][BRD-08] 補登正式馬名後主要顯示正式馬名，識別、母馬、出生年與能力不變，追蹤名仍可搜尋；清空後回退追蹤名', async () => {
    const context = await open();
    const value = await setup(context);
    await saveBreeding(context, breedingInput(value));
    await changeCurrentYear(context, 1969);
    const registered = await registerFoal(
      context,
      foalInput(value.mareId, { sp: 72, subParams: { power: 'A' }, turf: '◎', dirt: '△' }),
    );
    const foalId = registered.horse.id;

    await nameFoal(context, { foalId, officialName: ' オオトリセイシキ ' });
    let list = await loadFoalList(context);
    expect(list.cards[0]).toMatchObject({
      id: foalId,
      name: 'オオトリセイシキ',
      named: true,
      damId: value.mareId,
      birthYear: 1969,
      sp: 72,
      subParams: { power: 'A' },
      turf: '◎',
      dirt: '△',
      surface: 'turf',
    });
    const search = (keyword: string) =>
      list.cards.filter((card) => matchesFoalFilter(card, { ...DEFAULT_FOAL_FILTER, keyword }));
    expect(search('モナーコス1969')).toHaveLength(1);
    expect(search('セイシキ')).toHaveLength(1);

    await nameFoal(context, { foalId, officialName: 'オオトリカイメイ' });
    const renamed = await getHorse(context.database, value.gameId, foalId);
    expect(renamed).toMatchObject({
      officialName: 'オオトリカイメイ',
      aliases: [{ kind: 'manual', name: 'オオトリセイシキ', gameYear: 1969 }],
    });

    await nameFoal(context, { foalId, officialName: '' });
    list = await loadFoalList(context);
    expect(list.cards[0]).toMatchObject({ name: 'オオトリモナーコス1969', named: false });
    expect(await getHorse(context.database, value.gameId, foalId)).not.toHaveProperty(
      'officialName',
    );
    expect(
      list.cards.filter((card) =>
        matchesFoalFilter(card, { ...DEFAULT_FOAL_FILTER, unnamedOnly: true }),
      ),
    ).toHaveLength(1);
    await expect(nameFoal(context, { foalId, officialName: '  ' })).rejects.toThrow(
      '正式馬名沒有變更',
    );
    const named = (await readRecords(context.database, value.gameId, 'events')).filter(
      (event) => event.type === 'horseNamed',
    );
    expect(named.map((event) => [event.before, event.after])).toEqual([
      [{}, { officialName: 'オオトリセイシキ' }],
      [{ officialName: 'オオトリセイシキ' }, { officialName: 'オオトリカイメイ' }],
      [{ officialName: 'オオトリカイメイ' }, {}],
    ]);
  });

  it('[BRD-10] 已售出的產駒補名 → 售出狀態不變', async () => {
    const context = await open();
    const value = await setup(context);
    await saveBreeding(context, breedingInput(value));
    await changeCurrentYear(context, 1969);
    const { horse } = await registerFoal(context, foalInput(value.mareId, { disposition: 'sold' }));
    await nameFoal(context, { foalId: horse.id, officialName: 'ウレタウマ' });
    const card = (await loadFoalList(context)).cards[0];
    expect(card).toMatchObject({ name: 'ウレタウマ', disposition: 'sold' });
  });

  it('[BRD-19] 遊戲第一年沒有自產幼駒 → 產駒清單與時間軸都是零筆，沒有錯誤', async () => {
    const context = await open();
    const value = await setup(context);
    expect(await loadFoalList(context)).toEqual({ currentYear: 1968, cards: [] });
    expect(await loadMareFoals(context, value.mareId)).toEqual({
      currentYear: 1968,
      timeline: [],
      cards: [],
    });
  });

  it('[DATA-01] 修改單筆產駒或母馬 → 只更新受影響的紀錄、事件與遊戲局', async () => {
    const context = await open();
    const value = await setup(context);
    const other = await addMarketMare(context, {
      position: 1,
      generation: 0,
      fullName: 'ベツノヒンバ',
      abilityNo: '',
      sireName: '',
      damName: '',
      sireSubsystem: '',
      femaleLine: '',
      noNamedFemaleLine: false,
      site: 32,
      origin: 'marketFound',
      originNote: '',
    });
    await saveBreeding(context, breedingInput(value));
    await saveBreeding(context, breedingInput({ ...value, mareId: other.horse.id }));
    await changeCurrentYear(context, 1969);
    const first = await registerFoal(context, foalInput(value.mareId));
    await registerFoal(context, foalInput(other.horse.id, { sex: 'male' }));

    const changedRecords = async (action: () => Promise<unknown>) => {
      const before = await snapshot(context, value.gameId);
      await action();
      const after = await snapshot(context, value.gameId);
      return RECORD_COLLECTIONS.flatMap((collection) => {
        const previous = new Map(before[collection].map((record) => [record.id, record]));
        return after[collection]
          .filter(
            (record) => JSON.stringify(previous.get(String(record.id))) !== JSON.stringify(record),
          )
          .map((record) => `${collection}:${String(record.id)}`);
      });
    };

    const renamed = await changedRecords(() =>
      nameFoal(context, { foalId: first.horse.id, officialName: 'ヒトツメ' }),
    );
    expect(renamed.filter((key) => !key.startsWith('events:'))).toEqual([
      `horses:${first.horse.id}`,
    ]);
    expect(renamed.filter((key) => key.startsWith('events:'))).toHaveLength(1);

    const corrected = await changedRecords(() =>
      updateFoal(context, {
        foalId: first.horse.id,
        disposition: 'forSale',
        sp: 65,
        st: 40,
        subParams: {},
        turf: '○',
        dirt: undefined,
        distanceText: '1400～2000m',
        kodashi: 3,
        note: '',
      }),
    );
    expect(corrected.filter((key) => !key.startsWith('events:'))).toEqual([
      `foals:${first.horse.id}`,
    ]);

    const sold = await changedRecords(() => sellMare(context, other.horse.id));
    expect(sold.filter((key) => !key.startsWith('events:'))).toEqual([`mares:${other.horse.id}`]);
  });
});
