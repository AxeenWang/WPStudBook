import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LINE_COLOR,
  LINE_COLORS,
  isLinePosition,
  pickLineColor,
} from '../../src/domain/line.ts';
import { parentSystemOf, stripSystemSuffix } from '../../src/domain/system-map.ts';

describe('系位置與代表色', () => {
  it('系位置只接受 1～8 的整數', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].every((value) => isLinePosition(value))).toBe(true);
    expect([0, 9, 1.5].some((value) => isLinePosition(value))).toBe(false);
  });

  it('預設色有 8 個不重複的小寫 #rrggbb，第一色是預設代表色', () => {
    const values = LINE_COLORS.map((color) => color.value);
    expect(values).toHaveLength(8);
    expect(new Set(values).size).toBe(8);
    expect(values.every((value) => /^#[0-9a-f]{6}$/.test(value))).toBe(true);
    expect(values[0]).toBe(DEFAULT_LINE_COLOR);
  });

  it('依序分配第一個尚未使用的顏色（不分大小寫），全部用過時取預設代表色', () => {
    expect(pickLineColor([])).toBe('#c62828');
    expect(pickLineColor(['#C62828'])).toBe('#ef6c00');
    expect(pickLineColor(LINE_COLORS.map((color) => color.value))).toBe(DEFAULT_LINE_COLOR);
  });
});

describe('系統對照表', () => {
  it('系統名稱去掉結尾一個「系」，其他文字不變', () => {
    expect(stripSystemSuffix('エクリプス系')).toBe('エクリプス');
    expect(stripSystemSuffix('エクリプス')).toBe('エクリプス');
    expect(stripSystemSuffix('テスト系系')).toBe('テスト系');
  });

  it('從對照表取得子系統的親系統，查不到時回傳 undefined', () => {
    const entries = [
      { id: 'm1', subsystem: 'マンノウォー', parentSystem: 'マッチェム' },
      { id: 'm2', subsystem: 'ネアルコ', parentSystem: 'ネアルコ' },
    ];
    expect(parentSystemOf(entries, 'マンノウォー')).toBe('マッチェム');
    expect(parentSystemOf(entries, 'ハンプトン')).toBeUndefined();
  });
});
