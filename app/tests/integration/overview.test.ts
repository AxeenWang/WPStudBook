import { describe, expect, it } from 'vitest';
import type { Game } from '../../src/domain/game.ts';
import type { ImportBatch } from '../../src/domain/import-batch.ts';
import { correctAnnualWork, loadAnnualWork } from '../../src/services/annual-work.ts';
import {
  exportBackup,
  recordDeliveredBackup,
  restoreBackupAsNewGame,
} from '../../src/services/backup.ts';
import { changeCurrentYear, createGame } from '../../src/services/games.ts';
import { addMarketMare, type MarketMareInput } from '../../src/services/mares.ts';
import { backupReminders, loadOverviewReminders } from '../../src/services/reminders.ts';
import { updateGameRuleSettings } from '../../src/services/settings.ts';
import { saveSystemMapEntry } from '../../src/services/system-map.ts';
import { listEventsOfType } from '../../src/storage/events.ts';
import { readGameSettings } from '../../src/storage/games.ts';
import { putRecords } from '../../src/storage/records.ts';
import { useServiceContexts } from './helpers.ts';

const MARE: MarketMareInput = {
  position: 1,
  generation: 0,
  fullName: 'テストヒンバ',
  abilityNo: '',
  birthYear: 1944,
  sireName: '',
  damName: '',
  sireSubsystem: 'ネアルコ',
  femaleLine: '',
  noNamedFemaleLine: false,
  site: 32,
  origin: 'marketFound',
  originNote: '',
};

function batch(overrides: Partial<ImportBatch>): ImportBatch {
  return {
    id: 'i-1',
    type: 'aprFoals',
    gameYear: 1968,
    timing: { month: 4, week: 1 },
    fileName: '1968年 4月1週_幼駒誕生.txt',
    sha256: 'a'.repeat(64),
    summary: { apply: 2, skip: 0, review: 0, warn: 0, error: 0 },
    appliedAt: '2026-09-15T00:00:10.000Z',
    ...overrides,
  };
}

describe('總覽的年度工作清單與提醒區（需求規格 13.2）', () => {
  const open = useServiceContexts();

  it('[UI-03] 年度工作清單依匯入紀錄標示完成、帶出摘要，並可人工更正', async () => {
    const context = await open();
    const game = await createGame(context, { name: '總覽局', startYear: 1968 });
    await putRecords(context.database, game.id, 'imports', [{ ...batch({}) }]);

    let work = await loadAnnualWork(context);
    expect(work.items.map((item) => [item.type, item.done, item.corrected])).toEqual([
      ['jan2yo', false, false],
      ['aprFoals', true, false],
      ['mayMares', false, false],
      ['mayStallions', false, false],
      ['julMares', false, false],
    ]);
    expect(work.items[1]?.batch?.summary.apply).toBe(2);

    // 那一年不必匯入一月總表：人工標示完成。
    work = await correctAnnualWork(context, { type: 'jan2yo', done: true });
    expect(work.items[0]).toMatchObject({ done: true, importedDone: false, corrected: true });
    // 匯入過但要重做：人工標示未完成。
    work = await correctAnnualWork(context, { type: 'aprFoals', done: false });
    expect(work.items[1]).toMatchObject({ done: false, importedDone: true, corrected: true });
    expect((await readGameSettings(context.database, game.id))?.annualWorkCorrections).toEqual([
      { gameYear: 1968, type: 'jan2yo', done: true },
      { gameYear: 1968, type: 'aprFoals', done: false },
    ]);

    // 更正回與匯入紀錄相同的狀態就刪掉更正。
    await correctAnnualWork(context, { type: 'aprFoals', done: true });
    await correctAnnualWork(context, { type: 'jan2yo', done: false });
    expect(await readGameSettings(context.database, game.id)).not.toHaveProperty(
      'annualWorkCorrections',
    );
    await expect(correctAnnualWork(context, { type: 'jan2yo', done: false })).rejects.toThrow(
      '沒有變更',
    );
    await expect(correctAnnualWork(context, { type: 'octWorldMares', done: true })).rejects.toThrow(
      '不在年度工作清單',
    );

    const events = await listEventsOfType(context.database, game.id, 'annualWorkCorrected');
    expect(events.map((event) => [event.before, event.after])).toEqual([
      [
        { type: 'jan2yo', done: false },
        { type: 'jan2yo', done: true },
      ],
      [
        { type: 'aprFoals', done: true },
        { type: 'aprFoals', done: false },
      ],
      [
        { type: 'aprFoals', done: false },
        { type: 'aprFoals', done: true },
      ],
      [
        { type: 'jan2yo', done: true },
        { type: 'jan2yo', done: false },
      ],
    ]);
  });

  it('[UI-03] 人工更正只影響那一年；改提醒設定不會清掉更正；備份還原後保留', async () => {
    const context = await open();
    const game = await createGame(context, { name: '更正局', startYear: 1968 });
    await correctAnnualWork(context, { type: 'mayMares', done: true });
    await updateGameRuleSettings(context, {
      retirementAge: 24,
      highAgeReminderAge: 18,
      stallionAgeReminderAge: 26,
      vitalityThreshold: undefined,
    });
    expect((await readGameSettings(context.database, game.id))?.annualWorkCorrections).toHaveLength(
      1,
    );

    // 還原後切換到新遊戲局，之後的操作都在還原局上。
    const file = await exportBackup(context);
    const restored = await restoreBackupAsNewGame(context, { bytes: file.bytes, name: '還原局' });
    expect((await readGameSettings(context.database, restored.id))?.annualWorkCorrections).toEqual([
      { gameYear: 1968, type: 'mayMares', done: true },
    ]);
    expect(
      (await loadAnnualWork(context)).items.find((item) => item.type === 'mayMares')?.done,
    ).toBe(true);

    await changeCurrentYear(context, 1969);
    const work = await loadAnnualWork(context);
    expect(work.items.find((item) => item.type === 'mayMares')?.done).toBe(false);
  });

  it('[UI-06] 母馬高齡、最後配種年齡與定年、對照表待補、備份都集中到提醒區', async () => {
    const context = await open();
    await createGame(context, { name: '提醒局', startYear: 1968 });
    // 1968 年 24 歲：定年 25 的前一年，也超過高齡提醒年齡 18。
    await addMarketMare(context, MARE);

    let reminders = await loadOverviewReminders(context);
    expect(reminders.mares).toEqual([
      '母馬「テストヒンバ」（24 歲）：最後值得配種的年齡、達高齡提醒年齡，產駒素質可能下降，可考慮出售',
    ]);
    expect(reminders.systemMap).toEqual([
      '系統對照表待補：ネアルコ（未登錄的子系統會讓循環期的活血預估標為資料不足）',
    ]);
    expect(reminders.backup).toEqual([
      '這一局還沒有匯出過備份；資料只存在目前瀏覽器，請到資料管理匯出備份',
    ]);

    await saveSystemMapEntry(context, { subsystem: 'ネアルコ', parentSystem: 'ファラリス' });
    await recordDeliveredBackup(context, await exportBackup(context));
    reminders = await loadOverviewReminders(context);
    expect(reminders.systemMap).toEqual([]);
    expect(reminders.backup).toEqual([]);

    await changeCurrentYear(context, 1969);
    reminders = await loadOverviewReminders(context);
    expect(reminders.mares).toEqual([
      '母馬「テストヒンバ」（25 歲）：已達定年，不列入任務、達高齡提醒年齡，產駒素質可能下降，可考慮出售',
    ]);
  });

  it('[UI-06] 年度總表匯入晚於最近備份時再提醒備份；候選 TXT 不算', () => {
    const game: Game = {
      id: 'g',
      name: '備份局',
      startYear: 1968,
      currentYear: 1968,
      createdAt: '2026-09-15T00:00:00.000Z',
      updatedAt: '2026-09-15T00:00:00.000Z',
      appVersion: '0.0.0-test',
      lastBackup: {
        fileName: 'backup.json.gz',
        exportedAt: '2026-09-15T00:00:05.000Z',
        sizeBytes: 100,
        recordCount: 1,
      },
    };
    expect(backupReminders(game, [])).toEqual([]);
    expect(
      backupReminders(game, [
        batch({ type: 'candidateFile', appliedAt: '2026-09-15T00:00:09.000Z' }),
      ]),
    ).toEqual([]);
    expect(backupReminders(game, [batch({})])).toEqual([
      '匯入「1968年 4月1週_幼駒誕生.txt」之後還沒有備份，請到資料管理匯出備份',
    ]);
  });
});
