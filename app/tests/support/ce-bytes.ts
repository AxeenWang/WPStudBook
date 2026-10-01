import iconv from 'iconv-lite'

// 把測試用的匯出檔內容編成位元組；只給驗收測試用（iconv-lite 是 Node 的開發用套件，src 的測試不引用）

/** 以 CP932 編碼，與 CE 匯出檔相同（附錄 A） */
export function cp932(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(iconv.encode(text, 'cp932'))
}

/** 以 UTF-8 編碼並加上 BOM，與 Excel 另存的「CSV UTF-8」相同 */
export function utf8WithBom(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)])
}
