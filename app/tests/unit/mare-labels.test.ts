import { describe, expect, it } from 'vitest';
import {
  ORIGIN_LABELS,
  SITE_LABELS,
  YEAR_PLAN_LABELS,
  formatGenerationTab,
  formatGroupTitle,
  formatMareGroup,
  formatStatus,
  formatVitality,
} from '../../src/ui/mares/labels.ts';

describe('母馬的介面文字', () => {
  it('[LINE-07] 起點市場母馬顯示「第 1 系起點用」，替代母馬顯示「替代第 q 系 N 代」，不顯示為屬於該系', () => {
    expect(formatMareGroup({ kind: 'starter', position: 1, generation: 0 })).toBe('第 1 系起點用');
    expect(formatMareGroup({ kind: 'substitute', position: 3, generation: 6 })).toBe(
      '替代第 3 系 6 代',
    );
    expect(formatMareGroup({ kind: 'own', position: 3, generation: 6 })).toBe('第 3 系 6 代');
    expect(formatMareGroup({ kind: 'unassigned' })).toBe('待指定用途');
    expect(formatGroupTitle(1, 0)).toBe('第 1 系起點母馬群');
    expect(formatGroupTitle(3, 6)).toBe('第 3 系 6 代母馬群');
    expect(formatGroupTitle(3, 'all')).toBe('第 3 系母馬群（全部代數）');
    expect([formatGenerationTab(1, 0), formatGenerationTab(2, 1)]).toEqual(['起點', '1 代']);
  });

  it('[MARE-18] 繋養牧場番号 32～35 顯示為日本、分場（俱樂部牧場）、美國、歐洲', () => {
    expect(SITE_LABELS).toEqual({ 32: '日本', 33: '分場（俱樂部牧場）', 34: '美國', 35: '歐洲' });
  });

  it('[MARE-13] 活力顯示數值、増強與月份；待更新與不適用不顯示為 0', () => {
    expect(formatVitality({ state: 'confirmed', value: 0, boosted: false }, 5)).toBe('0（5 月）');
    expect(formatVitality({ state: 'confirmed', value: 100, boosted: true }, 7)).toBe(
      '100（増強中）（7 月）',
    );
    expect(formatVitality({ state: 'pending' }, undefined)).toBe('待更新');
    expect(formatVitality({ state: 'notApplicable' }, undefined)).toBe('不適用');
  });

  it('[MARE-20][MARE-22] 狀態與來源分開顯示；今年計畫選項文字', () => {
    expect(formatStatus('producing', undefined)).toBe('生產中');
    expect(formatStatus('left', 'sold')).toBe('已離圈（售出）');
    expect(ORIGIN_LABELS.ownRetired).toBe('所屬競走馬引退轉入');
    expect(Object.values(YEAR_PLAN_LABELS)).toEqual([
      '待定',
      '八系指定配種',
      '自由配種',
      '等待活力',
      '輪休',
    ]);
  });
});
