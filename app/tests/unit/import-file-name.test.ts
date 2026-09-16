import { describe, expect, it } from 'vitest';
import { parseImportFileName } from '../../src/import/file-name.ts';

describe('匯入檔名解析（需求規格 11.1、IMP-02、IMP-03）', () => {
  it('`.references/` 六個實檔的檔名都能解析並預選類型', () => {
    const cases = [
      ['1968年 1月1週._二歲新馬.txt', 1, '二歲新馬', 'jan2yo'],
      ['1968年 4月1週_幼駒誕生.txt', 4, '幼駒誕生', 'aprFoals'],
      ['1968年 5月1週_繁殖牝馬.txt', 5, '繁殖牝馬', 'mayMares'],
      ['1968年 7月1週_繁殖牝馬.txt', 7, '繁殖牝馬', 'julMares'],
      ['1968年10月1週_繁殖牝馬.txt', 10, '繁殖牝馬', 'octWorldMares'],
      ['1968年5月1週_種牡馬.txt', 5, '種牡馬', 'mayStallions'],
    ] as const;
    for (const [fileName, month, label, importType] of cases) {
      expect(parseImportFileName(fileName)).toEqual({
        gameYear: 1968,
        timing: { month, week: 1 },
        label,
        importType,
      });
    }
  });

  it('同格式靠時點分辨，分不出來時不猜類型', () => {
    expect(parseImportFileName('1968年 6月1週_繁殖牝馬.txt')).toEqual({
      gameYear: 1968,
      timing: { month: 6, week: 1 },
      label: '繁殖牝馬',
      importType: undefined,
    });
    expect(parseImportFileName('1970年 3月2週_種牡馬.txt')?.importType).toBeUndefined();
  });

  it('沒有類型名稱時仍解析年與時點', () => {
    expect(parseImportFileName('1968年 5月1週.txt')).toEqual({
      gameYear: 1968,
      timing: { month: 5, week: 1 },
      label: '',
      importType: undefined,
    });
  });

  it('[IMP-03] 檔名無法解析時回傳 undefined，不從其他地方猜測（IMP-03）', () => {
    expect(parseImportFileName('候補.txt')).toBeUndefined();
    expect(parseImportFileName('繁殖牝馬_1968.txt')).toBeUndefined();
    expect(parseImportFileName('1968年13月1週_繁殖牝馬.txt')).toBeUndefined();
    expect(parseImportFileName('1968年 5月0週_繁殖牝馬.txt')).toBeUndefined();
  });
});
