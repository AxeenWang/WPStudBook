import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, vi } from 'vitest';
import {
  closeServiceContext,
  openServiceContext,
  type OpenServiceContextOptions,
  type ServiceContext,
} from '../../src/services/context.ts';

/** 每次呼叫加 1 秒，讓時間欄位可以精確比對。 */
export function fixedClock(start = '2026-09-15T00:00:00.000Z'): () => Date {
  let tick = 0;
  return () => {
    const date = new Date(Date.parse(start) + tick * 1000);
    tick += 1;
    return date;
  };
}

export function sequentialIds(prefix = 'id'): () => string {
  let count = 0;
  return () => {
    count += 1;
    return `${prefix}-${String(count).padStart(4, '0')}`;
  };
}

/** 在 describe 內呼叫：每個測試使用全新 IndexedDB，測試結束時關閉開啟過的服務環境。 */
export function useServiceContexts(): (
  overrides?: Partial<OpenServiceContextOptions>,
) => Promise<ServiceContext> {
  const opened: ServiceContext[] = [];
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
  });
  afterEach(() => {
    for (const context of opened.splice(0)) {
      closeServiceContext(context);
    }
    vi.unstubAllGlobals();
  });
  return async (overrides = {}) => {
    const context = await openServiceContext({
      appVersion: '0.0.0-test',
      now: fixedClock(),
      newId: sequentialIds(),
      ...overrides,
    });
    opened.push(context);
    return context;
  };
}
