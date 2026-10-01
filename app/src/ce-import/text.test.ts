import { describe, expect, it } from 'vitest'
import { decodeImportText, splitRecords } from './text'

// 「テスト」Tab「2」：CP932 的位元組
const CP932 = [0x83, 0x65, 0x83, 0x58, 0x83, 0x67, 0x09, 0x32]
const BOM = [0xef, 0xbb, 0xbf]

function bytes(values: number[]): Uint8Array<ArrayBuffer> {
  return new Uint8Array(values)
}

function utf8(text: string): number[] {
  return [...new TextEncoder().encode(text)]
}

describe('decodeImportText', () => {
  it('不是合法的 UTF-8 時以 CP932 解碼', () => {
    expect(decodeImportText(bytes(CP932))).toBe('テスト\t2')
  })

  it('合法的 UTF-8 以 UTF-8 解碼；有 BOM 時去掉', () => {
    expect(decodeImportText(bytes(utf8('テスト\t2')))).toBe('テスト\t2')
    expect(decodeImportText(bytes([...BOM, ...utf8('テスト\t2')]))).toBe('テスト\t2')
    expect(decodeImportText(bytes(utf8('SP\tST')))).toBe('SP\tST')
  })

  it('UTF-8 的位元組剛好也能以 CP932 解開時，仍以 UTF-8 解碼', () => {
    expect(new TextDecoder('shift_jis').decode(bytes([0xc3, 0xa9]))).toBe('ﾃｩ')
    expect(decodeImportText(bytes(utf8('Café')))).toBe('Café')
  })

  it('有 BOM 但不是合法的 UTF-8 時解碼失敗：BOM 在 CP932 沒有對應的字元', () => {
    expect(decodeImportText(bytes([...BOM, ...CP932]))).toBeNull()
  })

  it('UTF-8 與 CP932 都解不開時回傳 null', () => {
    expect(decodeImportText(bytes([0x32, 0xff, 0x32]))).toBeNull()
  })
})

describe('splitRecords', () => {
  it('表頭含 Tab 時以 Tab 分欄；CRLF 與 LF 都接受，略過檔尾的空行', () => {
    expect(splitRecords('馬名\t年\t\r\nアオバ\t5\t\nシロ\t7\t\r\n\r\n')).toStrictEqual([
      { line: 1, fields: ['馬名', '年', ''] },
      { line: 2, fields: ['アオバ', '5', ''] },
      { line: 3, fields: ['シロ', '7', ''] },
    ])
  })

  it('Tab 分隔檔的欄位內容含逗號或雙引號時照原樣保留', () => {
    expect(splitRecords('馬名\t種付料\r\n"アオバ\t1,500\r\n')).toStrictEqual([
      { line: 1, fields: ['馬名', '種付料'] },
      { line: 2, fields: ['"アオバ', '1,500'] },
    ])
  })

  it('檔案中間的空行是只有一個空欄位的一行', () => {
    expect(splitRecords('a\tb\r\n\r\nc\td\r\n')).toStrictEqual([
      { line: 1, fields: ['a', 'b'] },
      { line: 2, fields: [''] },
      { line: 3, fields: ['c', 'd'] },
    ])
  })

  it('表頭沒有 Tab 時以逗號分欄，處理雙引號包住的欄位', () => {
    expect(
      splitRecords('馬名,種付料,備考\r\nアオバ,"1,500","say ""hi"""\r\nシロ,,\r\n"",x,"a,b"\r\n'),
    ).toStrictEqual([
      { line: 1, fields: ['馬名', '種付料', '備考'] },
      { line: 2, fields: ['アオバ', '1,500', 'say "hi"'] },
      { line: 3, fields: ['シロ', '', ''] },
      { line: 4, fields: ['', 'x', 'a,b'] },
    ])
  })

  it('逗號分隔時雙引號不成對，或結束的雙引號後面不是逗號，那一行的欄位是 null', () => {
    expect(splitRecords('a,b\r\n"1,2\r\n"1"2,3\r\n1,"2"\r\n')).toStrictEqual([
      { line: 1, fields: ['a', 'b'] },
      { line: 2, fields: null },
      { line: 3, fields: null },
      { line: 4, fields: ['1', '2'] },
    ])
  })

  it('沒有任何一行時回傳空陣列', () => {
    expect(splitRecords('')).toStrictEqual([])
    expect(splitRecords('\r\n\r\n')).toStrictEqual([])
  })
})
