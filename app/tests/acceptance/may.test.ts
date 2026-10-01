import { describe, expect, it } from 'vitest'
import { parseImportFile } from '../../src/ce-import/parse'
import { SAMPLES, exportText } from '../support/ce-files'

// 需求規格第 15 章「五月繁殖牝馬（MAY）」中由解析負責的部分（CE 匯入子計畫 4-1）；
// 對帳、預覽與套用由之後的計畫補上

describe('五月繁殖牝馬（MAY）：解析', () => {
  it('MAY-01 繋養牧場番号不在 32～35 或缺少 → 整份停止並提示範圍異常', () => {
    const text = exportText('broodmare', [
      SAMPLES.broodmare,
      { ...SAMPLES.broodmare, 48: '31', 57: '0x0b02' },
      { ...SAMPLES.broodmare, 48: '', 57: '0x0b03' },
    ])
    expect(parseImportFile(text, 'may-herd', 1968)).toStrictEqual({
      status: 'rejected',
      problems: [
        { reason: 'scope', line: 3, header: '牧場', value: '31' },
        { reason: 'scope', line: 4, header: '牧場', value: '' },
      ],
    })
  })
})
