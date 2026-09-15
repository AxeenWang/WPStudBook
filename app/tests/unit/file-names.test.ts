import { describe, expect, it } from 'vitest';
import { backupFileName, rawExportFileName } from '../../src/services/file-names.ts';

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

describe('rawExportFileName', () => {
  it('標示原始資料不能還原，一律用 .json，局名的處理與備份檔名相同', () => {
    expect(rawExportFileName(BASE)).toBe(
      'WPStudBook_テスト局_1969年_20260915-010203_原始資料_不能還原.json',
    );
    expect(rawExportFileName({ ...BASE, gameName: 'a/b. ' })).toBe(
      'WPStudBook_a_b_1969年_20260915-010203_原始資料_不能還原.json',
    );
  });
});
