import { describe, expect, it } from 'vitest';
import { exportBackup, restoreBackupAsNewGame } from '../../src/services/backup.ts';
import { createGame, getCurrentGame } from '../../src/services/games.ts';
import {
  checkOpenFirstLine,
  listLineSlots,
  openFirstLine,
  type OpenFirstLineInput,
} from '../../src/services/lines.ts';
import { listSystemMap, saveSystemMapEntry } from '../../src/services/system-map.ts';
import { countGameRecords } from '../../src/storage/games.ts';
import { findHorsesByName, withHorseNameKeys } from '../../src/storage/horses.ts';
import { insertOpenedLine } from '../../src/storage/lines.ts';
import { putRecords, readRecords } from '../../src/storage/records.ts';
import { stripNameKeys } from '../fixtures/synthetic-game.ts';
import { useServiceContexts } from './helpers.ts';

const EMPTY_SLOTS = [2, 3, 4, 5, 6, 7, 8].map((position) => ({ position }));

const INPUT: OpenFirstLineInput = {
  subsystem: 'ネアルコ系',
  parentSystem: 'ネアルコ',
  color: '#c62828',
  founder: {
    fullName: ' (外)テストシュボバ ',
    abilityNo: '0x0000',
    birthYear: 1960,
    sireName: 'ソトノチチ',
    damName: ' ',
  },
};

describe('開啟第 1 系', () => {
  const openContext = useServiceContexts();

  it('[LINE-01] 新遊戲局的八個系位置都是空白，不帶入任何系名或馬匹', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '八系局', startYear: 1968 });

    expect(await listLineSlots(context)).toEqual([{ position: 1 }, ...EMPTY_SLOTS]);
    const counts = await countGameRecords(context.database, game.id);
    expect([
      counts.lines,
      counts.horses,
      counts.stallionDuties,
      counts.systemMap,
      counts.events,
    ]).toEqual([0, 0, 0, 0, 0]);
  });

  it('以單一交易建立系位置、零代市場種牡馬、現任任期、系統對照表與事件', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '八系局', startYear: 1968 });

    const line = await openFirstLine(context, INPUT);

    expect(line).toEqual({
      id: 'id-0003',
      position: 1,
      subsystem: 'ネアルコ',
      parentSystem: 'ネアルコ',
      color: '#c62828',
      branch: { targetGeneration: 1, openedYear: 1968 },
      establishedGenerations: [],
    });
    expect(stripNameKeys(await readRecords(context.database, game.id, 'horses'))).toEqual([
      {
        id: 'id-0002',
        sex: 'male',
        abilityNo: 0,
        birthYear: 1960,
        fullName: '(外)テストシュボバ',
        baseName: 'テストシュボバ',
        sireName: 'ソトノチチ',
        sireSubsystem: 'ネアルコ',
        stageNumbers: [],
        aliases: [],
      },
    ]);
    expect(
      (await findHorsesByName(context.database, game.id, 'テストシュボバ')).map((h) => h.id),
    ).toEqual(['id-0002']);
    expect(await readRecords(context.database, game.id, 'stallionDuties')).toEqual([
      {
        id: 'id-0004',
        position: 1,
        generation: 0,
        horseId: 'id-0002',
        role: 'current',
        dutyStatus: 'onDuty',
        startYear: 1968,
      },
    ]);
    expect(await listSystemMap(context)).toEqual([
      { id: 'id-0005', subsystem: 'ネアルコ', parentSystem: 'ネアルコ' },
    ]);
    const events = await readRecords(context.database, game.id, 'events');
    expect(events.map((event) => [event.type, event.subjectId])).toEqual([
      ['horseCreated', 'id-0002'],
      ['lineOpened', 'id-0003'],
      ['stallionDutyStarted', 'id-0002'],
      ['systemMapChanged', 'id-0005'],
    ]);
    expect(events.find((event) => event.type === 'lineOpened')?.after).toEqual({
      position: 1,
      subsystem: 'ネアルコ',
      parentSystem: 'ネアルコ',
      founderId: 'id-0002',
    });
    expect(await listLineSlots(context)).toEqual([
      { position: 1, line, founderName: '(外)テストシュボバ' },
      ...EMPTY_SLOTS,
    ]);
    expect((await getCurrentGame(context))?.updatedAt).toBe('2026-09-15T00:00:02.000Z');
  });

  it('系統對照表已有相同親系統時不重複寫入對照表', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '八系局', startYear: 1968 });
    await saveSystemMapEntry(context, { subsystem: 'ネアルコ', parentSystem: 'ネアルコ' });

    await openFirstLine(context, INPUT);

    expect(await listSystemMap(context)).toHaveLength(1);
    const types = (await readRecords(context.database, game.id, 'events')).map((e) => e.type);
    expect(types.filter((type) => type === 'systemMapChanged')).toHaveLength(1);
  });

  it('親系統與對照表不同時需要確認；確認後更新對照表並在事件記錄確認', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '八系局', startYear: 1968 });
    await saveSystemMapEntry(context, { subsystem: 'ネアルコ', parentSystem: 'ファラリス' });

    expect(await checkOpenFirstLine(context, INPUT)).toEqual({
      issues: [],
      warnings: [
        {
          code: 'parentSystemDiffersFromMap',
          message: '系統對照表記載「ネアルコ」的親系統是「ファラリス」，確認後會改為「ネアルコ」',
        },
      ],
    });
    await expect(openFirstLine(context, INPUT)).rejects.toMatchObject({
      code: 'confirmationRequired',
    });
    expect((await countGameRecords(context.database, game.id)).lines).toBe(0);

    await openFirstLine(context, { ...INPUT, acceptedWarnings: ['parentSystemDiffersFromMap'] });

    expect((await listSystemMap(context))[0]?.parentSystem).toBe('ネアルコ');
    const events = await readRecords(context.database, game.id, 'events');
    expect(events.find((event) => event.type === 'lineOpened')?.after).toMatchObject({
      confirmations: ['parentSystemDiffersFromMap'],
    });
    expect(events.filter((event) => event.type === 'systemMapChanged').at(-1)?.before).toEqual({
      subsystem: 'ネアルコ',
      parentSystem: 'ファラリス',
    });
  });

  it('輸入錯誤一次列出，不寫入任何資料', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '八系局', startYear: 1968 });
    const input: OpenFirstLineInput = {
      subsystem: ' ',
      parentSystem: '系',
      color: 'red',
      founder: { fullName: '  ', abilityNo: '0x10000', birthYear: 1969, sireName: '', damName: '' },
    };

    expect((await checkOpenFirstLine(context, input)).issues).toEqual([
      '請輸入目前子系統',
      '請輸入親系統',
      '請選擇代表色',
      '請輸入零代市場種牡馬的馬名',
      '能力番号必須是 0x0000～0xFFFF 的十六進位',
      '出生年必須是 1000～1968 的整數',
    ]);
    await expect(openFirstLine(context, input)).rejects.toMatchObject({ code: 'invalidInput' });
    const counts = await countGameRecords(context.database, game.id);
    expect([counts.lines, counts.horses, counts.stallionDuties, counts.events]).toEqual([
      0, 0, 0, 0,
    ]);
  });

  it('馬名只有 (外)、[地] 前綴時拒絕，不寫入任何資料', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '八系局', startYear: 1968 });
    const input: OpenFirstLineInput = {
      ...INPUT,
      founder: { ...INPUT.founder, fullName: '(外)[地]' },
    };

    expect((await checkOpenFirstLine(context, input)).issues).toEqual([
      '馬名不能只有 (外)、[地] 前綴',
    ]);
    await expect(openFirstLine(context, input)).rejects.toMatchObject({ code: 'invalidInput' });
    const counts = await countGameRecords(context.database, game.id);
    expect([
      counts.lines,
      counts.horses,
      counts.stallionDuties,
      counts.systemMap,
      counts.events,
    ]).toEqual([0, 0, 0, 0, 0]);
  });

  it('代表色不分大小寫，保存為小寫 #rrggbb', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '八系局', startYear: 1968 });
    const input: OpenFirstLineInput = { ...INPUT, color: '#C62828' };

    expect(await checkOpenFirstLine(context, input)).toEqual({ issues: [], warnings: [] });
    const line = await openFirstLine(context, input);

    expect(line.color).toBe('#c62828');
    expect((await readRecords(context.database, game.id, 'lines'))[0]?.color).toBe('#c62828');
  });

  it('寫入交易失敗時整筆退回，遊戲局更新時間不變', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '八系局', startYear: 1968 });
    // sequentialIds 依呼叫順序產生 id：createGame 用掉 id-0001；openFirstLine 依序產生零代種牡馬
    // id-0002、系位置 id-0003、任期 id-0004、系統對照表 id-0005（對照表還沒有這個子系統），
    // 接著第一筆事件 horseCreated 為 id-0006。預先放入同 id 的事件，讓 events.add 以 ConstraintError 中止交易。
    const blocker = {
      id: 'id-0006',
      subjectId: 'game',
      type: 'gameYearChanged',
      gameYear: 1968,
      source: 'user',
      occurredAt: '2026-09-14T00:00:00.000Z',
    };
    await putRecords(context.database, game.id, 'events', [blocker]);

    await expect(openFirstLine(context, INPUT)).rejects.toMatchObject({ name: 'ConstraintError' });

    const counts = await countGameRecords(context.database, game.id);
    expect([counts.lines, counts.horses, counts.stallionDuties, counts.systemMap]).toEqual([
      0, 0, 0, 0,
    ]);
    expect(await readRecords(context.database, game.id, 'events')).toEqual([blocker]);
    expect((await getCurrentGame(context))?.updatedAt).toBe(game.updatedAt);
  });

  it('寫入時在交易內讀出遊戲局再合併更新時間與版本，不覆蓋操作開始後才寫入的最近備份', async () => {
    const context = await openContext();
    // game 相當於服務在操作開始時讀到的舊紀錄；之後才以另一個寫入加上最近備份。
    const game = await createGame(context, { name: '八系局', startYear: 1968 });
    const lastBackup = {
      fileName: 'WPStudBook_八系局_1968年_20260915-000500.json.gz',
      exportedAt: '2026-09-15T00:05:00.000Z',
      sizeBytes: 100,
      recordCount: 0,
    };
    await context.database.put('games', { ...game, lastBackup });

    await insertOpenedLine(context.database, {
      gameId: game.id,
      touch: { updatedAt: '2026-09-15T01:00:00.000Z', appVersion: '9.9.9' },
      line: {
        id: 'line-1',
        position: 1,
        subsystem: 'ネアルコ',
        parentSystem: 'ネアルコ',
        color: '#c62828',
        branch: { targetGeneration: 1, openedYear: 1968 },
        establishedGenerations: [],
      },
      founder: { id: 'horse-1', sex: 'male', stageNumbers: [], aliases: [] },
      duty: {
        id: 'duty-1',
        position: 1,
        generation: 0,
        horseId: 'horse-1',
        role: 'current',
        dutyStatus: 'onDuty',
        startYear: 1968,
      },
      events: [],
    });

    expect(await getCurrentGame(context)).toEqual({
      ...game,
      updatedAt: '2026-09-15T01:00:00.000Z',
      appVersion: '9.9.9',
      lastBackup,
    });
    expect((await countGameRecords(context.database, game.id)).lines).toBe(1);
  });

  it('能力番号與出生年已屬於其他馬匹時拒絕；第 1 系開啟後不能再開啟', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '八系局', startYear: 1968 });
    await context.database.put(
      'horses',
      withHorseNameKeys(game.id, {
        id: 'existing',
        sex: 'female',
        fullName: 'キソンバ',
        abilityNo: 0,
        birthYear: 1960,
        stageNumbers: [],
        aliases: [],
      }),
    );

    expect((await checkOpenFirstLine(context, INPUT)).issues).toEqual([
      '能力番号 0x0000 與出生年 1960 已屬於「キソンバ」',
    ]);
    await openFirstLine(context, { ...INPUT, founder: { ...INPUT.founder, abilityNo: '' } });

    expect((await checkOpenFirstLine(context, INPUT)).issues).toContain('第 1 系已經開啟');
    await expect(openFirstLine(context, INPUT)).rejects.toMatchObject({ code: 'invalidInput' });
    expect((await countGameRecords(context.database, game.id)).lines).toBe(1);
  });

  it('備份還原為新遊戲局後，系位置、零代種牡馬、任期、對照表與事件一致', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '八系局', startYear: 1968 });
    await openFirstLine(context, INPUT);

    const file = await exportBackup(context);
    const restored = await restoreBackupAsNewGame(context, { bytes: file.bytes });

    for (const collection of [
      'lines',
      'horses',
      'stallionDuties',
      'systemMap',
      'events',
    ] as const) {
      expect(
        stripNameKeys(await readRecords(context.database, restored.id, collection)),
        collection,
      ).toEqual(stripNameKeys(await readRecords(context.database, game.id, collection)));
    }
    expect(
      (await findHorsesByName(context.database, restored.id, 'テストシュボバ')).map((h) => h.id),
    ).toEqual(['id-0002']);
    expect((await listLineSlots(context))[0]?.founderName).toBe('(外)テストシュボバ');
  });
});
