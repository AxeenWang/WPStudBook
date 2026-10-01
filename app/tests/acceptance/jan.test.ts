import { describe, expect, it } from 'vitest'
import { parseImportFile, readImportFile } from '../../src/ce-import/parse'
import { cp932 } from '../support/ce-bytes'
import { SAMPLES, exportText } from '../support/ce-files'

// 需求規格第 15 章「一月二歲馬（JAN）」中由解析負責的部分（CE 匯入子計畫 4-1）；
// 配對與套用由之後的計畫補上，實檔的筆數在 tests/local/ce-samples.test.ts

describe('一月二歲馬（JAN）：解析', () => {
  it('JAN-01 匯入 1968年 1月1週._二歲新馬.txt → 以 CP932 讀取 78 欄，忽略尾端空白欄，出生年為 1966', () => {
    const text = exportText('two-year-old', [SAMPLES['two-year-old']])
    const read = readImportFile(cp932(text), '1968年 1月1週._二歲新馬.txt')
    if (read.status !== 'ok') throw new Error('應該讀得出來')
    expect(read.nameInfo).toStrictEqual({
      year: 1968,
      timing: { month: 1, week: 1 },
      type: 'january-two-year-olds',
    })
    const result = parseImportFile(read.text, 'january-two-year-olds', 1968)
    expect(result).toMatchObject({ status: 'ok', entries: [{ age: 2, birthYear: 1966 }] })
    expect(
      parseImportFile(text.replaceAll('\t\r\n', '\r\n'), 'january-two-year-olds', 1968),
    ).toStrictEqual(result)
  })

  it('JAN-06 第 77 欄基本馬名 → 依位置讀取，不因與第 1 欄同名而讀錯', () => {
    const text = exportText('two-year-old', [{ ...SAMPLES['two-year-old'], 1: '(外)ベツメイ' }])
    const result = parseImportFile(text, 'january-two-year-olds', 1968)
    expect(result).toMatchObject({
      status: 'ok',
      entries: [{ fullName: '(外)ベツメイ', baseName: 'テストアオバ' }],
    })
  })

  it('JAN-07 史実番号 0x7FFF → 不作為識別，能力番号取第 74 欄', () => {
    const text = exportText('two-year-old', [SAMPLES['two-year-old']])
    const result = parseImportFile(text, 'january-two-year-olds', 1968)
    if (result.status !== 'ok') throw new Error('應該解析得出來')
    expect(SAMPLES['two-year-old'][73]).toBe('0x7FFF')
    expect(result.entries[0].abilityNumber).toBe('0x0A1F')
    expect(Object.values(result.entries[0])).not.toContain('0x7FFF')
  })
})
