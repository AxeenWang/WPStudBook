import { describe, expect, it, vi } from 'vitest';
import type { Game } from '../../src/domain/game.ts';
import {
  completeArchive,
  listArchiveEntries,
  prepareArchive,
  previewArchiveRestore,
  removeArchiveEntry,
  restoreArchive,
  verifyArchiveFile,
  type ChosenFile,
} from '../../src/services/archives.ts';
import { exportBackup, type RestoreProgress } from '../../src/services/backup.ts';
import { createCheckpoint } from '../../src/services/checkpoints.ts';
import type { ServiceContext } from '../../src/services/context.ts';
import {
  changeCurrentYear,
  createGame,
  getCurrentGame,
  listAllGames,
  previewDeleteAll,
  switchGame,
} from '../../src/services/games.ts';
import { archiveGameData, listArchives } from '../../src/storage/archives.ts';
import { isGzip } from '../../src/storage/backup/gzip.ts';
import { countGameRecords, getGame } from '../../src/storage/games.ts';
import { readRecords } from '../../src/storage/records.ts';
import { seedSyntheticGame } from '../fixtures/synthetic-game.ts';
import { useServiceContexts } from './helpers.ts';

const GAME_NAME = 'テスト局「一」';

describe('封存舊遊戲局', () => {
  const openContext = useServiceContexts();

  async function seededContext(): Promise<{ context: ServiceContext; game: Game }> {
    const context = await openContext();
    const game = await createGame(context, { name: GAME_NAME, startYear: 1968 });
    await seedSyntheticGame(context.database, game.id);
    return { context, game };
  }

  async function preparedFile(context: ServiceContext, gameId: string): Promise<ChosenFile> {
    const archive = await prepareArchive(context, gameId);
    return { fileName: archive.fileName, bytes: archive.bytes };
  }

  async function expectUnchanged(context: ServiceContext, game: Game): Promise<void> {
    expect(await getGame(context.database, game.id)).toBeDefined();
    const counts = await countGameRecords(context.database, game.id);
    expect(counts.horses).toBe(3);
    expect(counts.gameSettings).toBe(1);
    expect(await listArchives(context.database)).toEqual([]);
  }

  it('[DATA-09] 產生封存檔：.json.gz、在記憶體解壓驗證，不寫入資料庫', async () => {
    const { context, game } = await seededContext();
    const archive = await prepareArchive(context, game.id);
    expect(archive.fileName).toBe('WPStudBook_テスト局「一」_1968年_20260915-000002_封存.json.gz');
    expect(archive.mediaType).toBe('application/gzip');
    expect(isGzip(archive.bytes)).toBe(true);
    expect(archive.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(archive.summary).toMatchObject({ recordCount: 16, compressed: true });
    await expectUnchanged(context, game);
    expect((await getGame(context.database, game.id))?.lastBackup).toBeUndefined();
  });

  it('[DATA-09] 不支援 gzip 壓縮時不產生封存檔', async () => {
    const { context, game } = await seededContext();
    vi.stubGlobal('CompressionStream', undefined);
    await expect(prepareArchive(context, game.id)).rejects.toMatchObject({
      code: 'archiveRejected',
    });
    await expectUnchanged(context, game);
  });

  it('[DATA-09] 未選回下載的封存檔（未確認已下載）→ 不移除本機資料', async () => {
    const { context, game } = await seededContext();
    await prepareArchive(context, game.id);
    await expect(
      completeArchive(context, { gameId: game.id, file: undefined, typedName: GAME_NAME }),
    ).rejects.toMatchObject({ code: 'archiveRejected' });
    await expectUnchanged(context, game);
  });

  it('[DATA-09] 封存檔未通過驗證（截斷、不是 gzip）→ 不移除本機資料', async () => {
    const { context, game } = await seededContext();
    const file = await preparedFile(context, game.id);
    vi.stubGlobal('CompressionStream', undefined);
    const plainJson = await exportBackup(context);
    vi.unstubAllGlobals();
    const rejected: ChosenFile[] = [
      { fileName: 'truncated.json.gz', bytes: file.bytes.slice(0, file.bytes.length / 2) },
      { fileName: plainJson.fileName, bytes: plainJson.bytes },
    ];
    for (const chosen of rejected) {
      await expect(verifyArchiveFile(context, game.id, chosen)).rejects.toMatchObject({
        code: 'archiveRejected',
      });
      await expect(
        completeArchive(context, { gameId: game.id, file: chosen, typedName: GAME_NAME }),
      ).rejects.toMatchObject({ code: 'archiveRejected' });
    }
    await expectUnchanged(context, game);
  });

  it('[DATA-09] 選錯檔案，或產生封存檔之後這一局有異動 → 不移除，須重新產生', async () => {
    const { context, game } = await seededContext();
    const other = await createGame(context, { name: '別的局', startYear: 1970 });
    const otherFile = await preparedFile(context, other.id);
    await switchGame(context, game.id);
    const staleFile = await preparedFile(context, game.id);
    await changeCurrentYear(context, 1969);

    for (const chosen of [otherFile, staleFile]) {
      await expect(
        completeArchive(context, { gameId: game.id, file: chosen, typedName: GAME_NAME }),
      ).rejects.toThrow(/目前的資料不一致/);
    }
    await expectUnchanged(context, game);

    const fresh = await preparedFile(context, game.id);
    await expect(verifyArchiveFile(context, game.id, fresh)).resolves.toMatchObject({
      game: { id: game.id, currentYear: 1969 },
    });
  });

  it('[DATA-09] 局名不符 → 不移除本機資料', async () => {
    const { context, game } = await seededContext();
    const file = await preparedFile(context, game.id);
    await expect(
      completeArchive(context, { gameId: game.id, file, typedName: 'テスト局' }),
    ).rejects.toMatchObject({ code: 'confirmationMismatch' });
    await expectUnchanged(context, game);
  });

  it('[DATA-09] 核對通過並輸入局名 → 移除本機明細與檢查點，保留輕量索引並切換目前遊戲局', async () => {
    const { context, game } = await seededContext();
    await createCheckpoint(context, { note: '封存前' });
    const other = await createGame(context, { name: '別的局', startYear: 1970 });
    await switchGame(context, game.id);
    const file = await preparedFile(context, game.id);

    const verification = await verifyArchiveFile(context, game.id, file);
    expect(verification).toMatchObject({
      game: { id: game.id, name: GAME_NAME },
      recordCount: 16,
      checkpointCount: 1,
      summary: { fileName: file.fileName, compressed: true, recordCount: 16 },
    });

    const entry = await completeArchive(context, { gameId: game.id, file, typedName: GAME_NAME });
    expect(entry).toMatchObject({
      gameName: GAME_NAME,
      startYear: 1968,
      endYear: 1968,
      appVersion: '0.0.0-test',
      schemaVersion: 1,
      fileName: file.fileName,
      sizeBytes: file.bytes.length,
      recordCount: 16,
      sha256: verification.sha256,
    });
    expect(entry.counts).toMatchObject({ gameSettings: 1, horses: 3, systemMap: 2 });
    expect(await listArchiveEntries(context)).toEqual([entry]);

    expect(await getGame(context.database, game.id)).toBeUndefined();
    const counts = await countGameRecords(context.database, game.id);
    expect(Object.values(counts).every((count) => count === 0)).toBe(true);
    expect((await getCurrentGame(context))?.id).toBe(other.id);
    expect((await listAllGames(context)).map((item) => item.id)).toEqual([other.id]);
  });

  it('[DATA-09] 封存唯一的遊戲局後沒有目前遊戲局；封存非目前的局時目前遊戲局不變', async () => {
    const { context, game } = await seededContext();
    const second = await createGame(context, { name: '第二局', startYear: 1970 });
    const secondFile = await preparedFile(context, second.id);
    await switchGame(context, game.id);
    await completeArchive(context, { gameId: second.id, file: secondFile, typedName: '第二局' });
    expect((await getCurrentGame(context))?.id).toBe(game.id);

    const file = await preparedFile(context, game.id);
    await completeArchive(context, { gameId: game.id, file, typedName: GAME_NAME });
    expect(await getCurrentGame(context)).toBeUndefined();
    expect(await listAllGames(context)).toEqual([]);
    expect((await listArchiveEntries(context)).map((item) => item.gameName)).toEqual([
      GAME_NAME,
      '第二局',
    ]);
  });

  it('[DATA-09] 從封存檔還原為獨立遊戲局；驗證摘要不符的檔案被拒絕', async () => {
    const { context, game } = await seededContext();
    const file = await preparedFile(context, game.id);
    const entry = await completeArchive(context, { gameId: game.id, file, typedName: GAME_NAME });

    const other = await createGame(context, { name: '別的局', startYear: 1970 });
    const otherBackup = await exportBackup(context);
    const wrong: ChosenFile = { fileName: otherBackup.fileName, bytes: otherBackup.bytes };
    await expect(previewArchiveRestore(context, entry.id, wrong)).rejects.toThrow(/驗證摘要不符/);
    await expect(restoreArchive(context, { archiveId: entry.id, file: wrong })).rejects.toThrow(
      /驗證摘要不符/,
    );
    expect(await listAllGames(context)).toHaveLength(1);

    expect(await previewArchiveRestore(context, entry.id, file)).toMatchObject({
      entry,
      migrated: false,
      summary: { fileName: file.fileName, recordCount: 16 },
    });
    const steps: RestoreProgress[] = [];
    const restored = await restoreArchive(context, {
      archiveId: entry.id,
      file,
      name: '還原的局',
      onProgress: (progress) => {
        steps.push(progress);
      },
    });
    // 封存檔只解碼驗證一次，之後直接寫入。
    expect(steps.filter((item) => item.step === 'verify')).toHaveLength(4);
    expect(steps.at(-1)).toEqual({ step: 'write', done: 17, total: 17 });
    expect(restored).toMatchObject({ name: '還原的局', startYear: 1968, currentYear: 1968 });
    expect((await getCurrentGame(context))?.id).toBe(restored.id);
    const counts = await countGameRecords(context.database, restored.id);
    for (const [name, count] of Object.entries(entry.counts)) {
      expect(counts[name as keyof typeof counts]).toBe(count);
    }
    expect(await readRecords(context.database, restored.id, 'horses')).toHaveLength(3);
    expect((await listAllGames(context)).map((item) => item.id)).toEqual([other.id, restored.id]);
    expect(await listArchiveEntries(context)).toEqual([entry]);
  });

  it('移除封存索引只刪索引；刪除全部存檔的預覽列出索引數', async () => {
    const { context, game } = await seededContext();
    const file = await preparedFile(context, game.id);
    const entry = await completeArchive(context, { gameId: game.id, file, typedName: GAME_NAME });
    await createGame(context, { name: '別的局', startYear: 1970 });
    expect(await previewDeleteAll(context)).toMatchObject({ gameCount: 1, archiveCount: 1 });

    await removeArchiveEntry(context, entry.id);
    expect(await listArchiveEntries(context)).toEqual([]);
    await expect(removeArchiveEntry(context, entry.id)).rejects.toMatchObject({
      code: 'archiveNotFound',
    });
    expect(await previewDeleteAll(context)).toMatchObject({ gameCount: 1, archiveCount: 0 });
  });

  it('移除明細的交易內核對失敗時整筆退回', async () => {
    const { context, game } = await seededContext();
    const archiveEntry = {
      id: 'archive-1',
      gameName: GAME_NAME,
      startYear: 1968,
      endYear: 1968,
      appVersion: '0.0.0-test',
      schemaVersion: 1,
      exportedAt: '2026-09-15T00:00:00.000Z',
      archivedAt: '2026-09-15T00:00:01.000Z',
      fileName: 'a.json.gz',
      sizeBytes: 1,
      counts: {},
      recordCount: 0,
      sha256: '0'.repeat(64),
    };
    await expect(
      archiveGameData(context.database, {
        gameId: game.id,
        entry: archiveEntry,
        nextCurrentGameId: undefined,
        check: () => {
          throw new Error('期間有異動');
        },
      }),
    ).rejects.toThrow('期間有異動');
    await expectUnchanged(context, game);
    expect((await getCurrentGame(context))?.id).toBe(game.id);
  });
});
