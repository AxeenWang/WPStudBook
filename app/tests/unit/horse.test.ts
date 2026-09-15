import { describe, expect, it } from 'vitest';
import { formatAbilityNo, parseAbilityNo, toBaseName } from '../../src/domain/horse.ts';

describe('能力番号', () => {
  it('接受 0x 開頭或不帶前綴的 1～4 位十六進位，0x0000 是有效值 0', () => {
    expect(parseAbilityNo('0x0000')).toBe(0);
    expect(parseAbilityNo('0X030f')).toBe(0x30f);
    expect(parseAbilityNo(' ffff ')).toBe(65535);
    expect(parseAbilityNo('7')).toBe(7);
  });

  it('其他文字回傳 undefined', () => {
    for (const text of ['', '0x', '0x10000', 'xyz', '-1', '12.5']) {
      expect(parseAbilityNo(text), text).toBeUndefined();
    }
  });

  it('顯示為 0x 開頭的 4 位大寫十六進位', () => {
    expect(formatAbilityNo(0)).toBe('0x0000');
    expect(formatAbilityNo(0x30f)).toBe('0x030F');
    expect(formatAbilityNo(65535)).toBe('0xFFFF');
  });
});

describe('基本馬名', () => {
  it('去除開頭的 (外)、[地] 前綴，其他位置的文字不變', () => {
    expect(toBaseName('(外)テストウマ')).toBe('テストウマ');
    expect(toBaseName('[地]テストウマ')).toBe('テストウマ');
    expect(toBaseName('(外)[地]テストウマ')).toBe('テストウマ');
    expect(toBaseName('テスト(外)ウマ')).toBe('テスト(外)ウマ');
    expect(toBaseName('テストウマ')).toBe('テストウマ');
  });

  it('前綴前後的空白一併去除；只有前綴與空白時為空字串；沒有前綴的馬名不修剪', () => {
    expect(toBaseName('(外) テストウマ')).toBe('テストウマ');
    expect(toBaseName(' (外) [地] テストウマ')).toBe('テストウマ');
    expect(toBaseName('(外) [地]')).toBe('');
    expect(toBaseName(' テストウマ ')).toBe(' テストウマ ');
    expect(toBaseName('(外)テスト ウマ')).toBe('テスト ウマ');
  });
});
