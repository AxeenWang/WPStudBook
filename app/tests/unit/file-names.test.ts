import { describe, expect, it } from 'vitest';
import { backupFileName } from '../../src/services/file-names.ts';

const BASE = { gameName: 'テスト局', currentYear: 1969, exportedAt: '2026-09-15T01:02:03.456Z' };

describe('backupFileName', () => {
  it('包含局名、目前遊戲年與 UTC 匯出時間，壓縮時用 .json.gz', () => {
    expect(backupFileName({ ...BASE, compressed: true })).toBe(
      'WPStudBook_テスト局_1969年_20260915-010203.json.gz',
    );
  });

  it('[DATA-06] 未壓縮時用 .json', () => {
    expect(backupFileName({ ...BASE, compressed: false })).toBe(
      'WPStudBook_テスト局_1969年_20260915-010203.json',
    );
  });

  it('Windows 檔名不允許的字元換成底線，並去掉結尾的點與空白', () => {
    expect(backupFileName({ ...BASE, gameName: 'a/b:c*?"<>|\td. ', compressed: true })).toBe(
      'WPStudBook_a_b_c_______d_1969年_20260915-010203.json.gz',
    );
  });

  it('局名被去掉後為空時用 game', () => {
    expect(backupFileName({ ...BASE, gameName: '. .', compressed: true })).toBe(
      'WPStudBook_game_1969年_20260915-010203.json.gz',
    );
  });
});
