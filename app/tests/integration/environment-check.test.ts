import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runEnvironmentCheck } from '../../src/services/environment-check.ts';

describe('runEnvironmentCheck（有 IndexedDB）', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('IndexedDB 可用時回報通過，失敗清單只剩安全環境', async () => {
    const report = await runEnvironmentCheck();
    expect(report.indexedDb).toBe(true);
    expect(report.failures).toEqual({ secureContext: 'isSecureContext 不是 true' });
  });
});
