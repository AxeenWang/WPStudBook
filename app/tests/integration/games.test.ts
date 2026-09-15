import { describe, expect, it, vi } from 'vitest';
import type { HistoryEvent } from '../../src/domain/history-event.ts';
import { loadAppStatus } from '../../src/services/app-status.ts';
import { ServiceError } from '../../src/services/errors.ts';
import { requestPersistentStorage } from '../../src/services/context.ts';
import {
  changeCurrentYear,
  createGame,
  deleteAllData,
  deleteGame,
  getCurrentGame,
  listAllGames,
  previewDeleteAll,
  previewGameDeletion,
  previewYearChange,
  switchGame,
} from '../../src/services/games.ts';
import { countGameRecords, readGameSettings, updateCurrentYear } from '../../src/storage/games.ts';
import { putRecords, readRecords } from '../../src/storage/records.ts';
import { ALL_STORES } from '../../src/storage/schema.ts';
import { useServiceContexts } from './helpers.ts';

const YEAR_TOUCH = { updatedAt: '2026-09-15T01:00:00.000Z', appVersion: '9.9.9' };

const YEAR_EVENT: HistoryEvent = {
  id: 'event-1',
  subjectId: 'game',
  type: 'gameYearChanged',
  gameYear: 1969,
  before: { currentYear: 1968 },
  after: { currentYear: 1969 },
  source: 'user',
  occurredAt: YEAR_TOUCH.updatedAt,
};

const DEFAULT_SETTINGS = {
  retirementAge: 25,
  highAgeReminderAge: 18,
  stallionAgeReminderAge: 26,
  checkpointRetention: 15,
  display: {},
};

describe('遊戲局服務', () => {
  const openContext = useServiceContexts();

  it('建立遊戲局：預設設定、沒有系統對照表、目前遊戲年等於起始年，並成為目前遊戲局', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '第一局', startYear: 1968 });
    expect(game).toEqual({
      id: 'id-0001',
      name: '第一局',
      startYear: 1968,
      currentYear: 1968,
      createdAt: '2026-09-15T00:00:00.000Z',
      updatedAt: '2026-09-15T00:00:00.000Z',
      appVersion: '0.0.0-test',
    });
    expect(await getCurrentGame(context)).toEqual(game);
    expect(await readGameSettings(context.database, game.id)).toEqual(DEFAULT_SETTINGS);
    expect(await readRecords(context.database, game.id, 'systemMap')).toEqual([]);
    expect(context.status.write).toEqual({ state: 'saved', at: '2026-09-15T00:00:01.000Z' });
  });

  it('名稱空白或年份錯誤時拒絕，不寫入任何資料', async () => {
    const context = await openContext();
    await expect(createGame(context, { name: '  ', startYear: 1968 })).rejects.toMatchObject({
      code: 'invalidInput',
    });
    await expect(createGame(context, { name: '局', startYear: 99 })).rejects.toMatchObject({
      code: 'invalidInput',
    });
    expect(await listAllGames(context)).toEqual([]);
    expect(context.status.write).toEqual({ state: 'none' });
  });

  it('[DATA-13] 新局選擇複製設定時，只複製系統對照表與顯示設定', async () => {
    const context = await openContext();
    const { database } = context;
    const source = await createGame(context, { name: '來源局', startYear: 1968 });
    await database.put('gameSettings', {
      gameId: source.id,
      retirementAge: 23,
      highAgeReminderAge: 17,
      stallionAgeReminderAge: 25,
      checkpointRetention: 10,
      display: { theme: 'dark' },
    });
    const systemMap = [{ id: 'map-1', subsystem: 'マンノウォー', parentSystem: 'マッチェム' }];
    await putRecords(database, source.id, 'systemMap', systemMap);
    await putRecords(database, source.id, 'lines', [{ id: 'line-1', position: 1 }]);
    await putRecords(database, source.id, 'horses', [{ id: 'h1', fullName: 'テストウマ001' }]);
    await putRecords(database, source.id, 'events', [{ id: 'e1', subjectId: 'game' }]);

    const copied = await createGame(context, {
      name: '新局',
      startYear: 1975,
      copySettingsFromGameId: source.id,
    });

    expect(await readGameSettings(database, copied.id)).toEqual({
      ...DEFAULT_SETTINGS,
      display: { theme: 'dark' },
    });
    expect(await readRecords(database, copied.id, 'systemMap')).toEqual(systemMap);
    const counts = await countGameRecords(database, copied.id);
    expect([counts.lines, counts.horses, counts.events, counts.checkpoints]).toEqual([0, 0, 0, 0]);
    expect(await readRecords(database, source.id, 'systemMap')).toEqual(systemMap);
  });

  it('切換遊戲局只改變目前遊戲局；不存在的局拒絕', async () => {
    const context = await openContext();
    const first = await createGame(context, { name: '第一局', startYear: 1968 });
    const second = await createGame(context, { name: '第二局', startYear: 1968 });
    expect((await getCurrentGame(context))?.id).toBe(second.id);
    await switchGame(context, first.id);
    expect((await getCurrentGame(context))?.id).toBe(first.id);
    await expect(switchGame(context, 'missing')).rejects.toMatchObject({ code: 'gameNotFound' });
  });

  it('[DATA-11] 更新前的預覽顯示前後年份與較晚的檢查點數，且不寫入', async () => {
    const context = await openContext();
    const { database } = context;
    const game = await createGame(context, { name: '第一局', startYear: 1968 });
    await database.put('games', { ...game, currentYear: 1972 });
    await database.put('checkpoints', { gameId: game.id, id: 'cp-1970', gameYear: 1970 });
    await database.put('checkpoints', { gameId: game.id, id: 'cp-1972', gameYear: 1972 });

    expect(await previewYearChange(context, 1970)).toEqual({
      gameName: '第一局',
      fromYear: 1972,
      toYear: 1970,
      checkpointsAfterTarget: 1,
    });
    expect((await getCurrentGame(context))?.currentYear).toBe(1972);
    expect(await readRecords(database, game.id, 'events')).toEqual([]);
  });

  it('[DATA-11] 使用者確認後才更新目前遊戲年，並寫入事件', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '第一局', startYear: 1968 });
    const updated = await changeCurrentYear(context, 1969);
    expect(updated).toMatchObject({ currentYear: 1969, updatedAt: '2026-09-15T00:00:02.000Z' });
    expect((await getCurrentGame(context))?.currentYear).toBe(1969);
    expect(await readRecords(context.database, game.id, 'events')).toEqual([
      {
        id: 'id-0002',
        subjectId: 'game',
        type: 'gameYearChanged',
        gameYear: 1969,
        before: { currentYear: 1968 },
        after: { currentYear: 1969 },
        source: 'user',
        occurredAt: '2026-09-15T00:00:02.000Z',
      },
    ]);
  });

  it('[DATA-11] 年份早於起始年、不是整數或與目前相同時拒絕', async () => {
    const context = await openContext();
    await createGame(context, { name: '第一局', startYear: 1968 });
    for (const year of [1967, 1968, 1968.5]) {
      await expect(previewYearChange(context, year)).rejects.toMatchObject({
        code: 'invalidInput',
      });
      await expect(changeCurrentYear(context, year)).rejects.toMatchObject({
        code: 'invalidInput',
      });
    }
  });

  it('更新目前遊戲年時在交易內讀出遊戲局再合併，不覆蓋操作開始後才寫入的最近備份', async () => {
    const context = await openContext();
    // game 相當於服務在操作開始時讀到的舊紀錄；之後才以另一個寫入加上最近備份。
    const game = await createGame(context, { name: '第一局', startYear: 1968 });
    const lastBackup = {
      fileName: 'WPStudBook_第一局_1968年_20260915-000500.json.gz',
      exportedAt: '2026-09-15T00:05:00.000Z',
      sizeBytes: 100,
      recordCount: 0,
    };
    await context.database.put('games', { ...game, lastBackup });

    const updated = await updateCurrentYear(context.database, {
      gameId: game.id,
      touch: YEAR_TOUCH,
      apply: () => ({ currentYear: 1969, event: YEAR_EVENT }),
    });

    const expected = { ...game, currentYear: 1969, ...YEAR_TOUCH, lastBackup };
    expect(updated).toEqual(expected);
    expect(await getCurrentGame(context)).toEqual(expected);
    expect(await readRecords(context.database, game.id, 'events')).toEqual([YEAR_EVENT]);
  });

  it('更新目前遊戲年時遊戲局不存在就丟出錯誤，整筆交易不寫入任何紀錄', async () => {
    const context = await openContext();

    await expect(
      updateCurrentYear(context.database, {
        gameId: 'missing',
        touch: YEAR_TOUCH,
        apply: () => ({ currentYear: 1969, event: YEAR_EVENT }),
      }),
    ).rejects.toThrow('找不到遊戲局 missing');

    expect(await context.database.get('games', 'missing')).toBeUndefined();
    expect(await readRecords(context.database, 'missing', 'events')).toEqual([]);
  });

  it('年份檢查與事件前值使用寫入交易內讀出的遊戲局；apply 丟出錯誤時整筆交易不寫入', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '第一局', startYear: 1968 });
    // 服務在操作開始時讀到 1968 年；之後其他分頁已把目前遊戲年改為 1970 年。
    await context.database.put('games', { ...game, currentYear: 1970 });

    const seen: number[] = [];
    const updated = await updateCurrentYear(context.database, {
      gameId: game.id,
      touch: YEAR_TOUCH,
      apply: (stored) => {
        seen.push(stored.currentYear);
        return {
          currentYear: 1971,
          event: {
            ...YEAR_EVENT,
            gameYear: 1971,
            before: { currentYear: stored.currentYear },
            after: { currentYear: 1971 },
          },
        };
      },
    });
    expect(seen).toEqual([1970]);
    expect(updated).toMatchObject({ currentYear: 1971, ...YEAR_TOUCH });
    expect((await readRecords(context.database, game.id, 'events'))[0]?.before).toEqual({
      currentYear: 1970,
    });

    await expect(
      updateCurrentYear(context.database, {
        gameId: game.id,
        touch: { updatedAt: '2026-09-15T02:00:00.000Z', appVersion: '9.9.9' },
        apply: () => {
          throw new ServiceError('invalidInput', '目前遊戲年已經是 1971 年');
        },
      }),
    ).rejects.toMatchObject({ code: 'invalidInput' });
    expect(await getCurrentGame(context)).toMatchObject({ currentYear: 1971, ...YEAR_TOUCH });
    expect(await readRecords(context.database, game.id, 'events')).toHaveLength(1);
  });

  it('[DATA-11] 目前遊戲年已被其他寫入改成目標年份時，交易內的檢查拒絕且不寫入事件', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '第一局', startYear: 1968 });
    await context.database.put('games', { ...game, currentYear: 1969 });

    await expect(changeCurrentYear(context, 1969)).rejects.toMatchObject({
      code: 'invalidInput',
    });
    expect(await readRecords(context.database, game.id, 'events')).toEqual([]);
  });

  it('[DATA-10] 刪除前顯示筆數；局名不符時拒絕且資料不變', async () => {
    const context = await openContext();
    const { database } = context;
    const game = await createGame(context, { name: '第一局', startYear: 1968 });
    await putRecords(database, game.id, 'horses', [{ id: 'h1' }, { id: 'h2' }]);
    await database.put('checkpoints', { gameId: game.id, id: 'cp1', gameYear: 1968 });

    expect(await previewGameDeletion(context, game.id)).toMatchObject({
      recordCount: 2,
      checkpointCount: 1,
    });
    await expect(deleteGame(context, game.id, '第一')).rejects.toMatchObject({
      code: 'confirmationMismatch',
    });
    expect(await listAllGames(context)).toHaveLength(1);
    expect(await readRecords(database, game.id, 'horses')).toHaveLength(2);
  });

  it('[DATA-10] 永久刪除此局只刪除該局全部資料，目前遊戲局改為其他局', async () => {
    const context = await openContext();
    const { database } = context;
    const first = await createGame(context, { name: '第一局', startYear: 1968 });
    const second = await createGame(context, { name: '第二局', startYear: 1968 });
    await putRecords(database, first.id, 'horses', [{ id: 'h1' }]);
    await putRecords(database, second.id, 'horses', [{ id: 'h1' }]);
    await database.put('checkpoints', { gameId: second.id, id: 'cp1', gameYear: 1968 });
    await database.put('checkpointData', {
      gameId: second.id,
      id: 'cp1',
      bytes: new Uint8Array([1]),
    });

    await deleteGame(context, second.id, '第二局');

    expect((await listAllGames(context)).map((game) => game.id)).toEqual([first.id]);
    expect((await getCurrentGame(context))?.id).toBe(first.id);
    const remaining = Object.values(await countGameRecords(database, second.id));
    expect(remaining.every((count) => count === 0)).toBe(true);
    expect(await readRecords(database, first.id, 'horses')).toEqual([{ id: 'h1' }]);
  });

  it('[DATA-10] 刪除全部存檔要輸入目前局名，完成後所有資料表清空', async () => {
    const context = await openContext();
    const { database } = context;
    const first = await createGame(context, { name: '第一局', startYear: 1968 });
    await createGame(context, { name: '第二局', startYear: 1968 });
    await putRecords(database, first.id, 'horses', [{ id: 'h1' }]);

    expect(await previewDeleteAll(context)).toEqual({
      gameCount: 2,
      recordCount: 1,
      checkpointCount: 0,
    });
    await expect(deleteAllData(context, '第一局')).rejects.toMatchObject({
      code: 'confirmationMismatch',
    });
    await deleteAllData(context, '第二局');
    for (const name of ALL_STORES) {
      expect(await database.count(name), name).toBe(0);
    }
  });

  it('寫入失敗時保存狀態記錄失敗與原因', async () => {
    const context = await openContext();
    context.database.close();
    await expect(createGame(context, { name: '第一局', startYear: 1968 })).rejects.toThrow();
    expect(context.status.write).toMatchObject({ state: 'failed' });
  });

  it('持久保存：申請成功為 persisted，被拒為 notPersisted，沒有 StorageManager 為 unsupported', async () => {
    const context = await openContext();
    vi.stubGlobal('navigator', {
      storage: { persisted: () => Promise.resolve(false), persist: () => Promise.resolve(true) },
    });
    expect(await requestPersistentStorage(context)).toBe('persisted');
    vi.stubGlobal('navigator', {
      storage: { persisted: () => Promise.resolve(false), persist: () => Promise.resolve(false) },
    });
    expect(await requestPersistentStorage(context)).toBe('notPersisted');
    vi.stubGlobal('navigator', {});
    expect(await requestPersistentStorage(context)).toBe('unsupported');
    expect((await loadAppStatus(context)).persistence).toBe('unsupported');
  });

  it('狀態列資料：目前遊戲局、全部遊戲局與目前局的紀錄筆數', async () => {
    const context = await openContext();
    expect(await loadAppStatus(context)).toMatchObject({
      currentGame: undefined,
      games: [],
      recordCount: 0,
      write: { state: 'none' },
    });
    const game = await createGame(context, { name: '第一局', startYear: 1968 });
    await putRecords(context.database, game.id, 'horses', [{ id: 'h1' }, { id: 'h2' }]);
    await putRecords(context.database, game.id, 'systemMap', [{ id: 'm1', subsystem: 'x' }]);
    const status = await loadAppStatus(context);
    expect(status.currentGame?.id).toBe(game.id);
    expect(status.games).toHaveLength(1);
    expect(status.recordCount).toBe(3);
  });
});
