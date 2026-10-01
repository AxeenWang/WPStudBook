import { describe, expect, it } from 'vitest'
import { parseImportFile, readImportFile } from '../../src/ce-import/parse'
import { normalizeSystemName } from '../../src/core/systems'
import { cp932, utf8WithBom } from '../support/ce-bytes'
import { SAMPLES, excelCsv, exportText } from '../support/ce-files'

// 需求規格第 15 章「匯入共通（IMP）」中由解析負責的部分（CE 匯入子計畫 4-1）；
// 預覽、套用、重複與進度由之後的計畫補上，選檔、拖放與多檔拒絕由畫面計畫補上

describe('匯入共通（IMP）：解析', () => {
  it('IMP-01 CP932 無 BOM、Tab 分隔的 .txt → 可以直接讀取與解析', () => {
    const text = exportText('broodmare', [SAMPLES.broodmare])
    const read = readImportFile(cp932(text), '1968年 5月1週_繁殖牝馬.txt')
    if (read.status !== 'ok') throw new Error('應該讀得出來')
    expect(read.text).toBe(text)
    expect(parseImportFile(read.text, 'may-herd', 1968)).toMatchObject({
      status: 'ok',
      format: 'broodmare',
      entries: [{ line: 2, fullName: '[地]テストハハ', abilityNumber: '0x0B01' }],
    })
  })

  it('IMP-02 檔名 1968年 5月1週_繁殖牝馬.txt → 解析為 1968 年 5 月 1 週並預選五月匯入', () => {
    expect(readImportFile(cp932('馬名\r\n'), '1968年 5月1週_繁殖牝馬.txt')).toMatchObject({
      status: 'ok',
      nameInfo: { year: 1968, timing: { month: 5, week: 1 }, type: 'may-herd' },
    })
  })

  it('IMP-03 檔名無法解析 → 沒有年、時點與類型，由使用者選擇，不從其他欄位猜測', () => {
    const text = exportText('broodmare', [SAMPLES.broodmare])
    expect(readImportFile(cp932(text), '新增繁殖牝馬.txt')).toMatchObject({
      status: 'ok',
      nameInfo: null,
    })
  })

  it('IMP-04 二歲馬總表與五月繁殖圈名單互相選錯類型 → 依欄數停止', () => {
    const twoYearOld = exportText('two-year-old', [SAMPLES['two-year-old']])
    const may = exportText('broodmare', [SAMPLES.broodmare])
    expect(parseImportFile(twoYearOld, 'may-herd', 1968)).toStrictEqual({
      status: 'rejected',
      problems: [{ reason: 'field-count', line: 1, value: '78' }],
    })
    expect(parseImportFile(may, 'january-two-year-olds', 1968)).toStrictEqual({
      status: 'rejected',
      problems: [{ reason: 'field-count', line: 1, value: '61' }],
    })
  })

  it('IMP-04 欄數相同的四月誕生幼駒名單與種牡馬總表選錯類型 → 依必要欄位停止', () => {
    const foals = exportText('foal', [SAMPLES.foal])
    const stallions = exportText('stallion', [SAMPLES.stallion])
    for (const [text, type] of [
      [foals, 'stallion-list'],
      [stallions, 'april-foals'],
    ] as const) {
      const result = parseImportFile(text, type, 1968)
      if (result.status !== 'rejected') throw new Error('應該停止')
      expect(result.problems.length).toBeGreaterThan(0)
      expect(result.problems.every((problem) => problem.reason === 'header')).toBe(true)
    }
  })

  it('IMP-17 父系為 エクリプス系 → 保存為 エクリプス，能對應系統對照表的 エクリプス', () => {
    const result = parseImportFile(exportText('broodmare', [SAMPLES.broodmare]), 'may-herd', 1968)
    if (result.status !== 'ok') throw new Error('應該解析得出來')
    expect(SAMPLES.broodmare[44]).toBe('エクリプス系')
    expect(result.entries[0].sireSystem).toBe('エクリプス')
    expect(result.entries[0].sireSystem).toBe(normalizeSystemName('エクリプス'))
  })

  it('IMP-22 以 Excel 另存的 CSV（CP932 或含 BOM 的 UTF-8）→ 解析結果與 Tab 分隔檔相同', () => {
    const text = exportText('stallion', [SAMPLES.stallion])
    const csv = excelCsv(text)
    expect(csv).toContain('"1,500"')
    const expected = parseImportFile(text, 'stallion-list', 1968)
    expect(expected).toMatchObject({ status: 'ok' })
    for (const bytes of [cp932(csv), utf8WithBom(csv)]) {
      const read = readImportFile(bytes, '1968年5月1週_種牡馬.csv')
      if (read.status !== 'ok') throw new Error('應該讀得出來')
      expect(read.text).toBe(csv)
      expect(parseImportFile(read.text, 'stallion-list', 1968)).toStrictEqual(expected)
    }
  })
})
