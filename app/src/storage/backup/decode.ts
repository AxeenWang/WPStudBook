import { describeError } from '../describe-error.ts';
import { isPlainRecord, type StoredRecord } from '../records.ts';
import {
  readGameSummary,
  validateCollections,
  type BackupIssue,
  type BackupIssueCode,
} from './collections.ts';
import {
  BACKUP_FORMAT,
  buildBackupDocument,
  computeBackupHash,
  type BackupDocument,
} from './document.ts';
import { canDecompress, gunzip, isGzip } from './gzip.ts';
import { migrateBackupPayload, type BackupMigration } from './migrations.ts';

export type DecodeStage =
  'parse' | 'envelope' | 'counts' | 'hash' | 'migration' | 'fields' | 'relations';

export interface DecodeOptions {
  readonly schemaVersion: number;
  readonly migrations: readonly BackupMigration[];
}

export interface DecodedBackup {
  /** 已遷移到目前版本並通過驗證；counts 與 sha256 依遷移後內容重新計算。 */
  readonly document: BackupDocument;
  readonly sourceSchemaVersion: number;
  readonly sourceAppVersion: string;
  readonly sourceSha256: string;
  readonly compressed: boolean;
  readonly sizeBytes: number;
}

interface Rejected {
  readonly ok: false;
  readonly stage: DecodeStage;
  readonly issues: readonly BackupIssue[];
}

export type DecodeResult = { readonly ok: true; readonly backup: DecodedBackup } | Rejected;

interface Envelope {
  readonly schemaVersion: number;
  readonly appVersion: string;
  readonly exportedAt: string;
  readonly game: unknown;
  readonly counts: StoredRecord;
  readonly sha256: string;
  readonly collections: StoredRecord;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

function rejected(stage: DecodeStage, code: BackupIssueCode, message: string): Rejected {
  return { ok: false, stage, issues: [{ code, message }] };
}

/** 設計決策 5.4 節：解析 → 格式與版本 → 筆數 → 雜湊 → 遷移 → 欄位 → 識別與關聯。 */
export async function decodeBackup(
  bytes: Uint8Array<ArrayBuffer>,
  options: DecodeOptions,
): Promise<DecodeResult> {
  const compressed = isGzip(bytes);
  const parsed = await parseBytes(bytes, compressed);
  if (!parsed.ok) {
    return parsed;
  }
  const envelope = readEnvelope(parsed.value, options.schemaVersion);
  if (!envelope.ok) {
    return envelope;
  }
  const source = envelope.value;
  const countIssues = checkCounts(source.counts, source.collections);
  if (countIssues.length > 0) {
    return { ok: false, stage: 'counts', issues: countIssues };
  }
  if ((await computeBackupHash(source.game, source.collections)) !== source.sha256) {
    return rejected('hash', 'hashMismatch', 'SHA-256 不符：檔案內容已被修改或損壞');
  }
  const migrated = migrateBackupPayload(
    { game: source.game, collections: source.collections },
    source.schemaVersion,
    options.schemaVersion,
    options.migrations,
  );
  if (!migrated.ok) {
    return rejected('migration', migrated.code, migrated.message);
  }
  const summary = readGameSummary(migrated.payload.game);
  if (!summary.ok) {
    return { ok: false, stage: 'fields', issues: summary.issues };
  }
  const validation = validateCollections(migrated.payload.collections);
  if (!validation.ok) {
    return { ok: false, stage: validation.stage, issues: validation.issues };
  }
  const document = await buildBackupDocument({
    schemaVersion: options.schemaVersion,
    appVersion: source.appVersion,
    exportedAt: source.exportedAt,
    game: summary.game,
    collections: validation.collections,
  });
  return {
    ok: true,
    backup: {
      document,
      sourceSchemaVersion: source.schemaVersion,
      sourceAppVersion: source.appVersion,
      sourceSha256: source.sha256,
      compressed,
      sizeBytes: bytes.length,
    },
  };
}

async function parseBytes(
  bytes: Uint8Array<ArrayBuffer>,
  compressed: boolean,
): Promise<{ readonly ok: true; readonly value: unknown } | Rejected> {
  let jsonBytes = bytes;
  if (compressed) {
    if (!canDecompress()) {
      return rejected('parse', 'gzipUnsupported', '此瀏覽器不支援解壓縮 gzip，請改用 .json 備份檔');
    }
    try {
      jsonBytes = await gunzip(bytes);
    } catch (error) {
      return rejected(
        'parse',
        'decompressFailed',
        `gzip 解壓縮失敗，檔案可能已截斷或損壞：${describeError(error)}`,
      );
    }
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(jsonBytes);
  } catch {
    return rejected('parse', 'notUtf8', '檔案不是 UTF-8 文字');
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return rejected(
      'parse',
      'invalidJson',
      `JSON 格式錯誤，檔案可能已截斷：${describeError(error)}`,
    );
  }
}

function readEnvelope(
  value: unknown,
  currentVersion: number,
): { readonly ok: true; readonly value: Envelope } | Rejected {
  if (!isPlainRecord(value) || value.format !== BACKUP_FORMAT) {
    return rejected(
      'envelope',
      'wrongFormat',
      `不是 WPStudBook 備份檔（format 不是 ${BACKUP_FORMAT}）`,
    );
  }
  const { schemaVersion, appVersion, exportedAt, game, counts, sha256, collections } = value;
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    return rejected('envelope', 'envelopeInvalid', 'schemaVersion 必須是 1 以上的整數');
  }
  if (schemaVersion > currentVersion) {
    return rejected(
      'envelope',
      'futureVersion',
      `備份的結構版本 ${String(schemaVersion)} 比目前程式支援的 ${String(currentVersion)} 新，請改用較新版本的 WPStudBook.html`,
    );
  }
  if (
    typeof appVersion !== 'string' ||
    typeof exportedAt !== 'string' ||
    typeof sha256 !== 'string' ||
    !SHA256_HEX.test(sha256) ||
    !isPlainRecord(counts) ||
    !isPlainRecord(collections)
  ) {
    return rejected(
      'envelope',
      'envelopeInvalid',
      '備份檔缺少必要欄位或型別錯誤（appVersion、exportedAt、sha256、counts、collections）',
    );
  }
  return {
    ok: true,
    value: { schemaVersion, appVersion, exportedAt, game, counts, sha256, collections },
  };
}

function checkCounts(counts: StoredRecord, collections: StoredRecord): BackupIssue[] {
  const names = new Set([...Object.keys(counts), ...Object.keys(collections)]);
  const issues: BackupIssue[] = [];
  for (const name of names) {
    const records = collections[name];
    const expected = counts[name];
    const actual = Array.isArray(records) ? records.length : undefined;
    if (actual === undefined || expected !== actual) {
      const expectedText = expected === undefined ? '未列出' : JSON.stringify(expected);
      const actualText = actual === undefined ? '不是陣列或不存在' : String(actual);
      issues.push({
        code: 'countMismatch',
        message: `資料表 ${name} 的筆數不符：counts 為 ${expectedText}，實際為 ${actualText}`,
      });
    }
  }
  return issues;
}
