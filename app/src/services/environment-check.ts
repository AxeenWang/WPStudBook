import { probeAppDatabase } from '../storage/database.ts';

export const ENVIRONMENT_CHECK_KEYS = [
  'secureContext',
  'randomUuid',
  'sha256',
  'compression',
  'shiftJis',
  'indexedDb',
] as const;

export type EnvironmentCheckKey = (typeof ENVIRONMENT_CHECK_KEYS)[number];

export interface EnvironmentReport extends Readonly<Record<EnvironmentCheckKey, boolean>> {
  readonly failures: Readonly<Partial<Record<EnvironmentCheckKey, string>>>;
}

type CheckResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const PASSED: CheckResult = { ok: true };

const SHA256_INPUT = 'WPStudBook';
const SHA256_EXPECTED = '3438fdae4a98583178c51b7ee0e4d62813c2e016eca4f7e28e3f42fa621c1c11';
const CP932_SAMPLE = new Uint8Array([0x83, 0x65, 0x83, 0x58, 0x83, 0x67, 0x94, 0x6e]);
const CP932_SAMPLE_TEXT = 'テスト馬';
const CP932_TRUNCATED = new Uint8Array([0x83]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function failed(reason: string): CheckResult {
  return { ok: false, reason };
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function checkSecureContext(): CheckResult {
  const secure: unknown = Reflect.get(globalThis, 'isSecureContext');
  return secure === true ? PASSED : failed('isSecureContext 不是 true');
}

function checkRandomUuid(): CheckResult {
  try {
    const uuid = crypto.randomUUID();
    return UUID_V4.test(uuid) ? PASSED : failed(`產生的值不是 UUID v4：${uuid}`);
  } catch (error) {
    return failed(describeError(error));
  }
}

async function checkSha256(): Promise<CheckResult> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(SHA256_INPUT));
    const actual = toHex(digest);
    return actual === SHA256_EXPECTED ? PASSED : failed(`SHA-256 結果不符：${actual}`);
  } catch (error) {
    return failed(describeError(error));
  }
}

async function checkCompression(): Promise<CheckResult> {
  try {
    const text = SHA256_INPUT.repeat(20);
    const compressed = await new Response(
      new Blob([new TextEncoder().encode(text)])
        .stream()
        .pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer();
    const header = new Uint8Array(compressed, 0, 2);
    if (header[0] !== 0x1f || header[1] !== 0x8b) {
      return failed('壓縮結果沒有 gzip 檔頭');
    }
    const restored = await new Response(
      new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')),
    ).text();
    return restored === text ? PASSED : failed('解壓後內容與原文不同');
  } catch (error) {
    return failed(describeError(error));
  }
}

function checkShiftJis(): CheckResult {
  try {
    const decoded = new TextDecoder('shift_jis', { fatal: true }).decode(CP932_SAMPLE);
    if (decoded !== CP932_SAMPLE_TEXT) {
      return failed(`CP932 解碼結果不符：${decoded}`);
    }
  } catch (error) {
    return failed(describeError(error));
  }
  try {
    new TextDecoder('shift_jis', { fatal: true }).decode(CP932_TRUNCATED);
    return failed('不完整的位元組沒有觸發嚴格解碼錯誤');
  } catch {
    // 預期結果：嚴格模式遇到不完整的位元組必須丟出錯誤。
    return PASSED;
  }
}

async function checkIndexedDb(): Promise<CheckResult> {
  try {
    await probeAppDatabase();
    return PASSED;
  } catch (error) {
    return failed(describeError(error));
  }
}

export async function runEnvironmentCheck(): Promise<EnvironmentReport> {
  const [sha256, compression, database] = await Promise.all([
    checkSha256(),
    checkCompression(),
    checkIndexedDb(),
  ]);
  const results: Readonly<Record<EnvironmentCheckKey, CheckResult>> = {
    secureContext: checkSecureContext(),
    randomUuid: checkRandomUuid(),
    sha256,
    compression,
    shiftJis: checkShiftJis(),
    indexedDb: database,
  };

  const failures: Partial<Record<EnvironmentCheckKey, string>> = {};
  for (const key of ENVIRONMENT_CHECK_KEYS) {
    const result = results[key];
    if (!result.ok) {
      failures[key] = result.reason;
    }
  }

  return {
    secureContext: results.secureContext.ok,
    randomUuid: results.randomUuid.ok,
    sha256: results.sha256.ok,
    compression: results.compression.ok,
    shiftJis: results.shiftJis.ok,
    indexedDb: results.indexedDb.ok,
    failures,
  };
}
