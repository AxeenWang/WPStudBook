import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { incrementProbeCounter } from '../../src/storage/probe-counter.ts';

describe('incrementProbeCounter', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('每次呼叫加 1，數值保存在 IndexedDB', async () => {
    expect(await incrementProbeCounter()).toBe(1);
    expect(await incrementProbeCounter()).toBe(2);
  });

  it('全新的資料庫從 1 開始', async () => {
    expect(await incrementProbeCounter()).toBe(1);
  });
});
