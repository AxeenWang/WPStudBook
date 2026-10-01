/**
 * 解碼匯出檔（需求規格 11.1、技術設計 4.4「解析」）：先以 UTF-8 嚴格解碼（有 BOM 時由 TextDecoder
 * 去掉），失敗再以 CP932 嚴格解碼。純 ASCII 兩種結果相同，CP932 的日文位元組幾乎不會剛好是合法的
 * UTF-8，所以先試 UTF-8 不會誤判；BOM 開頭的位元組（EF BB）在 CP932 沒有對應的字元，有 BOM 但不是
 * 合法 UTF-8 的檔案也不會被當成 CP932。解碼失敗時回傳 null。
 */
export function decodeImportText(bytes: Uint8Array<ArrayBuffer>): string | null {
  return strictDecode('utf-8', bytes) ?? strictDecode('shift_jis', bytes)
}

/** 檔案的一行；逗號分隔檔的雙引號不成對時 fields 是 null */
export interface ImportRecord {
  /** 檔案的第幾行，表頭是第 1 行 */
  line: number
  fields: string[] | null
}

/**
 * 分行與分欄（需求規格 11.1）：CRLF 與 LF 都接受，略過檔尾的空行。表頭含 Tab 時為 Tab 分隔，
 * 否則為逗號分隔；Tab 分隔檔的欄位內容可能含逗號，不影響分隔。逗號分隔時處理雙引號包住的欄位（IMP-22）。
 * 沒有任何一行時回傳空陣列
 */
export function splitRecords(text: string): ImportRecord[] {
  const lines = text.split(/\r?\n/)
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  if (lines.length === 0) return []
  const split = lines[0].includes('\t') ? (line: string) => line.split('\t') : splitCommaLine
  return lines.map((line, index) => ({ line: index + 1, fields: split(line) }))
}

function strictDecode(encoding: string, bytes: Uint8Array<ArrayBuffer>): string | null {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/**
 * 以逗號分欄（Excel 另存的 CSV）：以雙引號包住的欄位可以含逗號，兩個雙引號表示一個雙引號。
 * 雙引號不成對，或結束的雙引號後面不是逗號時回傳 null
 */
function splitCommaLine(line: string): string[] | null {
  const fields: string[] = []
  let index = 0
  for (;;) {
    if (line[index] === '"') {
      let value = ''
      index += 1
      for (;;) {
        const quote = line.indexOf('"', index)
        if (quote === -1) return null
        value += line.slice(index, quote)
        if (line[quote + 1] !== '"') {
          index = quote + 1
          break
        }
        value += '"'
        index = quote + 2
      }
      fields.push(value)
    } else {
      const comma = line.indexOf(',', index)
      const end = comma === -1 ? line.length : comma
      fields.push(line.slice(index, end))
      index = end
    }
    if (index === line.length) return fields
    if (line[index] !== ',') return null
    index += 1
  }
}
