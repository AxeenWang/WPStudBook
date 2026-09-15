import { describe, expect, it } from 'vitest';
import { CanonicalJsonError, canonicalJson } from '../../src/storage/backup/canonical-json.ts';

describe('canonicalJson', () => {
  it('欄位名依 UTF-16 字典序排序、陣列保持原順序、不含空白', () => {
    expect(canonicalJson({ b: 1, a: [3, 1, 2], ア: 'カナ', Z: true })).toBe(
      '{"Z":true,"a":[3,1,2],"b":1,"ア":"カナ"}',
    );
  });

  it('同樣的資料不論欄位順序都得到同樣的字串', () => {
    expect(canonicalJson({ a: 1, b: { d: 2, c: 3 } })).toBe(
      canonicalJson({ b: { c: 3, d: 2 }, a: 1 }),
    );
  });

  it('[DATA-03] 日文、中文、特殊字元、0、空字串與 false 保持原值，值為 undefined 的欄位視為不存在', () => {
    const text = canonicalJson({
      name: 'テスト馬「特殊」&<>"\\/\n',
      note: '中文備註',
      zero: 0,
      empty: '',
      no: false,
      unknown: undefined,
      nested: { list: [0, '', false] },
    });
    expect(JSON.parse(text)).toStrictEqual({
      empty: '',
      name: 'テスト馬「特殊」&<>"\\/\n',
      nested: { list: [0, '', false] },
      no: false,
      note: '中文備註',
      zero: 0,
    });
    expect(text).not.toContain('unknown');
  });

  it('null 依 JSON 輸出，由欄位驗證決定是否接受', () => {
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
  });

  it.each([
    ['NaN', { a: Number.NaN }],
    ['Infinity', { a: Number.POSITIVE_INFINITY }],
    ['陣列中的 undefined', { a: [undefined] }],
    ['Date', { a: new Date(0) }],
    ['Map', { a: new Map() }],
    ['bigint', { a: 1n }],
  ])('無法以 JSON 表示的值（%s）丟出 CanonicalJsonError', (_label, value) => {
    expect(() => canonicalJson(value)).toThrow(CanonicalJsonError);
  });
});
