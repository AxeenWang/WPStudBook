import { describe, expect, it } from 'vitest';
import type { HistoryEvent } from '../../src/domain/history-event.ts';
import { createGame, getCurrentGame } from '../../src/services/games.ts';
import {
  deleteSystemMapEntry,
  findParentSystem,
  listSystemMap,
  listSystemMapHistory,
  saveSystemMapEntry,
} from '../../src/services/system-map.ts';
import { putRecords, readRecords } from '../../src/storage/records.ts';
import { writeSystemMapChange } from '../../src/storage/system-map.ts';
import { useServiceContexts } from './helpers.ts';

const TOUCH = { updatedAt: '2026-09-15T01:00:00.000Z', appVersion: '9.9.9' };

const EVENT: HistoryEvent = {
  id: 'event-1',
  subjectId: 'map-1',
  type: 'systemMapChanged',
  gameYear: 1968,
  after: { subsystem: 'ネアルコ', parentSystem: 'ネアルコ' },
  source: 'user',
  occurredAt: TOUCH.updatedAt,
};

describe('系統對照表', () => {
  const openContext = useServiceContexts();

  it('新增對照：去掉前後空白與結尾「系」，寫入事件並更新遊戲局時間', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '對照局', startYear: 1968 });

    const entry = await saveSystemMapEntry(context, {
      subsystem: ' マンノウォー系 ',
      parentSystem: 'マッチェム系',
    });

    expect(entry).toEqual({ id: 'id-0002', subsystem: 'マンノウォー', parentSystem: 'マッチェム' });
    expect(await listSystemMap(context)).toEqual([entry]);
    expect(await findParentSystem(context, 'マンノウォー系')).toBe('マッチェム');
    expect(await findParentSystem(context, 'ハンプトン')).toBeUndefined();
    expect(await readRecords(context.database, game.id, 'events')).toEqual([
      {
        id: 'id-0003',
        subjectId: 'id-0002',
        type: 'systemMapChanged',
        gameYear: 1968,
        after: { subsystem: 'マンノウォー', parentSystem: 'マッチェム' },
        source: 'user',
        occurredAt: '2026-09-15T00:00:02.000Z',
      },
    ]);
    expect(await getCurrentGame(context)).toMatchObject({
      updatedAt: '2026-09-15T00:00:02.000Z',
      appVersion: '0.0.0-test',
    });
    expect(context.status.write).toEqual({ state: 'saved', at: '2026-09-15T00:00:03.000Z' });
  });

  it('子系統升格時更新同一筆對照，歷程保存變更前後的親系統，新到舊排列', async () => {
    const context = await openContext();
    await createGame(context, { name: '對照局', startYear: 1968 });
    const added = await saveSystemMapEntry(context, {
      subsystem: 'ハンプトン',
      parentSystem: 'エクリプス',
    });
    const updated = await saveSystemMapEntry(context, {
      subsystem: 'ハンプトン',
      parentSystem: 'ハンプトン',
    });

    expect(updated.id).toBe(added.id);
    expect(await listSystemMap(context)).toEqual([updated]);
    expect(await listSystemMapHistory(context)).toEqual([
      {
        id: 'id-0004',
        gameYear: 1968,
        occurredAt: '2026-09-15T00:00:04.000Z',
        before: { subsystem: 'ハンプトン', parentSystem: 'エクリプス' },
        after: { subsystem: 'ハンプトン', parentSystem: 'ハンプトン' },
      },
      {
        id: 'id-0003',
        gameYear: 1968,
        occurredAt: '2026-09-15T00:00:02.000Z',
        after: { subsystem: 'ハンプトン', parentSystem: 'エクリプス' },
      },
    ]);
  });

  it('內容相同或欄位空白時拒絕，不寫入', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '對照局', startYear: 1968 });
    await saveSystemMapEntry(context, { subsystem: 'ネアルコ', parentSystem: 'ネアルコ' });

    for (const input of [
      { subsystem: 'ネアルコ系', parentSystem: 'ネアルコ' },
      { subsystem: ' ', parentSystem: 'ネアルコ' },
      { subsystem: '系', parentSystem: 'ネアルコ' },
      { subsystem: 'ハンプトン', parentSystem: '' },
    ]) {
      await expect(saveSystemMapEntry(context, input)).rejects.toMatchObject({
        code: 'invalidInput',
      });
    }
    expect(await readRecords(context.database, game.id, 'events')).toHaveLength(1);
  });

  it('刪除對照：紀錄移除，歷程保存刪除前的內容；找不到時拒絕', async () => {
    const context = await openContext();
    await createGame(context, { name: '對照局', startYear: 1968 });
    const entry = await saveSystemMapEntry(context, {
      subsystem: 'ネアルコ',
      parentSystem: 'ネアルコ',
    });

    await deleteSystemMapEntry(context, entry.id);

    expect(await listSystemMap(context)).toEqual([]);
    const [latest] = await listSystemMapHistory(context);
    expect(latest).toEqual({
      id: 'id-0004',
      gameYear: 1968,
      occurredAt: '2026-09-15T00:00:04.000Z',
      before: { subsystem: 'ネアルコ', parentSystem: 'ネアルコ' },
    });
    await expect(deleteSystemMapEntry(context, entry.id)).rejects.toMatchObject({
      code: 'invalidInput',
    });
  });

  it('寫入時在交易內讀出遊戲局再合併更新時間與版本，不覆蓋操作開始後才寫入的最近備份', async () => {
    const context = await openContext();
    // game 相當於服務在操作開始時讀到的舊紀錄；之後才以另一個寫入加上最近備份。
    const game = await createGame(context, { name: '對照局', startYear: 1968 });
    const lastBackup = {
      fileName: 'WPStudBook_對照局_1968年_20260915-000500.json.gz',
      exportedAt: '2026-09-15T00:05:00.000Z',
      sizeBytes: 100,
      recordCount: 0,
    };
    await context.database.put('games', { ...game, lastBackup });

    await writeSystemMapChange(context.database, {
      gameId: game.id,
      touch: TOUCH,
      put: { id: 'map-1', subsystem: 'ネアルコ', parentSystem: 'ネアルコ' },
      event: EVENT,
    });

    expect(await getCurrentGame(context)).toEqual({ ...game, ...TOUCH, lastBackup });
    expect(await listSystemMap(context)).toEqual([
      { id: 'map-1', subsystem: 'ネアルコ', parentSystem: 'ネアルコ' },
    ]);
    expect(await readRecords(context.database, game.id, 'events')).toEqual([EVENT]);
  });

  it('遊戲局不存在時丟出錯誤，整筆交易不寫入任何紀錄', async () => {
    const context = await openContext();
    const orphan = { id: 'map-0', subsystem: 'ハンプトン', parentSystem: 'ハンプトン' };
    await putRecords(context.database, 'missing', 'systemMap', [orphan]);

    await expect(
      writeSystemMapChange(context.database, {
        gameId: 'missing',
        touch: TOUCH,
        put: { id: 'map-1', subsystem: 'ネアルコ', parentSystem: 'ネアルコ' },
        deleteId: orphan.id,
        event: EVENT,
      }),
    ).rejects.toThrow('找不到遊戲局 missing');

    expect(await context.database.get('games', 'missing')).toBeUndefined();
    expect(await readRecords(context.database, 'missing', 'systemMap')).toEqual([orphan]);
    expect(await readRecords(context.database, 'missing', 'events')).toEqual([]);
  });

  it('只作用於目前遊戲局；沒有目前遊戲局時拒絕', async () => {
    const context = await openContext();
    await expect(listSystemMap(context)).rejects.toMatchObject({ code: 'noCurrentGame' });
    const first = await createGame(context, { name: '第一局', startYear: 1968 });
    await saveSystemMapEntry(context, { subsystem: 'ネアルコ', parentSystem: 'ネアルコ' });
    await createGame(context, { name: '第二局', startYear: 1968 });

    expect(await listSystemMap(context)).toEqual([]);
    expect(await listSystemMapHistory(context)).toEqual([]);
    expect(await readRecords(context.database, first.id, 'systemMap')).toHaveLength(1);
  });
});
