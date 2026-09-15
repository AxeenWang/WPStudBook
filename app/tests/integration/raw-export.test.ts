import { describe, expect, it } from 'vitest';
import { exportBackup, exportRawGameData, previewBackupFile } from '../../src/services/backup.ts';
import { createGame, getCurrentGame } from '../../src/services/games.ts';
import { putRecords } from '../../src/storage/records.ts';
import { SYNTHETIC_SETTINGS, seedSyntheticGame } from '../fixtures/synthetic-game.ts';
import { useServiceContexts } from './helpers.ts';

describe('原始資料匯出', () => {
  const openContext = useServiceContexts();

  it('本機資料不符合資料契約時備份被拒絕；原始資料匯出保留全部資料、標示不能還原，匯入時以格式不符拒絕', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '救援局', startYear: 1968 });
    await seedSyntheticGame(context.database, game.id);
    await putRecords(context.database, game.id, 'horses', [
      { id: 'broken-horse', fullName: '性別不明', stageNumbers: [], aliases: [] },
    ]);
    await expect(exportBackup(context)).rejects.toMatchObject({ code: 'backupRejected' });
    const writeBefore = context.status.write;

    const file = await exportRawGameData(context);

    expect(file.fileName).toBe('WPStudBook_救援局_1968年_20260915-000002_原始資料_不能還原.json');
    expect(file.mediaType).toBe('application/json');
    const raw = JSON.parse(new TextDecoder().decode(file.bytes)) as Record<string, unknown>;
    expect(raw).toMatchObject({
      format: 'WPStudBook-raw-export',
      restorable: false,
      schemaVersion: 1,
      appVersion: '0.0.0-test',
      exportedAt: '2026-09-15T00:00:02.000Z',
      game: { id: game.id, name: '救援局', startYear: 1968 },
    });
    const collections = raw.collections as Record<string, Record<string, unknown>[] | undefined>;
    expect(collections.horses?.map((horse) => horse.id).sort()).toEqual([
      'broken-horse',
      'horse-dam',
      'horse-foal',
      'horse-sire',
    ]);
    expect(collections.gameSettings).toEqual([SYNTHETIC_SETTINGS]);
    expect(await previewBackupFile(context, file.fileName, file.bytes)).toMatchObject({
      ok: false,
      stage: 'envelope',
      issues: [{ code: 'wrongFormat' }],
    });
    expect(context.status.write).toEqual(writeBefore);
    expect((await getCurrentGame(context))?.lastBackup).toBeUndefined();
  });
});
