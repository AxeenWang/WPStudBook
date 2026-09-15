import { describe, expect, it } from 'vitest';
import { createGame } from '../../src/services/games.ts';
import { sortMareCards } from '../../src/services/mare-list.ts';
import {
  addMarketMare,
  loadMareHerd,
  saveMareYearly,
  setYearPlan,
  type MarketMareInput,
} from '../../src/services/mares.ts';
import { loadReminderSettings, updateReminderSettings } from '../../src/services/settings.ts';
import { readGameSettings } from '../../src/storage/games.ts';
import { readRecords } from '../../src/storage/records.ts';
import { useServiceContexts } from './helpers.ts';

const MARE: MarketMareInput = {
  position: 1,
  generation: 0,
  fullName: 'テストヒンバ',
  abilityNo: '',
  birthYear: 1950,
  sireName: '',
  damName: '',
  sireSubsystem: '',
  femaleLine: '',
  noNamedFemaleLine: false,
  site: 32,
  origin: 'marketFound',
  originNote: '',
};

const BLANK = { value: undefined, boosted: false };

describe('遊戲局提醒設定', () => {
  const openContext = useServiceContexts();

  it('[MARE-25] 修改高齡提醒年齡後，卡片依新年齡判斷提醒；事件保存前後值，其他設定不變', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '設定局', startYear: 1968 });
    await addMarketMare(context, MARE);
    expect(await loadReminderSettings(context)).toEqual({
      highAgeReminderAge: 18,
      vitalityThreshold: undefined,
    });
    expect((await loadMareHerd(context)).cards[0]?.highAge).toBe(true);

    expect(
      await updateReminderSettings(context, {
        highAgeReminderAge: 19,
        vitalityThreshold: undefined,
      }),
    ).toEqual({ highAgeReminderAge: 19, vitalityThreshold: undefined });

    expect((await loadMareHerd(context)).cards[0]?.highAge).toBe(false);
    expect(await readGameSettings(context.database, game.id)).toEqual({
      retirementAge: 25,
      highAgeReminderAge: 19,
      stallionAgeReminderAge: 26,
      checkpointRetention: 15,
      display: {},
    });
    const events = await readRecords(context.database, game.id, 'events');
    expect(events.find((event) => event.type === 'settingsChanged')).toMatchObject({
      subjectId: 'game',
      gameYear: 1968,
      before: { highAgeReminderAge: 18 },
      after: { highAgeReminderAge: 19 },
    });
  });

  it('[MARE-16] 活力建議門檻只改變提示與排序，不阻止今年計畫；清除門檻後提示消失', async () => {
    const context = await openContext();
    await createGame(context, { name: '設定局', startYear: 1968 });
    const values = [
      ['テストロクジュウ', { value: 80, boosted: false }],
      ['テストヨンジュウ', { value: 40, boosted: false }],
      ['テストゾウキョウ', { value: 13, boosted: true }],
    ] as const;
    for (const [fullName, vitality] of values) {
      const added = await addMarketMare(context, { ...MARE, fullName, birthYear: 1960 });
      await saveMareYearly(context, {
        mareId: added.horse.id,
        vitalityMay: vitality,
        vitalityJuly: BLANK,
        kodashi: undefined,
        breedingYears: undefined,
        breedingCount: undefined,
      });
    }
    const namesInOrder = async () => {
      const herd = await loadMareHerd(context);
      return sortMareCards(herd.cards, herd.vitalityThreshold).map((item) => item.name);
    };
    expect(await namesInOrder()).toEqual([
      'テストロクジュウ',
      'テストヨンジュウ',
      'テストゾウキョウ',
    ]);

    await updateReminderSettings(context, { highAgeReminderAge: 18, vitalityThreshold: 50 });

    expect(await namesInOrder()).toEqual([
      'テストロクジュウ',
      'テストゾウキョウ',
      'テストヨンジュウ',
    ]);
    const low = (await loadMareHerd(context)).cards.find(
      (item) => item.name === 'テストヨンジュウ',
    );
    if (low === undefined) {
      throw new Error('找不到活力 40 的母馬');
    }
    expect(low.belowThreshold).toBe(true);
    const planned = await setYearPlan(context, { mareId: low.id, plan: 'designated' });
    expect(planned.yearPlan).toEqual({ plan: 'designated', gameYear: 1968 });

    await updateReminderSettings(context, { highAgeReminderAge: 18, vitalityThreshold: undefined });
    expect((await loadMareHerd(context)).cards.some((item) => item.belowThreshold)).toBe(false);
  });

  it('輸入錯誤或沒有變更時拒絕，不寫入；寫入時保留交易內讀出的其他設定', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '設定局', startYear: 1968 });

    await expect(
      updateReminderSettings(context, { highAgeReminderAge: 0, vitalityThreshold: 101 }),
    ).rejects.toMatchObject({
      code: 'invalidInput',
      message: '高齡提醒年齡必須是 1～99 的整數；活力建議門檻必須是 0～100 的整數，或留空不使用',
    });
    await expect(
      updateReminderSettings(context, {
        highAgeReminderAge: undefined,
        vitalityThreshold: undefined,
      }),
    ).rejects.toMatchObject({ code: 'invalidInput' });
    await expect(
      updateReminderSettings(context, { highAgeReminderAge: 18, vitalityThreshold: undefined }),
    ).rejects.toMatchObject({ code: 'invalidInput', message: '設定沒有變更' });
    expect(await readRecords(context.database, game.id, 'events')).toEqual([]);

    // 其他寫入（例如之後子計畫的檢查點保留數設定）在操作開始後改了設定。
    const stored = await readGameSettings(context.database, game.id);
    await context.database.put('gameSettings', {
      ...stored,
      gameId: game.id,
      checkpointRetention: 7,
    });
    await updateReminderSettings(context, { highAgeReminderAge: 18, vitalityThreshold: 0 });
    expect(await readGameSettings(context.database, game.id)).toMatchObject({
      checkpointRetention: 7,
      vitalityThreshold: 0,
    });
  });
});
