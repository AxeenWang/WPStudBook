import { describe, expect, it } from 'vitest';
import { errorMessage, formatBytes, formatCount, formatDateTime } from '../../src/ui/format.ts';

describe('介面顯示格式', () => {
  it('位元組依大小顯示 B、KB、MB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('ISO 時間轉成本地時間，無法解析時原樣顯示', () => {
    expect(formatDateTime(new Date(2026, 8, 15, 1, 2, 3).toISOString())).toBe(
      '2026-09-15 01:02:03',
    );
    expect(formatDateTime('不是時間')).toBe('不是時間');
  });

  it('筆數加上千分位與單位', () => {
    expect(formatCount(0)).toBe('0 筆');
    expect(formatCount(12345)).toBe('12,345 筆');
  });

  it('錯誤訊息取 message，其他值轉成文字', () => {
    expect(errorMessage(new Error('失敗了'))).toBe('失敗了');
    expect(errorMessage('文字')).toBe('文字');
  });
});
