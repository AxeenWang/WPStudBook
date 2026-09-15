import { describe, expect, it } from 'vitest';
import { runEnvironmentCheck } from '../../src/services/environment-check.ts';

describe('runEnvironmentCheck（Node，無 IndexedDB）', () => {
  it('Node 24 具備 UUID、SHA-256、gzip 與 shift_jis 嚴格解碼', async () => {
    const report = await runEnvironmentCheck();
    expect(report).toMatchObject({
      randomUuid: true,
      sha256: true,
      compression: true,
      shiftJis: true,
    });
  });

  it('沒有安全環境旗標與 IndexedDB 時如實回報失敗與原因', async () => {
    const report = await runEnvironmentCheck();
    expect(report.secureContext).toBe(false);
    expect(report.indexedDb).toBe(false);
    expect(Object.keys(report.failures).sort()).toEqual(['indexedDb', 'secureContext']);
    expect(report.failures.secureContext).toBe('isSecureContext 不是 true');
    expect(report.failures.indexedDb).toContain('IndexedDB');
  });
});
