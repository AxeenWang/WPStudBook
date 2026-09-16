import { describe, expect, it } from 'vitest';
import {
  isPrefixOnlyName,
  mainValue,
  optionalText,
  parseHexNo,
  parseInteger,
  parseVitality,
  stripSystemSuffix,
} from '../../src/import/values.ts';

describe('欄位值正規化（需求規格 11.1、附錄 A）', () => {
  it('括號附加值取括號前主值', () => {
    expect(mainValue('72(72)')).toBe('72');
    expect(mainValue('42( +0)')).toBe('42');
    expect(mainValue('45')).toBe('45');
  });

  it('[IMP-17] 父系去掉結尾「系」', () => {
    expect(stripSystemSuffix('エクリプス系')).toBe('エクリプス');
    expect(stripSystemSuffix('エクリプス')).toBe('エクリプス');
    expect(stripSystemSuffix('系')).toBeUndefined();
    expect(stripSystemSuffix('   ')).toBeUndefined();
  });

  it('整數欄去掉千分位逗號', () => {
    expect(parseInteger('2,450')).toBe(2450);
    expect(parseInteger('42( +0)')).toBe(42);
    expect(parseInteger('0')).toBe(0);
    expect(parseInteger('')).toBeUndefined();
    expect(parseInteger('－')).toBeUndefined();
  });

  it('[ID-12] 能力番号與馬番号為十六進位，`0x0000` 是有效值', () => {
    expect(parseHexNo('0x0000')).toBe(0);
    expect(parseHexNo('0x030F')).toBe(783);
    expect(parseHexNo('0x7FFF')).toBe(32767);
    expect(parseHexNo('030F')).toBeUndefined();
    expect(parseHexNo('')).toBeUndefined();
  });

  it('活力可帶前置 `*` 表示増強', () => {
    expect(parseVitality('*13')).toEqual({ state: 'confirmed', value: 13, boosted: true });
    expect(parseVitality('100')).toEqual({ state: 'confirmed', value: 100, boosted: false });
    expect(parseVitality('101')).toBeUndefined();
    expect(parseVitality('')).toBeUndefined();
  });

  it('只有空白的欄位視為未取得，有內容時不修剪', () => {
    expect(optionalText('   ')).toBeUndefined();
    expect(optionalText(undefined)).toBeUndefined();
    expect(optionalText(' 3 1 0 0 ')).toBe(' 3 1 0 0 ');
  });

  it('只有 `(外)`、`[地]` 前綴而沒有馬名時是資料異常（需求規格 6.4）', () => {
    expect(isPrefixOnlyName('(外)')).toBe(true);
    expect(isPrefixOnlyName('[地] ')).toBe(true);
    expect(isPrefixOnlyName('(外)テストウマ001')).toBe(false);
    expect(isPrefixOnlyName('テストウマ001')).toBe(false);
    expect(isPrefixOnlyName('  ')).toBe(false);
  });
});
