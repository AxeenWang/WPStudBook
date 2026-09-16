import { describe, expect, it } from 'vitest';
import { saveBreeding } from '../../src/services/breedings.ts';
import type { ServiceContext } from '../../src/services/context.ts';
import {
  checkOpenLine,
  checkUpdateLineSystems,
  listOpenableLines,
  loadParentSystemStatus,
  openLine,
  updateLineSystems,
} from '../../src/services/lines.ts';
import { addMarketMare } from '../../src/services/mares.ts';
import { assignCurrentStallion } from '../../src/services/stallions.ts';
import { checkTaskBreeding, loadTaskBoard } from '../../src/services/tasks.ts';
import { checkBreedingPedigree } from '../../src/services/pedigree-check.ts';
import { pedigreeWarningCodes } from '../../src/domain/pedigree-check.ts';
import { getBreeding, listBreedings } from '../../src/storage/breedings.ts';
import { listEventsForSubject } from '../../src/storage/events.ts';
import { listLines } from '../../src/storage/lines.ts';
import { useServiceContexts } from './helpers.ts';
import { addStarter, raiseStud } from './stud-fixture.ts';

/** 第 1 系 1 代種牡馬就緒後，看板進入產出 2 代的分支。 */
async function raiseSecondGeneration(context: ServiceContext) {
  const stud = await raiseStud(context);
  await assignCurrentStallion(context, { horseId: stud.elderId, stallionNo: '' });
  return stud;
}

async function addSubstitute(
  context: ServiceContext,
  position: number,
  generation: number,
  fullName: string,
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
    origin: 'marketFound',
    originNote: '',
  });
}

const NEW_LINE = {
  position: 2,
  subsystem: 'ヘロド',
  parentSystem: 'ヘロド',
  color: '#ef6c00',
  founder: { fullName: 'テストシンケイ', abilityNo: '', sireName: '', damName: '' },
} as const;

describe('任務看板（需求規格 7.3、7.4、13.2）', () => {
  const openContext = useServiceContexts();

  it('[LINE-09] 產出 2 代時看板同時列出推進原系與建立新系', async () => {
    const context = await openContext();
    await raiseSecondGeneration(context);
    await addSubstitute(context, 2, 1, 'テストダイヨウ');

    const board = await loadTaskBoard(context);
    expect(
      board.tasks.map((task) => [
        task.kind,
        task.sire.position,
        task.sire.generation,
        task.dam.position,
        task.dam.generation,
        task.target.position,
        task.target.generation,
      ]),
    ).toEqual([
      ['advance', 1, 1, 2, 1, 1, 2],
      ['found', 2, 0, 1, 1, 2, 2],
    ]);
    expect(board.tasks[0]?.blockers).toEqual([]);
    expect(board.tasks[0]?.sireName).toBe('オオトリモナーコス1969');
    expect(board.tasks[1]?.blockers).toEqual(['lineNotOpened']);
  });

  it('[LINE-02] 只能開啟規則指定的位置', async () => {
    const context = await openContext();
    await raiseSecondGeneration(context);

    expect((await listOpenableLines(context)).map((item) => item.position)).toEqual([2]);
    expect((await checkOpenLine(context, { ...NEW_LINE, position: 3 })).issues).toEqual([
      '第 3 系不是規則指定的位置，目前只能開啟第 2 系',
    ]);
    await expect(openLine(context, { ...NEW_LINE, position: 3 })).rejects.toMatchObject({
      code: 'invalidInput',
    });
    const line = await openLine(context, NEW_LINE);
    expect(line.position).toBe(2);
    // 建立新系的產出代數由規則決定，不是開啟的年份。
    expect(line.branch.targetGeneration).toBe(2);
  });

  it('[LINE-02] 代表色自動分配第一個未使用的顏色，可以改選', async () => {
    const context = await openContext();
    await raiseSecondGeneration(context);
    const [openable] = await listOpenableLines(context);
    // 第 1 系已用紅色，第 2 系建議橙色。
    expect(openable?.suggestedColor).toBe('#ef6c00');
    const line = await openLine(context, { ...NEW_LINE, color: '#1565c0' });
    expect(line.color).toBe('#1565c0');
  });

  it('[LINE-03] 新系親系統與既有系重複時警告並確認', async () => {
    const context = await openContext();
    await raiseSecondGeneration(context);
    const duplicated = { ...NEW_LINE, subsystem: 'ハイペリオン', parentSystem: 'ネアルコ' };

    const check = await checkOpenLine(context, duplicated);
    expect(check.issues).toEqual([]);
    expect(check.warnings.map((warning) => warning.code)).toEqual(['parentSystemDuplicated']);
    await expect(openLine(context, duplicated)).rejects.toMatchObject({
      code: 'confirmationRequired',
    });

    const line = await openLine(context, {
      ...duplicated,
      acceptedWarnings: ['parentSystemDuplicated'],
    });
    expect(line.parentSystem).toBe('ネアルコ');
  });

  it('[LINE-04] 親系統種類數與重複的系；升格後重複解除', async () => {
    const context = await openContext();
    await raiseSecondGeneration(context);
    await openLine(context, {
      ...NEW_LINE,
      subsystem: 'ハイペリオン',
      parentSystem: 'ネアルコ',
      acceptedWarnings: ['parentSystemDuplicated'],
    });

    expect(await loadParentSystemStatus(context)).toEqual({
      parentSystemCount: 1,
      duplicates: [{ parentSystem: 'ネアルコ', positions: [1, 2] }],
    });

    // 對照表升格：把「ハイペリオン」的親系統改成自己，確認後兩邊一起更新。
    await updateLineSystems(context, {
      position: 2,
      subsystem: 'ハイペリオン',
      parentSystem: 'ハイペリオン',
      acceptedWarnings: ['parentSystemDiffersFromMap'],
    });
    expect(await loadParentSystemStatus(context)).toEqual({
      parentSystemCount: 2,
      duplicates: [],
    });
    expect((await loadTaskBoard(context)).parentSystem.duplicates).toEqual([]);
  });

  it('[LINE-06] 更新子系統名稱時位置、代數與任務不變，歷程保存舊名與年份', async () => {
    const context = await openContext();
    const stud = await raiseSecondGeneration(context);
    await addSubstitute(context, 2, 1, 'テストダイヨウ');
    const before = await loadTaskBoard(context);

    const updated = await updateLineSystems(context, {
      position: 1,
      subsystem: 'ネアルコ二世',
      parentSystem: 'ネアルコ',
    });
    expect(updated.position).toBe(1);
    expect(updated.subsystem).toBe('ネアルコ二世');
    // 分支與已成立世代不受改名影響。
    const [stored] = await listLines(context.database, stud.gameId);
    expect(stored?.branch).toEqual({ targetGeneration: 1, openedYear: 1968 });
    expect(stored?.establishedGenerations).toEqual([{ generation: 1, gameYear: 1969 }]);

    const after = await loadTaskBoard(context);
    expect(after.tasks.map((task) => task.id)).toEqual(before.tasks.map((task) => task.id));
    expect(after.lines[0]?.latestGeneration).toBe(before.lines[0]?.latestGeneration);
    expect(after.lines[0]?.subsystem).toBe('ネアルコ二世');

    const events = await listEventsForSubject(context.database, stud.gameId, updated.id);
    const renamed = events.find((event) => event.type === 'lineSystemsChanged');
    expect(renamed?.before).toEqual({ subsystem: 'ネアルコ', parentSystem: 'ネアルコ' });
    expect(renamed?.after).toEqual({ subsystem: 'ネアルコ二世', parentSystem: 'ネアルコ' });
    expect(renamed?.gameYear).toBe(1970);
  });

  it('[LINE-06] 系統名稱沒有變更時拒絕', async () => {
    const context = await openContext();
    await raiseSecondGeneration(context);
    const input = { position: 1, subsystem: 'ネアルコ', parentSystem: 'ネアルコ' } as const;
    expect((await checkUpdateLineSystems(context, input)).issues).toEqual(['系統名稱沒有變更']);
    await expect(updateLineSystems(context, input)).rejects.toMatchObject({
      code: 'invalidInput',
    });
  });
});

describe('指定配種的規則快照（需求規格 7.4）', () => {
  const openContext = useServiceContexts();

  it('依任務登記的指定配種保存規則快照', async () => {
    const context = await openContext();
    const stud = await raiseSecondGeneration(context);
    const substitute = await addSubstitute(context, 2, 1, 'テストダイヨウ');
    const board = await loadTaskBoard(context);
    const task = board.tasks[0];
    expect(task?.mares.map((mare) => mare.id)).toEqual([substitute.mare.id]);

    await saveBreeding(context, {
      mareId: substitute.mare.id,
      gameYear: 1970,
      breedingType: 'designated',
      stallionId: stud.elderId,
      stallionName: '',
      conception: '受胎',
      taskId: task?.id,
    });

    const record = await getBreeding(context.database, stud.gameId, substitute.mare.id, 1970);
    expect(record?.ruleSnapshot).toEqual({
      taskId: task?.id,
      phase: 'building',
      kind: 'advance',
      pairDistance: 1,
      sire: { position: 1, generation: 1 },
      dam: { position: 2, generation: 1 },
      target: { position: 1, generation: 2 },
    });
    expect((await loadTaskBoard(context)).tasks[0]?.mares[0]?.recorded).toBe(true);
  });

  it('[LINE-16] 規則的輸入改變時看板重算，已保存的快照不變', async () => {
    const context = await openContext();
    const stud = await raiseSecondGeneration(context);
    const substitute = await addSubstitute(context, 2, 1, 'テストダイヨウ');
    const board = await loadTaskBoard(context);
    await saveBreeding(context, {
      mareId: substitute.mare.id,
      gameYear: 1970,
      breedingType: 'designated',
      stallionId: stud.elderId,
      stallionName: '',
      conception: '受胎',
      taskId: board.tasks[0]?.id,
    });

    expect(board.tasks.find((task) => task.kind === 'found')?.blockers).toEqual(['lineNotOpened']);
    // 開啟第 2 系後「建立新系」的缺項解除，看板重算；已執行的快照不動。
    await openLine(context, NEW_LINE);
    const after = await loadTaskBoard(context);
    expect(after.tasks.find((task) => task.kind === 'found')?.blockers).toEqual([]);
    const records = await listBreedings(context.database, stud.gameId);
    const record = records.find((item) => item.mareId === substitute.mare.id);
    expect(record?.ruleSnapshot?.target).toEqual({ position: 1, generation: 2 });
  });

  it('自由配種不能帶任務代號', async () => {
    const context = await openContext();
    await raiseSecondGeneration(context);
    const substitute = await addSubstitute(context, 2, 1, 'テストダイヨウ');
    const board = await loadTaskBoard(context);
    await expect(
      saveBreeding(context, {
        mareId: substitute.mare.id,
        gameYear: 1970,
        breedingType: 'free',
        stallionId: undefined,
        stallionName: 'ソトノシュボバ',
        conception: '受胎',
        taskId: board.tasks[0]?.id,
      }),
    ).rejects.toMatchObject({ code: 'invalidInput' });
  });

  it('任務已不在看板上時拒絕登記', async () => {
    const context = await openContext();
    const stud = await raiseSecondGeneration(context);
    const substitute = await addSubstitute(context, 2, 1, 'テストダイヨウ');
    await expect(
      saveBreeding(context, {
        mareId: substitute.mare.id,
        gameYear: 1970,
        breedingType: 'designated',
        stallionId: stud.elderId,
        stallionName: '',
        conception: '受胎',
        taskId: 'advance:s9-9:d9-9:t9-9',
      }),
    ).rejects.toMatchObject({ code: 'invalidInput' });
  });

  it('現任在本年度正式接任時任務列為高優先待辦（需求規格 7.7）', async () => {
    const context = await openContext();
    await raiseSecondGeneration(context);
    await addSubstitute(context, 2, 1, 'テストダイヨウ');
    const board = await loadTaskBoard(context);
    expect(board.tasks[0]?.highPriority).toBe(true);
  });

  it('八系卡片顯示最新代數與母馬群數量（需求規格 13.2）', async () => {
    const context = await openContext();
    await raiseSecondGeneration(context);
    await addStarter(context, 'テストヨビ');
    const board = await loadTaskBoard(context);
    const first = board.lines[0];
    expect(first?.opened).toBe(true);
    expect(first?.subsystem).toBe('ネアルコ');
    expect(first?.latestGeneration).toBe(1);
    expect([first?.mareCount, first?.mareTarget]).toEqual([1, 5]);
    expect(board.lines[1]?.opened).toBe(false);
  });
});

describe('系與代數檢查與血統檢查（需求規格 10.2、10.3）', () => {
  const openContext = useServiceContexts();

  it('[PED-07][LINE-27] 母馬的代數與規則不符時阻止，並指出正確的代數', async () => {
    const context = await openContext();
    const stud = await raiseSecondGeneration(context);
    const board = await loadTaskBoard(context);
    const found = board.tasks.find((task) => task.kind === 'found');
    // 建立新系要用第 1 系 1 代母馬；起點母馬群是 0 代。
    const starter = await addStarter(context, 'テストキテンヨウ');

    const check = await checkTaskBreeding(context, {
      taskId: found?.id ?? '',
      mareId: starter,
      stallionId: stud.founderId,
    });
    // 第 2 系還沒開啟，所以種牡馬側也不符；兩邊都逐一指出正確的系與代數。
    expect(check.issues).toEqual([
      '種牡馬的系別與規則不符：這筆任務要用第 2 系 0 代的種牡馬（選到的是第 1 系 0 代）',
      '母馬的代數與規則不符：這筆任務要用第 1 系 1 代的母馬（選到的是第 1 系 0 代）',
    ]);

    await expect(
      saveBreeding(context, {
        mareId: starter,
        gameYear: 1970,
        breedingType: 'designated',
        stallionId: stud.founderId,
        stallionName: '',
        conception: '受胎',
        taskId: found?.id,
      }),
    ).rejects.toMatchObject({ code: 'invalidInput' });
  });

  it('[PED-06][LINE-34] 母馬配自己的父親時因系與代數不符而阻止', async () => {
    const context = await openContext();
    const stud = await raiseSecondGeneration(context);
    const board = await loadTaskBoard(context);
    const advance = board.tasks.find((task) => task.kind === 'advance');
    // テストムスメ 是第 1 系 1 代自家母馬；推進原系要用替代第 2 系的母馬。
    const check = await checkTaskBreeding(context, {
      taskId: advance?.id ?? '',
      mareId: stud.daughterId,
      stallionId: stud.elderId,
    });
    expect(check.issues).toEqual([
      '母馬的系別與規則不符：這筆任務要用第 2 系 1 代的母馬（選到的是第 1 系 1 代）',
    ]);
  });

  it('[PED-06] 種牡馬的系與代數不符時阻止，並指出正確的種牡馬', async () => {
    const context = await openContext();
    const stud = await raiseSecondGeneration(context);
    await addSubstitute(context, 2, 1, 'テストダイヨウ');
    const board = await loadTaskBoard(context);
    const advance = board.tasks.find((task) => task.kind === 'advance');
    const mareId = advance?.mares[0]?.id ?? '';

    // 推進原系要用第 1 系 1 代現任，這裡改用零代的建系種牡馬。
    const check = await checkTaskBreeding(context, {
      taskId: advance?.id ?? '',
      mareId,
      stallionId: stud.founderId,
    });
    expect(check.issues).toEqual([
      '種牡馬的代數與規則不符：這筆任務要用第 1 系 1 代的種牡馬（選到的是第 1 系 0 代）',
    ]);
  });

  it('沒有系與代數的種牡馬也阻止', async () => {
    const context = await openContext();
    await raiseSecondGeneration(context);
    await addSubstitute(context, 2, 1, 'テストダイヨウ');
    const board = await loadTaskBoard(context);
    const advance = board.tasks.find((task) => task.kind === 'advance');
    const check = await checkTaskBreeding(context, {
      taskId: advance?.id ?? '',
      mareId: advance?.mares[0]?.id ?? '',
      stallionId: undefined,
    });
    expect(check.issues).toEqual(['種牡馬沒有系與代數，這筆任務要用第 1 系 1 代的種牡馬']);
  });

  it('[PED-01] 建系期的指定配種不計算活血，也不因市場馬血統不完整警告', async () => {
    const context = await openContext();
    const stud = await raiseSecondGeneration(context);
    const substitute = await addSubstitute(context, 2, 1, 'テストダイヨウ');
    const board = await loadTaskBoard(context);
    const advance = board.tasks.find((task) => task.kind === 'advance');

    const check = await checkTaskBreeding(context, {
      taskId: advance?.id ?? '',
      mareId: substitute.mare.id,
      stallionId: stud.elderId,
    });
    expect(check.issues).toEqual([]);
    expect(check.warnings).toEqual([]);
    expect(check.pedigreeCheck.evaluated).toBe(false);

    await saveBreeding(context, {
      mareId: substitute.mare.id,
      gameYear: 1970,
      breedingType: 'designated',
      stallionId: stud.elderId,
      stallionName: '',
      conception: '受胎',
      taskId: advance?.id,
    });
    const record = await getBreeding(context.database, stud.gameId, substitute.mare.id, 1970);
    expect(record?.ruleSnapshot).toBeDefined();
    expect(record?.pedigreeCheck).toBeUndefined();
    expect(record?.confirmations).toBeUndefined();
  });
});

describe('循環期的血統檢查（需求規格 10.2）', () => {
  const openContext = useServiceContexts();

  it('[PED-11] 資料不足只因建系期的市場馬時只提示，不要求確認', async () => {
    const context = await openContext();
    const stud = await raiseSecondGeneration(context);
    const substitute = await addSubstitute(context, 2, 1, 'テストダイヨウ');

    const check = await checkBreedingPedigree(context, {
      phase: 'cycling',
      sireId: stud.elderId,
      damId: substitute.mare.id,
    });
    expect(check.evaluated).toBe(true);
    expect(check.insufficientPedigree).toBe(true);
    expect(check.gapsOnlyFromBuildingPhase).toBe(true);
    expect(pedigreeWarningCodes(check)).toEqual(['activationBelowFull']);
  });

  it('[PED-05] 補血補入的市場母馬造成的資料不足要確認', async () => {
    const context = await openContext();
    const stud = await raiseSecondGeneration(context);
    // 替代第 2 系 5 代是循環期的補血，不是建系期的市場馬。
    const replenish = await addSubstitute(context, 2, 5, 'テストホケツ');

    const check = await checkBreedingPedigree(context, {
      phase: 'cycling',
      sireId: stud.elderId,
      damId: replenish.mare.id,
    });
    expect(check.gapsOnlyFromBuildingPhase).toBe(false);
    expect(pedigreeWarningCodes(check)).toContain('insufficientPedigree');
  });

  it('[PED-04] 同一匹馬出現在 4 代內時列為重複祖先', async () => {
    const context = await openContext();
    const stud = await raiseSecondGeneration(context);
    // テストムスメ 與 哥哥 同父：父馬在兩邊的祖先中各出現一次。
    const check = await checkBreedingPedigree(context, {
      phase: 'cycling',
      sireId: stud.elderId,
      damId: stud.daughterId,
    });
    expect(check.duplicateAncestors).toContain(stud.founderId);
    expect(pedigreeWarningCodes(check)).toContain('duplicateAncestors');
  });
});
