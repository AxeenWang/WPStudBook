import { describe, expect, it } from 'vitest';
import { formatTask, formatTaskKind } from '../../src/ui/overview/labels.ts';

const STARTER = {
  kind: 'advance',
  sire: { position: 1, generation: 0 },
  dam: { position: 1, generation: 0, substitute: false, starter: true },
  target: { position: 1, generation: 1 },
} as const;

const ADVANCE = {
  kind: 'advance',
  sire: { position: 1, generation: 1 },
  dam: { position: 2, generation: 1, substitute: true, starter: false },
  target: { position: 1, generation: 2 },
} as const;

const FOUND = {
  kind: 'found',
  sire: { position: 2, generation: 0 },
  dam: { position: 1, generation: 1, substitute: false, starter: false },
  target: { position: 2, generation: 2 },
} as const;

const CYCLE = {
  kind: 'cycle',
  sire: { position: 1, generation: 5 },
  dam: { position: 3, generation: 5, substitute: false, starter: false },
  target: { position: 1, generation: 6 },
} as const;

describe('任務標題（需求規格 7.3、7.4、13.2）', () => {
  it('[LINE-09] 建系分支的兩條配對與規格用語一致', () => {
    expect(formatTask(ADVANCE)).toBe('第 1 系 1 代 × 替代第 2 系 → 第 1 系 2 代');
    expect(formatTask(FOUND)).toBe('第 2 系零代 × 第 1 系 1 代母馬 → 第 2 系 2 代');
  });

  it('[LINE-15] 循環任務顯示第 X 系 N 代種牡馬 × 第 Y 系 N 代母馬 → 第 X 系 N+1 代', () => {
    expect(formatTask(CYCLE)).toBe('第 1 系 5 代種牡馬 × 第 3 系 5 代母馬 → 第 1 系 6 代');
  });

  it('起點的母馬側顯示為起點母馬群，不顯示為屬於該系', () => {
    expect(formatTask(STARTER)).toBe('第 1 系零代 × 第 1 系起點母馬群 → 第 1 系 1 代');
  });

  it('分支種類標示推進原系與建立新系', () => {
    expect([STARTER, ADVANCE, FOUND, CYCLE].map(formatTaskKind)).toEqual([
      '起點',
      '推進原系',
      '建立新系',
      '循環配種',
    ]);
  });
});
