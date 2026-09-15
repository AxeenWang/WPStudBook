import { describe, expect, it } from 'vitest';
import {
  errorMessage,
  formatBytes,
  formatCount,
  formatDateTime,
  formatGeneration,
} from '../../src/ui/format.ts';

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
  it('代數文字：0 零代、1 初代，之後二代、十代、十一代、三十五代；100 以上用數字', () => {
    expect([0, 1, 2, 10, 11, 20, 35, 99].map(formatGeneration)).toEqual([
      '零代',
      '初代',
      '二代',
      '十代',
      '十一代',
      '二十代',
      '三十五代',
      '九十九代',
    ]);
    expect(formatGeneration(100)).toBe('100 代');
  });
});
