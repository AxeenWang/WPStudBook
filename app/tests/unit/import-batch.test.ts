import { describe, expect, it } from 'vitest';
import {
  checkRepeat,
  compareProgress,
  decideYear,
  hasBlockingError,
  isYearlyTotal,
  summarise,
  type ImportBatch,
  type PreviewRow,
} from '../../src/domain/import-batch.ts';
import { IMPORT_TYPES } from '../../src/domain/import-type.ts';

function row(lineNumber: number, outcome: PreviewRow['outcome']): PreviewRow {
  return { lineNumber, label: `第 ${String(lineNumber)} 列`, outcome, issues: [] };
}

function batch(overrides: Partial<ImportBatch> = {}): ImportBatch {
  return {
    id: 'import-1',
    type: 'mayMares',
    gameYear: 1968,
    timing: { month: 5, week: 1 },
    fileName: '1968年 5月1週_繁殖牝馬.txt',
    sha256: 'a'.repeat(64),
    summary: { apply: 3, skip: 0, review: 0, warn: 0, error: 0 },
    appliedAt: '2026-09-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('匯入預覽與歷程（需求規格 11.1）', () => {
  it('[IMP-05] 摘要分列五種預覽分類', () => {
    const rows = [
      row(2, 'apply'),
      row(3, 'apply'),
      row(4, 'skip'),
      row(5, 'review'),
      row(6, 'warn'),
    ];
    expect(summarise(rows)).toEqual({ apply: 2, skip: 1, review: 1, warn: 1, error: 0 });
    expect(hasBlockingError(rows)).toBe(false);
    expect(hasBlockingError([...rows, row(7, 'error')])).toBe(true);
  });

  it('[IMP-12] 年度總表是一月、四月、五月繁殖牝馬、五月種牡馬與七月（IMP-12）', () => {
    const yearly = IMPORT_TYPES.filter((type) => isYearlyTotal(type));
    expect(yearly).toEqual(['jan2yo', 'aprFoals', 'mayMares', 'julMares', 'mayStallions']);
  });

  it('[IMP-07][IMP-08] 同雜湊為重複，不同內容為資料更正並指向最後一次', () => {
    const first = batch({ id: 'import-1', appliedAt: '2026-09-16T00:00:00.000Z' });
    const second = batch({
      id: 'import-2',
      sha256: 'b'.repeat(64),
      appliedAt: '2026-09-16T01:00:00.000Z',
    });
    expect(checkRepeat([], 'c'.repeat(64))).toEqual({ kind: 'new' });
    expect(checkRepeat([first, second], 'a'.repeat(64))).toEqual({
      kind: 'duplicate',
      previous: first,
    });
    expect(checkRepeat([first, second], 'c'.repeat(64))).toEqual({
      kind: 'correction',
      previous: second,
    });
  });

  it('[IMP-14][IMP-15] 檔案年份較晚時推進，晚兩年以上另外警告', () => {
    expect(decideYear(1969, { month: 5, week: 1 }, 1968, [])).toEqual({
      kind: 'advance',
      to: 1969,
      farFuture: false,
    });
    expect(decideYear(1970, { month: 1, week: 1 }, 1968, [])).toEqual({
      kind: 'advance',
      to: 1970,
      farFuture: true,
    });
  });

  it('同年還沒有年度總表時，年初的檔案不算落後', () => {
    expect(decideYear(1968, { month: 1, week: 1 }, 1968, [])).toEqual({ kind: 'current' });
    expect(decideYear(1968, { month: 5, week: 1 }, 1968, [])).toEqual({ kind: 'current' });
  });

  it('[IMP-09] 檔案早於已套用的年度總表時提示回溯', () => {
    const july = batch({ type: 'julMares', timing: { month: 7, week: 1 } });
    expect(decideYear(1968, { month: 5, week: 1 }, 1968, [july])).toEqual({
      kind: 'behind',
      progress: { gameYear: 1968, timing: { month: 7, week: 1 } },
    });
    // 同一個時點再匯一次不算落後，那是重複或資料更正的事。
    expect(decideYear(1968, { month: 7, week: 1 }, 1968, [july])).toEqual({ kind: 'current' });
    expect(decideYear(1967, { month: 5, week: 1 }, 1968, [])).toMatchObject({ kind: 'behind' });
  });

  it('進度比較先看年再看月與週', () => {
    const at = (gameYear: number, month: number, week: number) => ({
      gameYear,
      timing: { month, week },
    });
    expect(compareProgress(at(1968, 5, 1), at(1969, 1, 1))).toBeLessThan(0);
    expect(compareProgress(at(1968, 7, 1), at(1968, 5, 4))).toBeGreaterThan(0);
    expect(compareProgress(at(1968, 5, 1), at(1968, 5, 1))).toBe(0);
  });
});
