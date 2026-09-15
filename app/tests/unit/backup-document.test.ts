import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BACKUP_FORMAT,
  buildBackupDocument,
  computeBackupHash,
  emptyCollections,
  encodeBackupDocument,
  type BackupCollections,
  type BackupDocument,
} from '../../src/storage/backup/document.ts';
import { gunzip, isGzip } from '../../src/storage/backup/gzip.ts';

const GAME = { name: 'テスト局', startYear: 1968, currentYear: 1969 };

function collectionsWith(overrides: Partial<BackupCollections>): BackupCollections {
  return { ...emptyCollections(), ...overrides };
}

async function sampleDocument(): Promise<BackupDocument> {
  return buildBackupDocument({
    schemaVersion: 1,
    appVersion: '0.2.0',
    exportedAt: '2026-09-15T00:00:00.000Z',
    game: GAME,
    collections: collectionsWith({
      gameSettings: [{ retirementAge: 25 }],
      lines: [{ id: 'a', position: 1 }],
    }),
  });
}

function decodeText(bytes: Uint8Array<ArrayBuffer>): unknown {
  return JSON.parse(new TextDecoder().decode(bytes));
}

describe('備份文件', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('雜湊以 { game, collections } 的標準化 JSON 計算，紀錄依 id 排序', async () => {
    const hash = await computeBackupHash(GAME, {
      lines: [
        { position: 2, id: 'b' },
        { id: 'a', position: 1 },
      ],
    });
    // sha256('{"collections":{"lines":[{"id":"a","position":1},{"id":"b","position":2}]},"game":{"currentYear":1969,"name":"テスト局","startYear":1968}}')
    expect(hash).toBe('bcb28e413c379706868ce4792133d821b895dc3759102cf5e1d3c47ab2c41468');
  });

  it('game 摘要改變時雜湊不同', async () => {
    const collections = { lines: [{ id: 'a', position: 1 }] };
    expect(await computeBackupHash(GAME, collections)).not.toBe(
      await computeBackupHash({ ...GAME, currentYear: 1970 }, collections),
    );
  });

  it('組成文件：格式、版本、時間、每個資料表的筆數與雜湊', async () => {
    const document = await sampleDocument();
    expect(document).toMatchObject({
      format: BACKUP_FORMAT,
      schemaVersion: 1,
      appVersion: '0.2.0',
      exportedAt: '2026-09-15T00:00:00.000Z',
      game: GAME,
    });
    expect(Object.keys(document.counts).sort()).toEqual(Object.keys(document.collections).sort());
    expect(document.counts).toMatchObject({ gameSettings: 1, lines: 1, horses: 0 });
    expect(document.sha256).toBe(await computeBackupHash(GAME, document.collections));
  });

  it('支援 CompressionStream 時輸出 gzip，解壓後就是文件 JSON', async () => {
    const document = await sampleDocument();
    const encoded = await encodeBackupDocument(document);
    expect(encoded.compressed).toBe(true);
    expect(isGzip(encoded.bytes)).toBe(true);
    expect(decodeText(await gunzip(encoded.bytes))).toEqual(document);
  });

  it('[DATA-06] 不支援 CompressionStream 時輸出未壓縮的 JSON', async () => {
    const document = await sampleDocument();
    vi.stubGlobal('CompressionStream', undefined);
    const encoded = await encodeBackupDocument(document);
    expect(encoded.compressed).toBe(false);
    expect(isGzip(encoded.bytes)).toBe(false);
    expect(decodeText(encoded.bytes)).toEqual(document);
  });
});
