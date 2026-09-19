import { describe, expect, it, vi } from 'vitest';
import {
  exportBackup,
  previewBackupFile,
  recordDeliveredBackup,
  restoreBackupAsNewGame,
  type RestoreProgress,
} from '../../src/services/backup.ts';
import type { ServiceContext } from '../../src/services/context.ts';
import { createGame, getCurrentGame, listAllGames } from '../../src/services/games.ts';
import {
  buildBackupDocument,
  emptyCollections,
  type BackupDocument,
} from '../../src/storage/backup/document.ts';
import { gunzip, isGzip } from '../../src/storage/backup/gzip.ts';
import type { BackupMigration } from '../../src/storage/backup/migrations.ts';
import { countGameRecords, readGameSettings } from '../../src/storage/games.ts';
import { horseNameKeys } from '../../src/storage/horses.ts';
import { putRecords, readRecords, type StoredRecord } from '../../src/storage/records.ts';
import { RECORD_COLLECTIONS } from '../../src/storage/schema.ts';
import { updateLastBackup } from '../../src/storage/snapshot.ts';
import {
  SYNTHETIC_RECORDS,
  SYNTHETIC_SETTINGS,
  seedSyntheticGame,
  stripNameKeys,
} from '../fixtures/synthetic-game.ts';
import { useServiceContexts } from './helpers.ts';
import type { Game } from '../../src/domain/game.ts';

function sortById(records: readonly StoredRecord[]): StoredRecord[] {
  return [...records].sort((a, b) => (a.id as string).localeCompare(b.id as string));
}

function jsonBytes(value: unknown): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(value));
}

const RENAME_NAME: BackupMigration = {
  from: 1,
  migrate: (payload) => ({
    ...payload,
    collections: {
      ...payload.collections,
      horses: (payload.collections.horses as Record<string, unknown>[]).map(
        ({ name, ...rest }) => ({ ...rest, fullName: name }),
      ),
    },
  }),
};

describe('備份匯出與還原', () => {
  const openContext = useServiceContexts();

  async function seededContext(): Promise<{ context: ServiceContext; game: Game }> {
    const context = await openContext();
    const game = await createGame(context, { name: 'テスト局「一」', startYear: 1968 });
    await seedSyntheticGame(context.database, game.id);
    return { context, game };
  }

  it('[DATA-07] 匯出目前遊戲局：摘要含檔名、局、筆數、大小、版本與時間，記錄最近備份前不寫入', async () => {
    const { context, game } = await seededContext();
    const file = await exportBackup(context);
    expect(file.gameId).toBe(game.id);
    expect(file.summary).toEqual({
      fileName: 'WPStudBook_テスト局「一」_1968年_20260915-000002.json.gz',
      gameName: 'テスト局「一」',
      counts: {
        gameSettings: 1,
        lines: 1,
        systemMap: 2,
        horses: 3,
        mares: 1,
        stallionDuties: 1,
        mareYearly: 1,
        stallionYearly: 1,
        breedings: 1,
        matingRatings: 1,
        foals: 1,
        recoveries: 1,
        imports: 1,
        events: 1,
      },
      recordCount: 16,
      sizeBytes: file.bytes.length,
      appVersion: '0.0.0-test',
      schemaVersion: 1,
      exportedAt: '2026-09-15T00:00:02.000Z',
      compressed: true,
    });
    expect(file.fileName).toBe(file.summary.fileName);
    expect(file.mediaType).toBe('application/gzip');
    expect(isGzip(file.bytes)).toBe(true);
    expect((await getCurrentGame(context))?.lastBackup).toBeUndefined();

    await recordDeliveredBackup(context, file);

    expect((await getCurrentGame(context))?.lastBackup).toEqual({
      fileName: file.fileName,
      exportedAt: '2026-09-15T00:00:02.000Z',
      sizeBytes: file.bytes.length,
      recordCount: 16,
    });
  });

  it('記錄最近備份失敗時，已產生的備份檔不受影響', async () => {
    const { context } = await seededContext();
    const file = await exportBackup(context);

    await expect(
      recordDeliveredBackup(context, { ...file, gameId: 'missing-game' }),
    ).rejects.toThrow('找不到遊戲局');
    expect(context.status.write.state).toBe('failed');
    expect(await previewBackupFile(context, file.fileName, file.bytes)).toMatchObject({
      ok: true,
    });
  });

  it('找不到遊戲局時記錄最近備份失敗，不建立任何資料', async () => {
    const context = await openContext();
    await expect(
      updateLastBackup(context.database, 'missing-game', {
        fileName: 'x.json.gz',
        exportedAt: '2026-09-15T00:00:00.000Z',
        sizeBytes: 1,
        recordCount: 0,
      }),
    ).rejects.toThrow('找不到遊戲局');
    expect(await context.database.count('games')).toBe(0);
  });

  it('[DATA-02][DATA-03] JSON.GZ 還原為新遊戲局：筆數、識別、父母關聯、別名、狀態、年度紀錄與特殊值一致', async () => {
    const { context, game } = await seededContext();
    const file = await exportBackup(context);
    const restored = await restoreBackupAsNewGame(context, { bytes: file.bytes });

    expect(restored.id).not.toBe(game.id);
    expect(restored).toMatchObject({ name: game.name, startYear: 1968, currentYear: 1968 });
    expect((await getCurrentGame(context))?.id).toBe(restored.id);
    expect(await readGameSettings(context.database, restored.id)).toEqual(SYNTHETIC_SETTINGS);
    for (const collection of RECORD_COLLECTIONS) {
      const records = await readRecords(context.database, restored.id, collection);
      expect(sortById(stripNameKeys(records)), collection).toStrictEqual(
        sortById(SYNTHETIC_RECORDS[collection]),
      );
    }
    // nameKeys 備份時剔除，還原時以新遊戲局的 id 重建。
    const restoredHorses = await readRecords(context.database, restored.id, 'horses');
    expect(restoredHorses.find((item) => item.id === 'horse-sire')?.nameKeys).toEqual([
      `${restored.id}\u001fテストシュボバ`,
    ]);
    expect(await readRecords(context.database, game.id, 'horses')).toHaveLength(3);
  });

  it('[ID-11] 因番号回收而共用能力番号的不同馬 → 備份還原後各自保有識別與關聯', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '番号回收局', startYear: 1968 });
    // 同一個能力番号先後給了兩匹出生年不同的馬（需求規格 6.2）；各自有自己的女兒。
    const horses = [
      {
        id: 'old',
        sex: 'female',
        abilityNo: 0x2345,
        birthYear: 1950,
        fullName: 'テストフルイ',
        stageNumbers: [],
        aliases: [],
      },
      {
        id: 'new',
        sex: 'female',
        abilityNo: 0x2345,
        birthYear: 1966,
        fullName: 'テストアタラシイ',
        stageNumbers: [],
        aliases: [],
      },
      {
        id: 'old-daughter',
        sex: 'female',
        birthYear: 1960,
        damId: 'old',
        stageNumbers: [],
        aliases: [],
      },
      {
        id: 'new-daughter',
        sex: 'female',
        birthYear: 1970,
        damId: 'new',
        stageNumbers: [],
        aliases: [],
      },
    ];
    await putRecords(
      context.database,
      game.id,
      'horses',
      horses.map((item) => ({ ...item, nameKeys: horseNameKeys(game.id, item) })),
    );
    await putRecords(context.database, game.id, 'foals', [
      { id: 'old-daughter', damId: 'old', birthYear: 1960, freeBred: true, disposition: 'sold' },
      { id: 'new-daughter', damId: 'new', birthYear: 1970, freeBred: true, disposition: 'sold' },
    ]);

    const file = await exportBackup(context);
    const restored = await restoreBackupAsNewGame(context, { bytes: file.bytes });
    const byId = new Map(
      (await readRecords(context.database, restored.id, 'horses')).map((item) => [item.id, item]),
    );
    expect(byId.get('old')).toMatchObject({
      abilityNo: 0x2345,
      birthYear: 1950,
      fullName: 'テストフルイ',
    });
    expect(byId.get('new')).toMatchObject({
      abilityNo: 0x2345,
      birthYear: 1966,
      fullName: 'テストアタラシイ',
    });
    expect(byId.get('old-daughter')?.damId).toBe('old');
    expect(byId.get('new-daughter')?.damId).toBe('new');
    const foals = await readRecords(context.database, restored.id, 'foals');
    expect(foals.map((foal) => [foal.id, foal.damId]).sort()).toEqual([
      ['new-daughter', 'new'],
      ['old-daughter', 'old'],
    ]);
  });

  it('大型檔案顯示進度（需求規格 12.2）：預覽回報驗證步驟，還原另回報寫入筆數直到全部寫完', async () => {
    const { context } = await seededContext();
    const file = await exportBackup(context);
    const previewSteps: RestoreProgress[] = [];
    await previewBackupFile(context, file.fileName, file.bytes, (progress) => {
      previewSteps.push(progress);
    });
    expect(previewSteps).toEqual([
      { step: 'verify', stage: 'parse' },
      { step: 'verify', stage: 'counts' },
      { step: 'verify', stage: 'hash' },
      { step: 'verify', stage: 'fields' },
    ]);

    const restoreSteps: RestoreProgress[] = [];
    const restored = await restoreBackupAsNewGame(context, {
      bytes: file.bytes,
      onProgress: (progress) => {
        restoreSteps.push(progress);
      },
    });
    expect(restoreSteps.slice(0, 4)).toEqual(previewSteps);
    const writes = restoreSteps.slice(4);
    // 設定 1 筆加上 16 筆紀錄；每筆都回報（少於 50 筆），逐筆遞增到全部寫完。
    expect(writes).toHaveLength(17);
    expect(writes.at(-1)).toEqual({ step: 'write', done: 17, total: 17 });
    expect(writes.map((item) => (item.step === 'write' ? item.done : 0))).toEqual(
      Array.from({ length: 17 }, (_, index) => index + 1),
    );
    expect(await readRecords(context.database, restored.id, 'horses')).toHaveLength(3);
  });

  it('[DATA-06] 不支援原生壓縮時匯出 JSON，並可還原', async () => {
    const { context } = await seededContext();
    vi.stubGlobal('CompressionStream', undefined);
    const file = await exportBackup(context);
    expect(file.summary.compressed).toBe(false);
    expect(file.fileName.endsWith('.json')).toBe(true);
    expect(file.mediaType).toBe('application/json');
    const restored = await restoreBackupAsNewGame(context, { bytes: file.bytes });
    expect(await readRecords(context.database, restored.id, 'horses')).toHaveLength(3);
  });

  it('預覽顯示備份摘要且不寫入；還原時局名全為空白則拒絕', async () => {
    const { context } = await seededContext();
    const file = await exportBackup(context);
    expect(await previewBackupFile(context, 'backup.json.gz', file.bytes)).toMatchObject({
      ok: true,
      migrated: false,
      sourceSchemaVersion: 1,
      game: { name: 'テスト局「一」', startYear: 1968, currentYear: 1968 },
      summary: { fileName: 'backup.json.gz', recordCount: 16, compressed: true },
    });
    expect(await listAllGames(context)).toHaveLength(1);
    await expect(
      restoreBackupAsNewGame(context, { bytes: file.bytes, name: ' ' }),
    ).rejects.toMatchObject({ code: 'invalidInput' });
    expect(await listAllGames(context)).toHaveLength(1);
  });

  it('[DATA-04] 截斷、未來版本與缺少關聯的備份被拒絕，資料不變', async () => {
    const { context, game } = await seededContext();
    const file = await exportBackup(context);
    const gamesBefore = await listAllGames(context);
    const countsBefore = await countGameRecords(context.database, game.id);
    const document = JSON.parse(
      new TextDecoder().decode(await gunzip(file.bytes)),
    ) as BackupDocument;
    const dangling = await buildBackupDocument({
      schemaVersion: document.schemaVersion,
      appVersion: document.appVersion,
      exportedAt: document.exportedAt,
      game: document.game,
      collections: {
        ...document.collections,
        mares: [
          {
            id: 'missing-horse',
            group: { kind: 'unassigned' },
            origin: 'other',
            status: 'producing',
            site: 32,
          },
        ],
      },
    });
    const rejectedFiles = [
      file.bytes.slice(0, Math.floor(file.bytes.length / 2)),
      jsonBytes({ ...document, schemaVersion: 99 }),
      jsonBytes(dangling),
    ];

    for (const bytes of rejectedFiles) {
      expect(await previewBackupFile(context, 'bad.json', bytes)).toMatchObject({ ok: false });
      await expect(restoreBackupAsNewGame(context, { bytes })).rejects.toMatchObject({
        code: 'backupRejected',
      });
    }
    expect(await listAllGames(context)).toEqual(gamesBefore);
    expect(await countGameRecords(context.database, game.id)).toEqual(countsBefore);
    expect((await getCurrentGame(context))?.id).toBe(game.id);
  });

  it('[DATA-05] 較舊結構版本的備份遷移後還原，並留下一筆遷移事件', async () => {
    const context = await openContext({ schemaVersion: 2, migrations: [RENAME_NAME] });
    const oldDocument = await buildBackupDocument({
      schemaVersion: 1,
      appVersion: '0.1.0',
      exportedAt: '2026-09-01T00:00:00.000Z',
      game: { name: '舊版局', startYear: 1968, currentYear: 1970 },
      collections: {
        ...emptyCollections(),
        gameSettings: [SYNTHETIC_SETTINGS],
        horses: [{ id: 'h1', name: 'テストウマ001', sex: 'male', stageNumbers: [], aliases: [] }],
      },
    });
    const bytes = jsonBytes(oldDocument);

    expect(await previewBackupFile(context, 'old.json', bytes)).toMatchObject({
      ok: true,
      migrated: true,
      sourceSchemaVersion: 1,
    });
    const restored = await restoreBackupAsNewGame(context, { bytes, name: '遷移後的局' });

    expect(restored).toMatchObject({ id: 'id-0001', name: '遷移後的局', currentYear: 1970 });
    expect(await readRecords(context.database, restored.id, 'horses')).toEqual([
      {
        id: 'h1',
        fullName: 'テストウマ001',
        sex: 'male',
        stageNumbers: [],
        aliases: [],
        nameKeys: [`${restored.id}\u001fテストウマ001`],
      },
    ]);
    expect(await readRecords(context.database, restored.id, 'events')).toEqual([
      {
        id: 'id-0002',
        subjectId: 'game',
        type: 'schemaMigrated',
        gameYear: 1970,
        before: { schemaVersion: 1 },
        after: { schemaVersion: 2 },
        source: 'migration',
        occurredAt: '2026-09-15T00:00:00.000Z',
      },
    ]);
  });

  it('還原寫入中途失敗時整筆退回，不留下新局', async () => {
    const { context: sourceContext } = await seededContext();
    const file = await exportBackup(sourceContext);

    const restoreIds = ['restored-game', 'event-1'];
    let restoreIdIndex = 0;
    const context = await openContext({
      schemaVersion: 2,
      migrations: [{ from: 1, migrate: (payload) => payload }],
      newId: () => {
        const id = restoreIds[restoreIdIndex];
        restoreIdIndex += 1;
        if (id === undefined) {
          throw new Error('newId 呼叫次數超出預期');
        }
        return id;
      },
    });
    const gamesBefore = await listAllGames(context);
    const currentBefore = await getCurrentGame(context);

    // 遷移事件的 id 與備份內既有的 event-1 相同，插入時以 ConstraintError 中止整筆交易。
    await expect(restoreBackupAsNewGame(context, { bytes: file.bytes })).rejects.toThrow(
      'constraint',
    );

    expect(await listAllGames(context)).toEqual(gamesBefore);
    expect(await getCurrentGame(context)).toEqual(currentBefore);
  });
});
