import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeBackup, type DecodeResult } from '../../src/storage/backup/decode.ts';
import {
  buildBackupDocument,
  computeBackupHash,
  emptyCollections,
  encodeBackupDocument,
  type BackupCollections,
  type BackupDocument,
} from '../../src/storage/backup/document.ts';
import { migrateBackupPayload, type BackupMigration } from '../../src/storage/backup/migrations.ts';
import { SCHEMA_VERSION } from '../../src/storage/schema.ts';

const GAME = { name: 'テスト局', startYear: 1968, currentYear: 1969 };
const OPTIONS = { schemaVersion: SCHEMA_VERSION, migrations: [] };
const SETTINGS = {
  retirementAge: 25,
  highAgeReminderAge: 18,
  stallionAgeReminderAge: 26,
  checkpointRetention: 15,
  display: {},
};

function validCollections(): BackupCollections {
  return {
    ...emptyCollections(),
    gameSettings: [SETTINGS],
    horses: [
      { id: 'h1', fullName: 'テストウマ001', abilityNo: 0, birthYear: 1965 },
      { id: 'h2', fullName: 'テストウマ002', damId: 'h1', birthYear: 1970 },
    ],
  };
}

async function documentWith(
  overrides: Partial<Parameters<typeof buildBackupDocument>[0]> = {},
): Promise<BackupDocument> {
  return buildBackupDocument({
    schemaVersion: 1,
    appVersion: '0.2.0',
    exportedAt: '2026-09-15T00:00:00.000Z',
    game: GAME,
    collections: validCollections(),
    ...overrides,
  });
}

function jsonBytes(value: unknown): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(value));
}

function failure(result: DecodeResult): { stage: string; codes: string[] } {
  if (result.ok) {
    throw new Error('預期解碼失敗，實際成功');
  }
  return { stage: result.stage, codes: result.issues.map((item) => item.code) };
}

describe('decodeBackup', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gzip 與未壓縮 JSON 解碼出相同文件，並回報來源資訊', async () => {
    const document = await documentWith();
    const gzipped = await encodeBackupDocument(document);
    const fromGzip = await decodeBackup(gzipped.bytes, OPTIONS);
    const fromJson = await decodeBackup(jsonBytes(document), OPTIONS);
    expect(fromGzip.ok && fromJson.ok).toBe(true);
    if (fromGzip.ok && fromJson.ok) {
      expect(fromGzip.backup.document).toEqual(document);
      expect(fromJson.backup.document).toEqual(document);
      expect(fromGzip.backup).toMatchObject({
        compressed: true,
        sizeBytes: gzipped.bytes.length,
        sourceSchemaVersion: 1,
        sourceAppVersion: '0.2.0',
        sourceSha256: document.sha256,
      });
      expect(fromJson.backup.compressed).toBe(false);
    }
  });

  it('[DATA-04] 截斷的 gzip 與內容錯誤的 gzip 在解析階段拒絕', async () => {
    const gzipped = (await encodeBackupDocument(await documentWith())).bytes;
    const truncated = gzipped.slice(0, Math.floor(gzipped.length / 2));
    const broken = new Uint8Array([0x1f, 0x8b, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(failure(await decodeBackup(truncated, OPTIONS))).toEqual({
      stage: 'parse',
      codes: ['decompressFailed'],
    });
    expect(failure(await decodeBackup(broken, OPTIONS))).toEqual({
      stage: 'parse',
      codes: ['decompressFailed'],
    });
  });

  it('[DATA-04] 截斷的 JSON、非 UTF-8 文字在解析階段拒絕', async () => {
    const text = JSON.stringify(await documentWith());
    const truncated = new TextEncoder().encode(text.slice(0, Math.floor(text.length / 2)));
    expect(failure(await decodeBackup(truncated, OPTIONS)).codes).toEqual(['invalidJson']);
    expect(failure(await decodeBackup(new Uint8Array([0x7b, 0xff, 0x7d]), OPTIONS)).codes).toEqual([
      'notUtf8',
    ]);
  });

  it('不支援解壓縮時拒絕 gzip 備份並提示改用 JSON', async () => {
    const gzipped = (await encodeBackupDocument(await documentWith())).bytes;
    vi.stubGlobal('DecompressionStream', undefined);
    expect(failure(await decodeBackup(gzipped, OPTIONS)).codes).toEqual(['gzipUnsupported']);
  });

  it('格式識別不符或必要欄位缺少時拒絕', async () => {
    const document = await documentWith();
    expect(
      failure(await decodeBackup(jsonBytes({ ...document, format: 'other' }), OPTIONS)),
    ).toEqual({
      stage: 'envelope',
      codes: ['wrongFormat'],
    });
    expect(
      failure(await decodeBackup(jsonBytes({ ...document, sha256: 'x' }), OPTIONS)).codes,
    ).toEqual(['envelopeInvalid']);
  });

  it('[DATA-04] 結構版本比程式新時拒絕', async () => {
    const future = await documentWith({ schemaVersion: SCHEMA_VERSION + 1 });
    expect(failure(await decodeBackup(jsonBytes(future), OPTIONS))).toEqual({
      stage: 'envelope',
      codes: ['futureVersion'],
    });
  });

  it('筆數與內容不符時拒絕', async () => {
    const document = await documentWith();
    const tampered = { ...document, counts: { ...document.counts, horses: 3 } };
    expect(failure(await decodeBackup(jsonBytes(tampered), OPTIONS))).toEqual({
      stage: 'counts',
      codes: ['countMismatch'],
    });
  });

  it('game 摘要或資料被修改時雜湊不符而拒絕', async () => {
    const document = await documentWith();
    const tampered = { ...document, game: { ...document.game, currentYear: 1990 } };
    expect(failure(await decodeBackup(jsonBytes(tampered), OPTIONS))).toEqual({
      stage: 'hash',
      codes: ['hashMismatch'],
    });
  });

  it('[DATA-04] 重複識別與缺少關聯在識別與關聯階段拒絕', async () => {
    const duplicated = await documentWith({
      collections: { ...validCollections(), lines: [{ id: 'l1' }, { id: 'l1' }] },
    });
    const dangling = await documentWith({
      collections: { ...validCollections(), mares: [{ id: 'missing-horse' }] },
    });
    expect(failure(await decodeBackup(jsonBytes(duplicated), OPTIONS))).toEqual({
      stage: 'relations',
      codes: ['duplicateId'],
    });
    expect(failure(await decodeBackup(jsonBytes(dangling), OPTIONS))).toEqual({
      stage: 'relations',
      codes: ['missingReference'],
    });
  });

  it('匯入時忽略 horses.nameKeys', async () => {
    const collections = validCollections();
    const withNameKeys = await documentWith({
      collections: {
        ...collections,
        horses: collections.horses.map((horse) => ({ ...horse, nameKeys: ['oldx'] })),
      },
    });
    const result = await decodeBackup(jsonBytes(withNameKeys), OPTIONS);
    expect(result.ok && result.backup.document.collections.horses).toEqual(collections.horses);
  });
});

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

const ADD_THEME: BackupMigration = {
  from: 2,
  migrate: (payload) => ({
    ...payload,
    collections: {
      ...payload.collections,
      gameSettings: (payload.collections.gameSettings as Record<string, unknown>[]).map(
        (settings) => ({ ...settings, display: { theme: 'light' } }),
      ),
    },
  }),
};

describe('結構版本遷移', () => {
  it('[DATA-05] 較舊版本逐版遷移到目前版本，並重新計算筆數與雜湊', async () => {
    const old = await documentWith({
      collections: {
        ...validCollections(),
        horses: [{ id: 'h1', name: 'テストウマ001', abilityNo: 0, birthYear: 1965 }],
      },
    });
    const result = await decodeBackup(jsonBytes(old), {
      schemaVersion: 3,
      migrations: [ADD_THEME, RENAME_NAME],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const { document } = result.backup;
      expect(result.backup.sourceSchemaVersion).toBe(1);
      expect(result.backup.sourceSha256).toBe(old.sha256);
      expect(document.schemaVersion).toBe(3);
      expect(document.collections.horses).toEqual([
        { id: 'h1', fullName: 'テストウマ001', abilityNo: 0, birthYear: 1965 },
      ]);
      expect(document.collections.gameSettings[0]?.display).toEqual({ theme: 'light' });
      expect(document.sha256).toBe(await computeBackupHash(document.game, document.collections));
    }
  });

  it('[DATA-05] 缺少某一版的遷移時拒絕', async () => {
    const old = await documentWith();
    expect(
      failure(await decodeBackup(jsonBytes(old), { schemaVersion: 3, migrations: [RENAME_NAME] })),
    ).toEqual({ stage: 'migration', codes: ['unsupportedVersion'] });
  });

  it('遷移函式丟出錯誤時回報 migrationFailed，不往外丟出例外', () => {
    const result = migrateBackupPayload({ game: GAME, collections: {} }, 1, 2, [
      {
        from: 1,
        migrate: () => {
          throw new Error('壞掉的遷移');
        },
      },
    ]);
    expect(result).toMatchObject({ ok: false, code: 'migrationFailed' });
  });
});
