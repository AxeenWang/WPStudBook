import { describe, expect, it } from 'vitest'
import { parseImportFile, readImportFile } from '../../src/ce-import/parse'
import { cp932 } from '../support/ce-bytes'
import { SAMPLES, exportText } from '../support/ce-files'

// 需求規格第 15 章「四月誕生幼駒（APR）」中由解析負責的部分（CE 匯入子計畫 4-1）；
// 建立幼駒與核對由之後的計畫補上，實檔的筆數在 tests/local/ce-samples.test.ts

describe('四月誕生幼駒（APR）：解析', () => {
  it('APR-01 匯入 1968年 4月1週_幼駒誕生.txt → 63 欄、0 歲，馬主番号 46、繋養牧場番号 32，出生年為匯出年', () => {
    const text = exportText('foal', [SAMPLES.foal])
    const read = readImportFile(cp932(text), '1968年 4月1週_幼駒誕生.txt')
    if (read.status !== 'ok') throw new Error('應該讀得出來')
    expect(read.nameInfo?.type).toBe('april-foals')
    expect(parseImportFile(read.text, 'april-foals', 1968)).toMatchObject({
      status: 'ok',
      entries: [{ age: 0, birthYear: 1968, owner: 46, stable: 32, sex: 'male' }],
    })
  })

  it('APR-04 馬主番号不是 46／47 或繋養牧場番号不在 32～35 → 整份停止並提示範圍異常', () => {
    const owner = exportText('foal', [{ ...SAMPLES.foal, 52: '12' }])
    const stable = exportText('foal', [{ ...SAMPLES.foal, 53: '36' }])
    expect(parseImportFile(owner, 'april-foals', 1968)).toStrictEqual({
      status: 'rejected',
      problems: [{ reason: 'scope', line: 2, header: '馬主', value: '12' }],
    })
    expect(parseImportFile(stable, 'april-foals', 1968)).toStrictEqual({
      status: 'rejected',
      problems: [{ reason: 'scope', line: 2, header: '繋牧', value: '36' }],
    })
  })

  it('APR-06 SP 為 72(72)、サ 為 42( +0)、副能力為 B(0) → 取括號前主值', () => {
    const text = exportText('foal', [SAMPLES.foal])
    expect(parseImportFile(text, 'april-foals', 1968)).toMatchObject({
      status: 'ok',
      entries: [{ speed: 72, subTotal: 42, subAbilities: { power: 'B', burst: 'B+' } }],
    })
  })
})
