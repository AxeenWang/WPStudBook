import { describe, expect, it } from 'vitest';
import type { ServiceContext } from '../../src/services/context.ts';
import { changeCurrentYear, createGame, getCurrentGame } from '../../src/services/games.ts';
import { DEFAULT_MARE_FILTER, matchesMareFilter } from '../../src/services/mare-list.ts';
import {
  addMarketMare,
  loadMareDetail,
  loadMareHerd,
  previewSellMare,
  saveMareYearly,
  sellMare,
  setYearPlan,
  transferMare,
  type MareYearlyInput,
  type MarketMareInput,
} from '../../src/services/mares.ts';
import { countGameRecords } from '../../src/storage/games.ts';
import { modifyMare } from '../../src/storage/mares.ts';
import { putRecords, readRecords } from '../../src/storage/records.ts';
import { useServiceContexts } from './helpers.ts';

const STARTER: MarketMareInput = {
  position: 1,
  generation: 0,
  fullName: '(外)テストヒンバ',
  abilityNo: '',
  birthYear: 1950,
  sireName: '',
  damName: '',
  sireSubsystem: '',
  femaleLine: '',
  noNamedFemaleLine: false,
  site: 32,
  origin: 'ownRetired',
  originNote: '',
};

const STARTER_GROUP = { kind: 'starter', position: 1, generation: 0 };

const BLANK = { value: undefined, boosted: false };

const TOUCH = { updatedAt: '2026-09-15T01:00:00.000Z', appVersion: '9.9.9' };

/** createGame 用掉 id-0001；addMarketMare 產生馬匹 id-0002 與事件 id-0003、id-0004；時間用到 00:00:03。 */
async function setup(context: ServiceContext): Promise<{ gameId: string; mareId: string }> {
  const game = await createGame(context, { name: '母馬局', startYear: 1968 });
  const added = await addMarketMare(context, STARTER);
  return { gameId: game.id, mareId: added.horse.id };
}

function blankYearly(mareId: string): MareYearlyInput {
  return {
    mareId,
    vitalityMay: BLANK,
    vitalityJuly: BLANK,
    kodashi: undefined,
    breedingYears: undefined,
    breedingCount: undefined,
  };
}

describe('繁殖牝馬操作', () => {
  const openContext = useServiceContexts();

  it('[MARE-08][MARE-20] 賣出只改狀態：離開生產中、來源不變，事件保存前後值；已離圈不能再賣出', async () => {
    const context = await openContext();
    const { gameId, mareId } = await setup(context);
    const second = await addMarketMare(context, { ...STARTER, fullName: 'テストニバン' });

    expect(await previewSellMare(context, mareId)).toEqual({
      name: '(外)テストヒンバ',
      group: STARTER_GROUP,
      producingInGroup: 2,
    });
    const sold = await sellMare(context, mareId);

    expect(sold).toEqual({
      id: mareId,
      group: STARTER_GROUP,
      origin: 'ownRetired',
      status: 'left',
      leftReason: 'sold',
      site: 32,
    });
    const events = await readRecords(context.database, gameId, 'events');
    expect(events.find((event) => event.type === 'mareSold')).toEqual({
      id: 'id-0008',
      subjectId: mareId,
      type: 'mareSold',
      gameYear: 1968,
      before: { status: 'producing' },
      after: { status: 'left', leftReason: 'sold' },
      source: 'user',
      occurredAt: '2026-09-15T00:00:06.000Z',
    });
    const { cards } = await loadMareHerd(context);
    expect(cards.find((item) => item.id === mareId)).toMatchObject({
      status: 'left',
      leftReason: 'sold',
      origin: 'ownRetired',
      vitality: { vitality: { state: 'notApplicable' } },
    });
    const view = { position: 1, generation: 0 } as const;
    expect(
      cards
        .filter((item) => matchesMareFilter(item, view, DEFAULT_MARE_FILTER))
        .map((item) => item.id),
    ).toEqual([second.horse.id]);
    expect(
      cards
        .filter((item) => matchesMareFilter(item, view, { ...DEFAULT_MARE_FILTER, status: 'left' }))
        .map((item) => item.id),
    ).toEqual([mareId]);

    await expect(sellMare(context, mareId)).rejects.toMatchObject({ code: 'invalidInput' });
    await expect(previewSellMare(context, mareId)).rejects.toMatchObject({ code: 'invalidInput' });
    await expect(sellMare(context, 'missing')).rejects.toMatchObject({ code: 'invalidInput' });
    expect((await countGameRecords(context.database, gameId)).horses).toBe(2);
  });

  it('賣出自家母馬時，姊妹接替狀態一併改為已售出', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '母馬局', startYear: 1968 });
    await putRecords(context.database, game.id, 'horses', [
      { id: 'own-1', sex: 'female', fullName: 'テストジカ', stageNumbers: [], aliases: [] },
    ]);
    await putRecords(context.database, game.id, 'mares', [
      {
        id: 'own-1',
        group: { kind: 'own', position: 1, generation: 1 },
        origin: 'other',
        status: 'producing',
        site: 32,
        succession: 'provisional',
      },
    ]);

    const sold = await sellMare(context, 'own-1');

    expect(sold).toMatchObject({ status: 'left', leftReason: 'sold', succession: 'sold' });
    const events = await readRecords(context.database, game.id, 'events');
    expect(events[0]).toMatchObject({
      type: 'mareSold',
      before: { status: 'producing', succession: 'provisional' },
      after: { status: 'left', leftReason: 'sold', succession: 'sold' },
    });
  });

  it('[MARE-19] 轉場保存原據點、新據點、年、時點與來源；輸入錯誤時不寫入', async () => {
    const context = await openContext();
    const { gameId, mareId } = await setup(context);

    await expect(
      transferMare(context, { mareId, site: 31, month: 13, week: 0 }),
    ).rejects.toMatchObject({
      code: 'invalidInput',
      message: '請選擇新據點；月份必須是 1～12 的整數；週必須是 1～5 的整數',
    });
    await expect(
      transferMare(context, { mareId, site: 32, month: 5, week: 1 }),
    ).rejects.toMatchObject({ code: 'invalidInput', message: '新據點與目前據點相同' });
    await expect(
      transferMare(context, { mareId, site: 34, month: undefined, week: 1 }),
    ).rejects.toMatchObject({ code: 'invalidInput' });

    const moved = await transferMare(context, { mareId, site: 34, month: 7, week: 2 });

    expect(moved.site).toBe(34);
    const events = await readRecords(context.database, gameId, 'events');
    expect(events.find((event) => event.type === 'mareTransferred')).toEqual({
      id: 'id-0005',
      subjectId: mareId,
      type: 'mareTransferred',
      gameYear: 1968,
      timing: { month: 7, week: 2 },
      before: { site: 32 },
      after: { site: 34 },
      source: 'user',
      occurredAt: '2026-09-15T00:00:04.000Z',
    });
    expect((await loadMareDetail(context, mareId)).history[0]).toEqual({
      id: 'id-0005',
      type: 'mareTransferred',
      gameYear: 1968,
      timing: { month: 7, week: 2 },
      occurredAt: '2026-09-15T00:00:04.000Z',
      fromSite: 32,
      toSite: 34,
    });
  });

  it('[MARE-22] 今年計畫連同年份保存且不寫事件；目前遊戲年變更後視為待定；已離圈不能設定', async () => {
    const context = await openContext();
    const { gameId, mareId } = await setup(context);

    const planned = await setYearPlan(context, { mareId, plan: 'waitVitality' });

    expect(planned.yearPlan).toEqual({ plan: 'waitVitality', gameYear: 1968 });
    expect((await loadMareHerd(context)).cards[0]?.yearPlan).toBe('waitVitality');
    expect(await readRecords(context.database, gameId, 'events')).toHaveLength(2);

    await changeCurrentYear(context, 1969);
    expect((await loadMareHerd(context)).cards[0]?.yearPlan).toBe('undecided');

    await sellMare(context, mareId);
    await expect(setYearPlan(context, { mareId, plan: 'rest' })).rejects.toMatchObject({
      code: 'invalidInput',
    });
  });

  it('[MARE-13] 活力 0、73、100 都能保存並成為卡片的今年活力；空白為待更新，不視為 0；更正保存前後值', async () => {
    const context = await openContext();
    const { gameId, mareId } = await setup(context);
    const base = blankYearly(mareId);

    await expect(saveMareYearly(context, base)).rejects.toMatchObject({
      code: 'invalidInput',
      message: '年度資料沒有變更',
    });
    const zero = await saveMareYearly(context, {
      ...base,
      vitalityMay: { value: 0, boosted: false },
    });

    expect(zero).toEqual({
      id: 'id-0005',
      horseId: mareId,
      gameYear: 1968,
      vitalityMay: { state: 'confirmed', value: 0, boosted: false },
    });
    const vitalityOf = async () => (await loadMareHerd(context)).cards[0]?.vitality;
    expect(await vitalityOf()).toEqual({
      vitality: { state: 'confirmed', value: 0, boosted: false },
      month: 5,
    });

    await saveMareYearly(context, {
      ...base,
      vitalityMay: { value: 0, boosted: false },
      vitalityJuly: { value: 73, boosted: false },
    });
    expect(await vitalityOf()).toEqual({
      vitality: { state: 'confirmed', value: 73, boosted: false },
      month: 7,
    });

    await saveMareYearly(context, {
      ...base,
      vitalityMay: { value: 0, boosted: false },
      vitalityJuly: { value: 100, boosted: false },
    });
    expect(await vitalityOf()).toEqual({
      vitality: { state: 'confirmed', value: 100, boosted: false },
      month: 7,
    });

    await saveMareYearly(context, base);
    expect(await vitalityOf()).toEqual({ vitality: { state: 'pending' }, month: undefined });
    expect(await readRecords(context.database, gameId, 'mareYearly')).toEqual([
      { id: 'id-0005', horseId: mareId, gameYear: 1968 },
    ]);

    const changes = (await readRecords(context.database, gameId, 'events')).filter(
      (event) => event.type === 'mareYearlyChanged',
    );
    expect(changes).toHaveLength(4);
    expect(changes[0]).toEqual({
      id: 'id-0006',
      subjectId: mareId,
      type: 'mareYearlyChanged',
      gameYear: 1968,
      after: { vitalityMay: { state: 'confirmed', value: 0, boosted: false } },
      source: 'user',
      occurredAt: '2026-09-15T00:00:04.000Z',
    });
    expect(changes[1]?.before).toEqual(changes[0]?.after);
    expect(changes[3]?.after).toEqual({});

    await expect(
      saveMareYearly(context, {
        ...base,
        vitalityMay: { value: 101, boosted: false },
        vitalityJuly: { value: undefined, boosted: true },
      }),
    ).rejects.toMatchObject({
      code: 'invalidInput',
      message: '5 月活力必須是 0～100 的整數；7 月活力沒有數值時不能勾選増強中',
    });
  });

  it('[MARE-17] 仔出接受 0～15，超出範圍拒絕；空白與 0 分開', async () => {
    const context = await openContext();
    const { mareId } = await setup(context);
    const base = blankYearly(mareId);
    const kodashiOf = async () => (await loadMareHerd(context)).cards[0]?.kodashi;

    await saveMareYearly(context, { ...base, kodashi: 0 });
    expect(await kodashiOf()).toEqual({ value: 0, gameYear: 1968 });

    await saveMareYearly(context, { ...base, kodashi: 15, breedingYears: 3, breedingCount: 2 });
    expect(await kodashiOf()).toEqual({ value: 15, gameYear: 1968 });

    await expect(
      saveMareYearly(context, { ...base, kodashi: 16, breedingYears: 100, breedingCount: -1 }),
    ).rejects.toMatchObject({
      code: 'invalidInput',
      message: '仔出必須是 0～15 的整數；繁殖年數必須是 0～99 的整數；繁殖頭數必須是 0～99 的整數',
    });

    await saveMareYearly(context, base);
    expect(await kodashiOf()).toBeUndefined();
  });

  it('寫入時在交易內讀出遊戲局與母馬：apply 收到交易內的紀錄並合併更新時間；找不到母馬時不寫入', async () => {
    const context = await openContext();
    const { gameId, mareId } = await setup(context);
    const stored = await getCurrentGame(context);
    if (stored === undefined) {
      throw new Error('找不到遊戲局');
    }
    // 服務在操作開始時讀到的是 1968 年與據點 32；之後其他寫入改了目前遊戲年與據點。
    await context.database.put('games', { ...stored, currentYear: 1970 });
    const mares = await readRecords(context.database, gameId, 'mares');
    await putRecords(
      context.database,
      gameId,
      'mares',
      mares.map((record) => ({ ...record, site: 35 })),
    );

    const seen: { year: number; site: number }[] = [];
    const result = await modifyMare(context.database, {
      gameId,
      mareId,
      touch: TOUCH,
      apply: ({ game, mare }) => {
        seen.push({ year: game.currentYear, site: mare.site });
        return {
          mare: { ...mare, yearPlan: { plan: 'rest', gameYear: game.currentYear } },
          events: [],
        };
      },
    });

    expect(seen).toEqual([{ year: 1970, site: 35 }]);
    expect(result).toMatchObject({ site: 35, yearPlan: { plan: 'rest', gameYear: 1970 } });
    expect(await getCurrentGame(context)).toMatchObject({ currentYear: 1970, ...TOUCH });

    await expect(
      modifyMare(context.database, {
        gameId,
        mareId: 'missing',
        touch: { updatedAt: '2026-09-15T02:00:00.000Z', appVersion: '9.9.9' },
        apply: ({ mare }) => ({ mare, events: [] }),
      }),
    ).rejects.toThrow('找不到繁殖牝馬 missing');
    expect((await getCurrentGame(context))?.updatedAt).toBe(TOUCH.updatedAt);
  });

  it('詳情資料含父母、能力番号、來源備註、階段馬番号、年度資料與歷程（皆新到舊）', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '母馬局', startYear: 1968 });
    const added = await addMarketMare(context, {
      ...STARTER,
      abilityNo: '0x0000',
      sireName: 'ソトノチチ',
      damName: 'ソトノハハ',
      sireSubsystem: 'マンノウォー',
      originNote: 'セール購入',
    });
    const mareId = added.horse.id;
    await putRecords(context.database, game.id, 'mareYearly', [
      { id: 'y1967', horseId: mareId, gameYear: 1967, kodashi: 9 },
      { id: 'y1968', horseId: mareId, gameYear: 1968, breedingYears: 2 },
    ]);

    const detail = await loadMareDetail(context, mareId);

    expect(detail).toMatchObject({
      abilityNo: '0x0000',
      birthYear: 1950,
      sireName: 'ソトノチチ',
      damName: 'ソトノハハ',
      originNote: 'セール購入',
      stageNumbers: [],
      card: { sireSubsystem: 'マンノウォー', kodashi: { value: 9, gameYear: 1967 } },
      currentYearly: { id: 'y1968' },
    });
    expect(detail.yearly.map((record) => record.id)).toEqual(['y1968', 'y1967']);
    expect(detail.history.map((item) => item.type)).toEqual(['mareAdded', 'horseCreated']);
    await expect(loadMareDetail(context, 'missing')).rejects.toMatchObject({
      code: 'invalidInput',
    });
  });
});
