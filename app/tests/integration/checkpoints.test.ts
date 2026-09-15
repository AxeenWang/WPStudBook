import { describe, expect, it } from 'vitest';
import type { Game } from '../../src/domain/game.ts';
import { loadAppStatus } from '../../src/services/app-status.ts';
import type { BackupFile } from '../../src/services/backup.ts';
import {
  createCheckpoint,
  listGameCheckpoints,
  previewRollback,
  rollbackToCheckpoint,
  setCheckpointPinned,
} from '../../src/services/checkpoints.ts';
import type { ServiceContext } from '../../src/services/context.ts';
import {
  changeCurrentYear,
  createGame,
  getCurrentGame,
  switchGame,
} from '../../src/services/games.ts';
import { isGzip } from '../../src/storage/backup/gzip.ts';
import { listCheckpoints, readCheckpointBytes } from '../../src/storage/checkpoints.ts';
import { getGame } from '../../src/storage/games.ts';
import { putRecords, readRecords, type StoredRecord } from '../../src/storage/records.ts';
import { RECORD_COLLECTIONS } from '../../src/storage/schema.ts';
import {
  SYNTHETIC_RECORDS,
  SYNTHETIC_SETTINGS,
  seedSyntheticGame,
} from '../fixtures/synthetic-game.ts';
import { useServiceContexts } from './helpers.ts';

function sortById(records: readonly StoredRecord[]): StoredRecord[] {
  return [...records].sort((a, b) => (a.id as string).localeCompare(b.id as string));
}

const NO_DOWNLOAD = { deliverBackup: () => Promise.resolve() };

describe('檢查點與回溯', () => {
  const openContext = useServiceContexts();

  async function seededContext(): Promise<{ context: ServiceContext; game: Game }> {
    const context = await openContext();
    const game = await createGame(context, { name: 'テスト局「一」', startYear: 1968 });
    await seedSyntheticGame(context.database, game.id);
    return { context, game };
  }

  /** 建立回溯目標後，新增一匹馬、推進一年，再建立一個較晚的檢查點。 */
  async function changedAfterCheckpoint(context: ServiceContext, game: Game) {
    const target = (await createCheckpoint(context, { note: '回溯目標' })).checkpoint;
    await putRecords(context.database, game.id, 'horses', [{ id: 'horse-new', fullName: '新馬' }]);
    await changeCurrentYear(context, 1969);
    const later = (await createCheckpoint(context)).checkpoint;
    return { target, later };
  }

  it('[CKPT-02] 手動建立檢查點可加註，記錄年、時間、SHA-256、大小與筆數，內容為 gzip 備份', async () => {
    const { context, game } = await seededContext();
    const { checkpoint, prunedIds } = await createCheckpoint(context, { note: '存檔 1968 春' });

    expect(checkpoint).toMatchObject({
      id: 'id-0002',
      gameYear: 1968,
      createdAt: '2026-09-15T00:00:02.000Z',
      note: '存檔 1968 春',
      pinned: false,
      counts: { gameSettings: 1, horses: 3, events: 1 },
    });
    expect(checkpoint.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(prunedIds).toEqual([]);
    expect(await listGameCheckpoints(context)).toEqual([checkpoint]);
    const bytes = await readCheckpointBytes(context.database, game.id, checkpoint.id);
    expect(bytes !== undefined && isGzip(bytes)).toBe(true);
    expect(checkpoint.sizeBytes).toBe(bytes?.length);
  });

  it('[CKPT-02] 註記全為空白時不保存註記', async () => {
    const { context } = await seededContext();
    const { checkpoint } = await createCheckpoint(context, { note: '  ' });
    expect('note' in checkpoint).toBe(false);
  });

  it('[CKPT-03] 超過保留數時清除最舊且未釘選的檢查點與其內容', async () => {
    const { context, game } = await seededContext();
    await context.database.put('gameSettings', {
      ...SYNTHETIC_SETTINGS,
      checkpointRetention: 3,
      gameId: game.id,
    });
    const first = (await createCheckpoint(context)).checkpoint;
    const second = (await createCheckpoint(context)).checkpoint;
    const third = (await createCheckpoint(context)).checkpoint;
    await setCheckpointPinned(context, first.id, true);

    const fourth = await createCheckpoint(context);

    expect(fourth.prunedIds).toEqual([second.id]);
    expect((await listGameCheckpoints(context)).map((item) => item.id)).toEqual([
      fourth.checkpoint.id,
      third.id,
      first.id,
    ]);
    expect(await readCheckpointBytes(context.database, game.id, second.id)).toBeUndefined();
  });

  it('[CKPT-03] 已釘選數達到保留數時，新建立的檢查點仍保留', async () => {
    const { context, game } = await seededContext();
    await context.database.put('gameSettings', {
      ...SYNTHETIC_SETTINGS,
      checkpointRetention: 2,
      gameId: game.id,
    });
    const first = (await createCheckpoint(context)).checkpoint;
    await setCheckpointPinned(context, first.id, true);
    const second = (await createCheckpoint(context)).checkpoint;
    await setCheckpointPinned(context, second.id, true);

    const third = await createCheckpoint(context);

    expect(third.prunedIds).toEqual([]);
    const ids = (await listGameCheckpoints(context)).map((item) => item.id);
    expect(ids).toHaveLength(3);
    expect(ids).toContain(third.checkpoint.id);
  });

  it('[CKPT-04] 回溯預覽顯示將捨棄的資料與較晚的檢查點，且不寫入', async () => {
    const { context, game } = await seededContext();
    const { target, later } = await changedAfterCheckpoint(context, game);

    const preview = await previewRollback(context, target.id);

    expect(preview).toMatchObject({
      gameName: 'テスト局「一」',
      currentYear: 1969,
      targetYear: 1968,
      checkpoint: { id: target.id, counts: { horses: 3, events: 1 } },
      currentCounts: { horses: 4, events: 2 },
    });
    expect(preview.laterCheckpoints.map((item) => item.id)).toEqual([later.id]);
    expect((await getCurrentGame(context))?.currentYear).toBe(1969);
  });

  it('[CKPT-04][CKPT-06] 先交出目前備份，再還原資料與遊戲年並移除較晚的檢查點', async () => {
    const { context, game } = await seededContext();
    const { target, later } = await changedAfterCheckpoint(context, game);
    const delivered: BackupFile[] = [];

    const result = await rollbackToCheckpoint(context, target.id, {
      deliverBackup: async (file) => {
        delivered.push(file);
        // 交出備份時資料尚未回溯。
        expect((await getCurrentGame(context))?.currentYear).toBe(1969);
      },
    });

    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.summary).toMatchObject({ gameName: 'テスト局「一」', recordCount: 18 });
    expect(result.removedCheckpointIds).toEqual([later.id]);
    expect(result.game.currentYear).toBe(1968);
    const current = await getCurrentGame(context);
    expect(current?.currentYear).toBe(1968);
    expect(current?.lastBackup?.fileName).toBe(delivered[0]?.fileName);
    for (const collection of RECORD_COLLECTIONS) {
      const records = await readRecords(context.database, game.id, collection);
      expect(sortById(records), collection).toStrictEqual(sortById(SYNTHETIC_RECORDS[collection]));
    }
    expect((await listGameCheckpoints(context)).map((item) => item.id)).toEqual([target.id]);
    expect(await readCheckpointBytes(context.database, game.id, later.id)).toBeUndefined();
  });

  it('[CKPT-04] 無法交出目前備份時停止回溯，資料不變', async () => {
    const { context, game } = await seededContext();
    const { target } = await changedAfterCheckpoint(context, game);

    await expect(
      rollbackToCheckpoint(context, target.id, {
        deliverBackup: () => Promise.reject(new Error('下載失敗')),
      }),
    ).rejects.toMatchObject({ code: 'deliveryFailed' });

    expect((await getCurrentGame(context))?.currentYear).toBe(1969);
    expect(await readRecords(context.database, game.id, 'horses')).toHaveLength(4);
    expect(await listGameCheckpoints(context)).toHaveLength(2);
  });

  it('[CKPT-05] 檢查點內容損壞或與記錄的 SHA-256 不符時停止回溯，資料不變', async () => {
    const { context, game } = await seededContext();
    const { target, later } = await changedAfterCheckpoint(context, game);
    const laterBytes = await readCheckpointBytes(context.database, game.id, later.id);
    const delivered: string[] = [];
    const options = {
      deliverBackup: (file: BackupFile) => {
        delivered.push(file.fileName);
        return Promise.resolve();
      },
    };

    await context.database.put('checkpointData', {
      gameId: game.id,
      id: target.id,
      bytes: new Uint8Array([0x1f, 0x8b, 0, 1, 2, 3]),
    });
    await expect(rollbackToCheckpoint(context, target.id, options)).rejects.toMatchObject({
      code: 'checkpointInvalid',
    });

    await context.database.put('checkpointData', {
      gameId: game.id,
      id: target.id,
      bytes: laterBytes,
    });
    await expect(rollbackToCheckpoint(context, target.id, options)).rejects.toMatchObject({
      code: 'checkpointInvalid',
    });

    expect(delivered).toHaveLength(2);
    expect((await getCurrentGame(context))?.currentYear).toBe(1969);
    expect(await readRecords(context.database, game.id, 'horses')).toHaveLength(4);
    expect(await listGameCheckpoints(context)).toHaveLength(2);
  });

  it('回溯寫入中途失敗時整筆退回，資料與檢查點不變', async () => {
    const { context: firstContext, game } = await seededContext();
    // target 的內容是建立回溯目標當下的合成局備份，events 已含 SYNTHETIC_RECORDS 的 event-1。
    const { target } = await changedAfterCheckpoint(firstContext, game);

    const secondContext = await openContext({
      schemaVersion: 2,
      migrations: [{ from: 1, migrate: (payload) => payload }],
      newId: () => 'event-1',
    });

    // 取代交易加入的遷移事件 id 與檢查點內容既有的 event-1 相同，插入時以 ConstraintError 中止整筆交易。
    await expect(rollbackToCheckpoint(secondContext, target.id, NO_DOWNLOAD)).rejects.toThrow(
      'constraint',
    );

    expect((await getCurrentGame(firstContext))?.currentYear).toBe(1969);
    expect(await readRecords(firstContext.database, game.id, 'horses')).toHaveLength(4);
    expect(await listGameCheckpoints(firstContext)).toHaveLength(2);
  });

  it('[CKPT-07] 回溯只影響目前遊戲局，也不能回溯到其他局的檢查點', async () => {
    const { context, game } = await seededContext();
    const target = (await createCheckpoint(context)).checkpoint;
    const other = await createGame(context, { name: '另一局', startYear: 1980 });
    await seedSyntheticGame(context.database, other.id);
    await putRecords(context.database, other.id, 'horses', [{ id: 'horse-other' }]);
    const otherCheckpoint = (await createCheckpoint(context)).checkpoint;
    await switchGame(context, game.id);
    await putRecords(context.database, game.id, 'horses', [{ id: 'horse-new' }]);

    await expect(
      rollbackToCheckpoint(context, otherCheckpoint.id, NO_DOWNLOAD),
    ).rejects.toMatchObject({ code: 'checkpointNotFound' });
    await rollbackToCheckpoint(context, target.id, NO_DOWNLOAD);

    expect(await readRecords(context.database, game.id, 'horses')).toHaveLength(3);
    expect(await readRecords(context.database, other.id, 'horses')).toHaveLength(4);
    expect((await getGame(context.database, other.id))?.currentYear).toBe(1980);
    expect((await listCheckpoints(context.database, other.id)).map((item) => item.id)).toEqual([
      otherCheckpoint.id,
    ]);
  });

  it('狀態列顯示最近的檢查點', async () => {
    const { context } = await seededContext();
    expect((await loadAppStatus(context)).lastCheckpoint).toBeUndefined();
    await createCheckpoint(context);
    const latest = (await createCheckpoint(context, { note: '最新' })).checkpoint;
    expect((await loadAppStatus(context)).lastCheckpoint).toEqual(latest);
  });
});
