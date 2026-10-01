import { describe, expect, it } from 'vitest'
import { parseImportFile, readImportFile } from '../../src/ce-import/parse'
import { cp932 } from '../support/ce-bytes'
import { SAMPLES, exportText } from '../support/ce-files'

// 需求規格第 15 章「十月繁殖牝馬（OCT）」中由解析負責的部分（CE 匯入子計畫 4-1）；
// 配對自家產駒與套用由之後的計畫補上，實檔的筆數在 tests/local/ce-samples.test.ts

describe('十月繁殖牝馬（OCT）：解析', () => {
  it('OCT-01 匯入 1968年10月1週_繁殖牝馬.txt → 預選十月全世界繁殖牝馬總表，以 61 欄讀取，牧場為 0 或其他番号時不停止', () => {
    const text = exportText('broodmare', [
      { ...SAMPLES.broodmare, 2: '米', 48: '0' },
      { ...SAMPLES.broodmare, 2: '欧', 48: '260', 57: '0x0b02' },
      { ...SAMPLES.broodmare, 48: '32', 57: '0x0b03' },
    ])
    const read = readImportFile(cp932(text), '1968年10月1週_繁殖牝馬.txt')
    if (read.status !== 'ok') throw new Error('應該讀得出來')
    expect(read.nameInfo).toStrictEqual({
      year: 1968,
      timing: { month: 10, week: 1 },
      type: 'october-mares',
    })
    expect(parseImportFile(read.text, 'october-mares', 1968)).toMatchObject({
      status: 'ok',
      entries: [
        { country: '米', farm: 0 },
        { country: '欧', farm: 260 },
        { country: '日', farm: 32 },
      ],
    })
  })
})
