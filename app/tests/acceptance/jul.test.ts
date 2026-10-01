import { describe, expect, it } from 'vitest'
import { parseImportFile } from '../../src/ce-import/parse'
import { SAMPLES, exportText } from '../support/ce-files'

// 需求規格第 15 章「七月受胎確認（JUL）」中由解析負責的部分（CE 匯入子計畫 4-1）；
// 配對、受胎紀錄與預覽由之後的計畫補上

describe('七月受胎確認（JUL）：解析', () => {
  it('JUL-06 状態出現其他文字 → 整份停止', () => {
    const text = exportText('broodmare', [
      { ...SAMPLES.broodmare, 49: '受胎' },
      { ...SAMPLES.broodmare, 49: '流産', 57: '0x0b02' },
    ])
    expect(parseImportFile(text, 'july-conception', 1968)).toStrictEqual({
      status: 'rejected',
      problems: [{ reason: 'value', line: 3, header: '状態', value: '流産' }],
    })
  })
})
