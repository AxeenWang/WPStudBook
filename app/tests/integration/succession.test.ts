import { describe, expect, it } from 'vitest';
import { loadMareBreedings, saveBreeding } from '../../src/services/breedings.ts';
import type { ServiceContext } from '../../src/services/context.ts';
import { nameFoal, registerFoal, updateFoal, type FoalInput } from '../../src/services/foals.ts';
import { changeCurrentYear, createGame } from '../../src/services/games.ts';
import {
  DEFAULT_MARE_FILTER,
  generationTabs,
  handoverGenerations,
  matchesMareFilter,
  type MareGroupView,
} from '../../src/services/mare-list.ts';
import { addMarketMare, loadMareDetail, loadMareHerd, sellMare } from '../../src/services/mares.ts';
import { openFirstLine } from '../../src/services/lines.ts';
import {
  checkConvertFoal,
  confirmSuccession,
  convertFoalToMare,
  loadSisterComparison,
} from '../../src/services/succession.ts';
import { getHorse } from '../../src/storage/horses.ts';
import { listLines } from '../../src/storage/lines.ts';
import { putRecords, readRecords } from '../../src/storage/records.ts';
import { useServiceContexts } from './helpers.ts';

interface Family {
  readonly gameId: string;
  readonly damId: string;
  readonly founderId: string;
  /** 1969 年出生的母駒。 */
  readonly elderId: string;
  /** 1970 年出生、同父同母的母駒。 */
  readonly youngerId: string;
}

function foalInput(damId: string, birthYear: number, overrides: Partial<FoalInput> = {}) {
  return {
    damId,
    birthYear,
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
  } satisfies FoalInput;
}

/** 第 1 系零代 × 起點母馬，1969、1970 年各生一匹母駒；目前遊戲年 1970。 */
async function raiseFamily(context: ServiceContext): Promise<Family> {
  const game = await createGame(context, { name: '接替局', startYear: 1968 });
  await openFirstLine(context, {
    subsystem: 'ネアルコ',
    parentSystem: 'ネアルコ',
    color: '#c62828',
    founder: { fullName: 'テストシュボバ', abilityNo: '', sireName: '', damName: '' },
  });
  const dam = await addMarketMare(context, {
    position: 1,
    generation: 0,
    fullName: '(外)オオトリモナーコス',
    abilityNo: '',
    birthYear: 1960,
    sireName: '',
    damName: '',
    sireSubsystem: 'マンノウォー',
    femaleLine: '',
    noNamedFemaleLine: false,
    site: 32,
    origin: 'marketFound',
    originNote: '',
  });
  const damId = dam.horse.id;
  const founderId = (await loadMareBreedings(context, damId)).stallionOptions[0]?.id ?? '';
  const breed = (gameYear: number) =>
    saveBreeding(context, {
      mareId: damId,
      gameYear,
      breedingType: 'designated',
      stallionId: founderId,
      stallionName: '',
      conception: '受胎',
    });
  await breed(1968);
  await changeCurrentYear(context, 1969);
  const elder = await registerFoal(context, foalInput(damId, 1969, { sp: 70 }));
  await breed(1969);
  await changeCurrentYear(context, 1970);
  const younger = await registerFoal(context, foalInput(damId, 1970, { sp: 75 }));
  return {
    gameId: game.id,
    damId,
    founderId,
    elderId: elder.horse.id,
    youngerId: younger.horse.id,
  };
}

describe('自家母駒轉入與世代成立（需求規格 8.2、8.4、9.6）', () => {
  const open = useServiceContexts();

  it('[LINE-17][MARE-07] 第一匹自家母駒以暫定保留轉入 → 第 1 系 1 代立即成立；自身父系由父馬決定', async () => {
    const context = await open();
    const family = await raiseFamily(context);
    expect((await listLines(context.database, family.gameId))[0]?.establishedGenerations).toEqual(
      [],
    );

    const check = await checkConvertFoal(context, { foalId: family.elderId, site: 32 });
    expect(check).toEqual({
      issues: [],
      preview: {
        group: { kind: 'own', position: 1, generation: 1 },
        succession: 'provisional',
        establishes: true,
        sisterIds: [],
      },
    });
    const converted = await convertFoalToMare(context, { foalId: family.elderId, site: 32 });
    expect(converted).toEqual({
      mare: {
        id: family.elderId,
        group: { kind: 'own', position: 1, generation: 1 },
        origin: 'ownRetired',
        status: 'producing',
        site: 32,
        succession: 'provisional',
      },
      establishedGeneration: true,
    });
    const [line] = await listLines(context.database, family.gameId);
    expect(line?.establishedGenerations).toEqual([{ generation: 1, gameYear: 1970 }]);

    const horse = await getHorse(context.database, family.gameId, family.elderId);
    expect(horse?.sireSubsystem).toBe('ネアルコ');
    const dam = await getHorse(context.database, family.gameId, family.damId);
    expect(dam?.sireSubsystem).toBe('マンノウォー');
    const card = (await loadMareHerd(context)).cards.find((item) => item.id === family.elderId);
    expect(card).toMatchObject({
      name: 'オオトリモナーコス1969',
      generation: 1,
      sireSubsystem: 'ネアルコ',
      group: { kind: 'own', position: 1, generation: 1 },
      succession: 'provisional',
    });

    const events = await readRecords(context.database, family.gameId, 'events');
    expect(events.filter((event) => event.type === 'lineGenerationEstablished')).toEqual([
      expect.objectContaining({
        subjectId: line?.id,
        gameYear: 1970,
        after: { generation: 1, mareId: family.elderId },
      }),
    ]);
  });

  it('轉入後繁殖牝馬馬名唯讀（需求規格 6.4），產駒紀錄的牧場處置固定為保留', async () => {
    const context = await open();
    const family = await raiseFamily(context);
    await nameFoal(context, { foalId: family.elderId, officialName: 'アネ' });
    await convertFoalToMare(context, { foalId: family.elderId, site: 32 });
    await expect(
      nameFoal(context, { foalId: family.elderId, officialName: 'カイメイ' }),
    ).rejects.toThrow('繁殖牝馬馬名唯讀');
    const details = {
      foalId: family.elderId,
      sp: 71,
      st: undefined,
      subParams: {},
      turf: undefined,
      dirt: undefined,
      distanceText: '',
      kodashi: undefined,
      note: '',
    };
    await expect(updateFoal(context, { ...details, disposition: 'sold' })).rejects.toThrow(
      '牧場處置固定為保留',
    );
    expect(await updateFoal(context, { ...details, disposition: 'keep' })).toMatchObject({
      sp: 71,
      disposition: 'keep',
    });
    expect((await getHorse(context.database, family.gameId, family.elderId))?.officialName).toBe(
      'アネ',
    );
  });

  it('[MARE-04] 某代唯一的母馬離圈 → 該代仍為已成立', async () => {
    const context = await open();
    const family = await raiseFamily(context);
    await convertFoalToMare(context, { foalId: family.elderId, site: 32 });
    await sellMare(context, family.elderId);
    const [line] = await listLines(context.database, family.gameId);
    expect(line?.establishedGenerations).toEqual([{ generation: 1, gameYear: 1970 }]);
    const card = (await loadMareHerd(context)).cards.find((item) => item.id === family.elderId);
    expect(card).toMatchObject({ status: 'left', succession: 'sold' });
  });

  it('[PED-08] 自由配種、公駒、已售出、已轉入或系與代數與父母不符的產駒不能轉入', async () => {
    const context = await open();
    const family = await raiseFamily(context);
    const issuesOf = async (foalId: string, site = 32) =>
      (await checkConvertFoal(context, { foalId, site })).issues;

    expect(await issuesOf(family.elderId, Number.NaN)).toEqual(['請選擇據點']);

    const foals = await readRecords(context.database, family.gameId, 'foals');
    const elderFoal = foals.find((foal) => foal.id === family.elderId);
    await putRecords(context.database, family.gameId, 'foals', [
      { ...elderFoal, lineage: { position: 1, generation: 2 } },
    ]);
    expect(await issuesOf(family.elderId)).toEqual([
      '出生紀錄的系與代數（第 1 系 2 代）與父母推導的結果（第 1 系 1 代）不符',
    ]);
    await putRecords(context.database, family.gameId, 'foals', [
      { ...elderFoal, disposition: 'sold' },
    ]);
    expect(await issuesOf(family.elderId)).toEqual(['已售出的產駒不能轉入']);

    await saveBreeding(context, {
      mareId: family.damId,
      gameYear: 1970,
      breedingType: 'free',
      stallionId: undefined,
      stallionName: 'ソトノタネウマ',
      conception: '受胎',
    });
    await changeCurrentYear(context, 1971);
    const colt = await registerFoal(context, foalInput(family.damId, 1971, { sex: 'male' }));
    expect(await issuesOf(colt.horse.id)).toEqual([
      '只有母駒可以轉入為繁殖牝馬',
      '自由配種產駒不能成為八系後繼，不能轉入母馬群',
    ]);

    await convertFoalToMare(context, { foalId: family.youngerId, site: 33 });
    expect(await issuesOf(family.youngerId)).toEqual(['這匹產駒已轉入為繁殖牝馬']);
    await expect(
      convertFoalToMare(context, { foalId: family.youngerId, site: 33 }),
    ).rejects.toThrow('已轉入');
  });
});

describe('姊妹接替與交接中檢視（需求規格 8.5、8.9、13.3）', () => {
  const open = useServiceContexts();

  it('[MARE-12] 同父同母姊妹先後轉入 → 第二匹成為候選不被阻止；比較後只能有一匹正式保留，被取代者保留歷程', async () => {
    const context = await open();
    const family = await raiseFamily(context);
    await convertFoalToMare(context, { foalId: family.elderId, site: 32 });
    const second = await convertFoalToMare(context, { foalId: family.youngerId, site: 32 });
    expect(second).toMatchObject({
      mare: { succession: 'sisterCandidate' },
      establishedGeneration: false,
    });
    let tabs = generationTabs((await loadMareHerd(context)).cards, 1);
    expect(tabs.find((tab) => tab.generation === 1)).toEqual({
      generation: 1,
      producing: 2,
      pendingSuccession: 2,
      left: 0,
    });

    const comparison = await loadSisterComparison(context, family.youngerId);
    expect(comparison).toEqual([
      expect.objectContaining({
        id: family.elderId,
        name: 'オオトリモナーコス1969',
        birthYear: 1969,
        sireName: 'テストシュボバ',
        damName: '(外)オオトリモナーコス',
        sp: 70,
        succession: 'provisional',
        canConfirm: true,
      }),
      expect.objectContaining({
        id: family.youngerId,
        birthYear: 1970,
        sp: 75,
        succession: 'sisterCandidate',
        canConfirm: true,
      }),
    ]);

    await confirmSuccession(context, family.youngerId);
    let cards = (await loadMareHerd(context)).cards;
    const successionOf = (id: string) => cards.find((card) => card.id === id)?.succession;
    expect([successionOf(family.elderId), successionOf(family.youngerId)]).toEqual([
      'replaced',
      'confirmed',
    ]);
    tabs = generationTabs(cards, 1);
    expect(tabs.find((tab) => tab.generation === 1)?.pendingSuccession).toBe(0);
    await expect(confirmSuccession(context, family.youngerId)).rejects.toThrow('已經是正式保留');

    await confirmSuccession(context, family.elderId);
    cards = (await loadMareHerd(context)).cards;
    expect([successionOf(family.elderId), successionOf(family.youngerId)]).toEqual([
      'confirmed',
      'replaced',
    ]);
    const confirmedCount = cards.filter((card) => card.succession === 'confirmed').length;
    expect(confirmedCount).toBe(1);

    const history = (await loadMareDetail(context, family.elderId)).history.map(
      (item) => item.type,
    );
    expect(history).toEqual([
      'successionChanged',
      'successionChanged',
      'mareAdded',
      'foalBorn',
      'horseCreated',
    ]);
    const changes = (await readRecords(context.database, family.gameId, 'events'))
      .filter((event) => event.type === 'successionChanged')
      .map((event) => [event.subjectId, event.before, event.after]);
    expect(changes).toEqual([
      [family.youngerId, { succession: 'sisterCandidate' }, { succession: 'confirmed' }],
      [family.elderId, { succession: 'provisional' }, { succession: 'replaced' }],
      [family.elderId, { succession: 'replaced' }, { succession: 'confirmed' }],
      [family.youngerId, { succession: 'confirmed' }, { succession: 'replaced' }],
    ]);
  });

  it('[MARE-23] 女兒暫定保留轉入、母親當年四月已生產 → 母親卡片提示可出售；不出售也能繼續登記配種', async () => {
    const context = await open();
    const family = await raiseFamily(context);
    const damCard = async () =>
      (await loadMareHerd(context)).cards.find((card) => card.id === family.damId);
    expect((await damCard())?.suggestSellMother).toBe(false);

    await convertFoalToMare(context, { foalId: family.elderId, site: 32 });
    expect((await damCard())?.suggestSellMother).toBe(true);
    expect((await loadMareDetail(context, family.damId)).card.suggestSellMother).toBe(true);

    await saveBreeding(context, {
      mareId: family.damId,
      gameYear: 1970,
      breedingType: 'designated',
      stallionId: family.founderId,
      stallionName: '',
      conception: '空胎',
    });
    await changeCurrentYear(context, 1971);
    expect((await damCard())?.suggestSellMother).toBe(false);
  });

  it('[MARE-03] 同系相鄰兩代都有生產中母馬 → 交接中同時顯示母女，單代檢視只顯示指定代數', async () => {
    const context = await open();
    const family = await raiseFamily(context);
    let cards = (await loadMareHerd(context)).cards;
    expect(handoverGenerations(cards, 1)).toBeUndefined();

    await convertFoalToMare(context, { foalId: family.elderId, site: 32 });
    cards = (await loadMareHerd(context)).cards;
    const handover = handoverGenerations(cards, 1);
    expect(handover).toEqual({ handover: [0, 1] });
    const shown = (view: MareGroupView) =>
      cards
        .filter((card) => matchesMareFilter(card, view, DEFAULT_MARE_FILTER))
        .map((card) => card.id)
        .sort();
    expect(shown({ position: 1, generation: handover ?? 'all' })).toEqual(
      [family.damId, family.elderId].sort(),
    );
    expect(shown({ position: 1, generation: 0 })).toEqual([family.damId]);
    expect(shown({ position: 1, generation: 1 })).toEqual([family.elderId]);
  });

  it('有未命名產駒篩選：母馬有未售出且未命名的產駒時符合，補名後不符合', async () => {
    const context = await open();
    const family = await raiseFamily(context);
    const unnamed = async () =>
      (await loadMareHerd(context)).cards
        .filter((card) =>
          matchesMareFilter(
            card,
            { position: 1, generation: 'all' },
            { ...DEFAULT_MARE_FILTER, unnamedFoalOnly: true },
          ),
        )
        .map((card) => card.id);
    expect(await unnamed()).toEqual([family.damId]);
    await nameFoal(context, { foalId: family.elderId, officialName: 'アネ' });
    expect(await unnamed()).toEqual([family.damId]);
    await nameFoal(context, { foalId: family.youngerId, officialName: 'イモウト' });
    expect(await unnamed()).toEqual([]);
  });
});
