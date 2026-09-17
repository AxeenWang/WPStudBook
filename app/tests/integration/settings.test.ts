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
import { loadGameRuleSettings, updateGameRuleSettings } from '../../src/services/settings.ts';
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
    expect(await loadGameRuleSettings(context)).toEqual({
      retirementAge: 25,
      highAgeReminderAge: 18,
      stallionAgeReminderAge: 26,
      vitalityThreshold: undefined,
    });
    expect((await loadMareHerd(context)).cards[0]?.highAge).toBe(true);

    expect(
      await updateGameRuleSettings(context, {
        retirementAge: 25,
        highAgeReminderAge: 19,
        stallionAgeReminderAge: 26,
        vitalityThreshold: undefined,
      }),
    ).toEqual({
      retirementAge: 25,
      highAgeReminderAge: 19,
      stallionAgeReminderAge: 26,
      vitalityThreshold: undefined,
    });

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
      before: { highAgeReminderAge: 18, stallionAgeReminderAge: 26 },
      after: { highAgeReminderAge: 19, stallionAgeReminderAge: 26 },
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

    await updateGameRuleSettings(context, {
      retirementAge: 25,
      highAgeReminderAge: 18,
      stallionAgeReminderAge: 26,
      vitalityThreshold: 50,
    });

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

    await updateGameRuleSettings(context, {
      retirementAge: 25,
      highAgeReminderAge: 18,
      stallionAgeReminderAge: 26,
      vitalityThreshold: undefined,
    });
    expect((await loadMareHerd(context)).cards.some((item) => item.belowThreshold)).toBe(false);
  });

  it('輸入錯誤或沒有變更時拒絕，不寫入', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '設定局', startYear: 1968 });

    await expect(
      updateGameRuleSettings(context, {
        retirementAge: 25,
        highAgeReminderAge: 0,
        stallionAgeReminderAge: 100,
        vitalityThreshold: 101,
      }),
    ).rejects.toMatchObject({
      code: 'invalidInput',
      message:
        '高齡提醒年齡必須是 1～99 的整數；種牡馬提醒年齡必須是 1～99 的整數；活力建議門檻必須是 0～100 的整數，或留空不使用',
    });
    await expect(
      updateGameRuleSettings(context, {
        retirementAge: 25,
        highAgeReminderAge: undefined,
        stallionAgeReminderAge: 26,
        vitalityThreshold: undefined,
      }),
    ).rejects.toMatchObject({ code: 'invalidInput' });
    await expect(
      updateGameRuleSettings(context, {
        retirementAge: 25,
        highAgeReminderAge: 18,
        stallionAgeReminderAge: 26,
        vitalityThreshold: undefined,
      }),
    ).rejects.toMatchObject({ code: 'invalidInput', message: '設定沒有變更' });
    expect(await readRecords(context.database, game.id, 'events')).toEqual([]);
  });

  it('寫入時使用交易內讀出的設定：操作開始後才寫入的其他設定不會被覆蓋', async () => {
    let injectWrite: (() => void) | undefined;
    const context = await openContext({
      now: () => {
        const inject = injectWrite;
        injectWrite = undefined;
        inject?.();
        return new Date('2026-09-15T00:00:00.000Z');
      },
    });
    const game = await createGame(context, { name: '設定局', startYear: 1968 });
    const stored = await readGameSettings(context.database, game.id);
    // 服務先讀出設定再取時間；在取時間時排入另一個寫入（例如之後子計畫的檢查點保留數設定），
    // 它的交易比服務的寫入交易先建立，所以會先提交。
    let concurrentWrite: Promise<unknown> | undefined;
    injectWrite = () => {
      concurrentWrite = context.database.put('gameSettings', {
        ...stored,
        gameId: game.id,
        checkpointRetention: 7,
      });
    };

    await updateGameRuleSettings(context, {
      retirementAge: 25,
      highAgeReminderAge: 18,
      stallionAgeReminderAge: 26,
      vitalityThreshold: 0,
    });

    expect(concurrentWrite).toBeDefined();
    await concurrentWrite;
    expect(await readGameSettings(context.database, game.id)).toMatchObject({
      checkpointRetention: 7,
      vitalityThreshold: 0,
    });
  });
});
