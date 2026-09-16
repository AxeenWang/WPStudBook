import { describe, expect, it } from 'vitest';
import { saveBreeding } from '../../src/services/breedings.ts';
import type { ServiceContext } from '../../src/services/context.ts';
import { changeCurrentYear } from '../../src/services/games.ts';
import { addMarketMare, sellMare } from '../../src/services/mares.ts';
import {
  declareRecovery,
  finishRecovery,
  listLineRecoveries,
  loadActiveRecovery,
  setRecoveryParents,
} from '../../src/services/recoveries.ts';
import { assignCurrentStallion } from '../../src/services/stallions.ts';
import { loadTaskBoard } from '../../src/services/tasks.ts';
import { listEventsForSubject } from '../../src/storage/events.ts';
import { useServiceContexts } from './helpers.ts';
import { raiseStud } from './stud-fixture.ts';

/** 第 1 系 1 代種牡馬就緒、1 代母馬群已成立。 */
async function raiseFirstGeneration(context: ServiceContext) {
  const stud = await raiseStud(context);
  await assignCurrentStallion(context, { horseId: stud.elderId, stallionNo: '' });
  return stud;
}

async function addMarket(
  context: ServiceContext,
  position: number,
  generation: number,
  fullName: string,
  origin: 'marketFound' | 'marketRecovery',
) {
  return addMarketMare(context, {
    position,
    generation,
    fullName,
    abilityNo: '',
    birthYear: 1965,
    sireName: '',
    damName: '',
    sireSubsystem: '',
    femaleLine: '',
    noNamedFemaleLine: true,
    site: 32,
    origin,
    originNote: '',
  });
}

const DECLARE = {
  position: 1,
  generation: 1,
  side: 'dam',
  reason: '母馬群全部離圈',
} as const;

describe('斷血補系（需求規格 7.6）', () => {
  const openContext = useServiceContexts();

  it('[LINE-19][LINE-20] 宣告斷血、補入零代市場親馬、完成後連結重新加入的產駒', async () => {
    const context = await openContext();
    const stud = await raiseFirstGeneration(context);

    const declared = await declareRecovery(context, DECLARE);
    expect(declared.status).toBe('inProgress');
    expect(declared.generation).toBe(1);
    expect(declared.gameYear).toBe(1970);
    expect(declared.endYear).toBeUndefined();

    // 第 1 系 1 代斷血：補系產出 2 代。
    expect((await loadActiveRecovery(context))?.targetGeneration).toBe(2);

    const market = await addMarket(context, 1, 1, 'テストホケイ', 'marketRecovery');
    const withParents = await setRecoveryParents(context, {
      recoveryId: declared.id,
      damId: market.mare.id,
    });
    expect(withParents.damId).toBe(market.mare.id);

    await changeCurrentYear(context, 1971);
    const finished = await finishRecovery(context, {
      recoveryId: declared.id,
      foalId: stud.daughterId,
    });
    expect(finished.status).toBe('completed');
    expect(finished.endYear).toBe(1971);
    expect(finished.foalId).toBe(stud.daughterId);

    // 原支線歷史保留。
    expect((await listLineRecoveries(context, 1)).map((item) => item.id)).toEqual([declared.id]);
    const events = await listEventsForSubject(context.database, stud.gameId, declared.id);
    expect(events.map((event) => event.type)).toEqual([
      'recoveryChanged',
      'recoveryChanged',
      'recoveryChanged',
    ]);
  });

  it('[LINE-21] 補系進行中暫停新增下一系與循環換代，結束後解除', async () => {
    const context = await openContext();
    await raiseFirstGeneration(context);
    await addMarket(context, 2, 1, 'テストダイヨウ', 'marketFound');

    const before = await loadTaskBoard(context);
    expect(before.recoveryInProgress).toBe(false);
    expect(before.tasks.find((task) => task.kind === 'advance')?.blockers).toEqual([]);

    const declared = await declareRecovery(context, DECLARE);
    const during = await loadTaskBoard(context);
    expect(during.recoveryInProgress).toBe(true);
    // 推進原系不受影響，建立新系暫停。
    expect(during.tasks.find((task) => task.kind === 'advance')?.blockers).toEqual([]);
    expect(during.tasks.find((task) => task.kind === 'found')?.blockers).toContain(
      'recoveryInProgress',
    );

    await finishRecovery(context, { recoveryId: declared.id, cancelled: true });
    const after = await loadTaskBoard(context);
    expect(after.recoveryInProgress).toBe(false);
    expect(after.tasks.find((task) => task.kind === 'found')?.blockers).not.toContain(
      'recoveryInProgress',
    );
  });

  it('同時只能有一筆進行中的補系', async () => {
    const context = await openContext();
    await raiseFirstGeneration(context);
    await declareRecovery(context, DECLARE);
    await expect(declareRecovery(context, DECLARE)).rejects.toMatchObject({
      code: 'invalidInput',
    });
  });

  it('尚未成立的代數、空白原因與未連結產駒的完成都被拒絕', async () => {
    const context = await openContext();
    await raiseFirstGeneration(context);
    await expect(declareRecovery(context, { ...DECLARE, generation: 5 })).rejects.toMatchObject({
      code: 'invalidInput',
    });
    await expect(declareRecovery(context, { ...DECLARE, reason: '  ' })).rejects.toMatchObject({
      code: 'invalidInput',
    });
    const declared = await declareRecovery(context, DECLARE);
    await expect(finishRecovery(context, { recoveryId: declared.id })).rejects.toMatchObject({
      code: 'invalidInput',
    });
  });
});

describe('待補、缺少種牡馬與等待（需求規格 7.6、7.7、7.8、13.2）', () => {
  const openContext = useServiceContexts();

  it('[LINE-18] 已成立世代還有母馬時不提醒待補', async () => {
    const context = await openContext();
    await raiseStud(context);
    const board = await loadTaskBoard(context);
    const first = board.lines[0];
    // 第 1 系 1 代已成立且有一匹自家母馬。
    expect([first?.latestGeneration, first?.mareCount, first?.needsReplenish]).toEqual([
      1,
      1,
      false,
    ]);
    expect(board.reminders.some((line) => line.includes('母馬群待補'))).toBe(false);
    expect(board.recoveryInProgress).toBe(false);
  });

  it('[LINE-18] 已成立世代的母馬降為 0 時提醒待補，不自動斷血', async () => {
    const context = await openContext();
    const stud = await raiseStud(context);
    // 賣出第 1 系 1 代唯一的自家母馬。
    await sellMare(context, stud.daughterId);

    const board = await loadTaskBoard(context);
    const first = board.lines[0];
    expect([first?.latestGeneration, first?.mareCount, first?.needsReplenish]).toEqual([
      1,
      0,
      true,
    ]);
    expect(board.reminders).toContain('第 1 系 1 代已成立，母馬群待補（0／5），建議補血');
    // 不自動宣告斷血。
    expect(board.recoveryInProgress).toBe(false);
    expect(await loadActiveRecovery(context)).toBeUndefined();
  });

  it('[LINE-23] 缺少現任種牡馬時提醒並暫停相關任務', async () => {
    const context = await openContext();
    await raiseStud(context);
    // 沒有指派 1 代現任：推進原系的種牡馬側缺席。
    const board = await loadTaskBoard(context);
    expect(board.lines[0]?.missing).toContain('noCurrentStallion');
    expect(board.reminders).toContain('第 1 系缺少現任種牡馬，相關任務已暫停');
  });

  it('[LINE-24] 母馬群已推進而種牡馬未就緒時顯示等待年數，不退代', async () => {
    const context = await openContext();
    await raiseStud(context);
    await changeCurrentYear(context, 1972);
    const board = await loadTaskBoard(context);
    const first = board.lines[0];
    // 1 代於 1969 年成立，目前 1972 年。
    expect(first?.latestGeneration).toBe(1);
    expect(first?.waitingYears).toBe(3);
    expect(board.reminders).toContain('第 1 系 1 代母馬群已等待目標種牡馬 3 年');
  });

  it('[LINE-25] 等待期間的自由配種照常保存，不推進代數也不改變看板', async () => {
    const context = await openContext();
    const stud = await raiseStud(context);
    const before = await loadTaskBoard(context);

    await saveBreeding(context, {
      mareId: stud.daughterId,
      gameYear: 1970,
      breedingType: 'free',
      stallionId: undefined,
      stallionName: 'ソトノシュボバ',
      conception: '受胎',
    });

    const after = await loadTaskBoard(context);
    expect(after.lines[0]?.latestGeneration).toBe(before.lines[0]?.latestGeneration);
    expect(after.tasks.map((task) => task.id)).toEqual(before.tasks.map((task) => task.id));
  });
});
