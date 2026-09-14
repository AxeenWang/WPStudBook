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

  it('IndexedDB 可用時回報通過並帶出探測次數，失敗清單只剩安全環境', async () => {
    const first = await runEnvironmentCheck();
    expect(first.indexedDb).toBe(true);
    expect(first.probeCount).toBe(1);
    expect(first.failures).toEqual({ secureContext: 'isSecureContext 不是 true' });
    const second = await runEnvironmentCheck();
    expect(second.probeCount).toBe(2);
  });
});
