import { describe, expect, it } from 'vitest'
import { parseImportFileName } from './file-name'

describe('parseImportFileName', () => {
  it('解析年與時點，並依類型名稱預選類型', () => {
    expect(parseImportFileName('1968年 1月1週._二歲新馬.txt')).toStrictEqual({
      year: 1968,
      timing: { month: 1, week: 1 },
      type: 'january-two-year-olds',
    })
    expect(parseImportFileName('1968年 4月1週_幼駒誕生.txt')).toStrictEqual({
      year: 1968,
      timing: { month: 4, week: 1 },
      type: 'april-foals',
    })
    expect(parseImportFileName('1970年 5月1週_繁殖牝馬.txt')).toStrictEqual({
      year: 1970,
      timing: { month: 5, week: 1 },
      type: 'may-herd',
    })
  })

  it('`年` 與月份之間的空白可有可無', () => {
    expect(parseImportFileName('1968年5月1週_種牡馬.txt')).toStrictEqual({
      year: 1968,
      timing: { month: 5, week: 1 },
      type: 'stallion-list',
    })
    expect(parseImportFileName('1968年10月1週_繁殖牝馬.txt')).toStrictEqual({
      year: 1968,
      timing: { month: 10, week: 1 },
      type: 'october-mares',
    })
  })

  it('繁殖牝馬格式依月份預選，其他月份不預選', () => {
    expect(parseImportFileName('1968年 7月1週_繁殖牝馬.txt')?.type).toBe('july-conception')
    expect(parseImportFileName('1968年 6月2週_繁殖牝馬.txt')).toStrictEqual({
      year: 1968,
      timing: { month: 6, week: 2 },
      type: null,
    })
  })

  it('類型名稱後面可以有其他文字；認不出類型時只回傳年與時點', () => {
    expect(parseImportFileName('1968年 5月1週_繁殖牝馬 (2).txt')?.type).toBe('may-herd')
    expect(parseImportFileName('1968年 5月1週_新增繁殖牝馬.txt')?.type).toBeNull()
    expect(parseImportFileName('1968年 5月1週.txt')?.type).toBeNull()
    expect(parseImportFileName('1968年 5月1週繁殖牝馬.txt')).toStrictEqual({
      year: 1968,
      timing: { month: 5, week: 1 },
      type: null,
    })
  })

  it('開頭不是「YYYY年 M月W週」，或月、週超出範圍時回傳 null', () => {
    for (const name of [
      '新增繁殖牝馬.txt',
      '68年 5月1週_繁殖牝馬.txt',
      '1968年  5月1週_繁殖牝馬.txt',
      '1968年 0月1週_繁殖牝馬.txt',
      '1968年13月1週_繁殖牝馬.txt',
      '1968年 5月0週_繁殖牝馬.txt',
      '1968年 5月5週_繁殖牝馬.txt',
    ]) {
      expect(parseImportFileName(name)).toBeNull()
    }
  })
})
