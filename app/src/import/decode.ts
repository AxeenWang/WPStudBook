/** 匯入檔的文字編碼（需求規格 11.1）：以 CP932 嚴格解碼並相容 UTF-8。 */
export type SourceEncoding = 'utf-8' | 'cp932';

export type DecodeResult =
  | { readonly ok: true; readonly text: string; readonly encoding: SourceEncoding }
  | { readonly ok: false; readonly problem: string };

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= UTF8_BOM.length && UTF8_BOM.every((byte, index) => bytes[index] === byte);
}

function decodeStrictly(bytes: Uint8Array, label: string): string | undefined {
  try {
    return new TextDecoder(label, { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * 嚴格解碼匯入檔（需求規格 11.1、IMP-01）。
 *
 * 先試 UTF-8 再試 CP932，因為兩種編碼的失敗方式不對稱：UTF-8 會自我驗證，CP932 的日文
 * 一定通不過 UTF-8 的嚴格解碼；反過來 UTF-8 的日文卻常常能被 shift_jis 解成亂碼而不報錯。
 * 純 ASCII 兩種編碼結果相同，先後順序不影響。
 */
export function decodeImportFile(bytes: Uint8Array): DecodeResult {
  const bom = hasUtf8Bom(bytes);
  const body = bom ? bytes.subarray(UTF8_BOM.length) : bytes;
  const utf8 = decodeStrictly(body, 'utf-8');
  if (utf8 !== undefined) {
    return { ok: true, text: utf8, encoding: 'utf-8' };
  }
  if (bom) {
    return { ok: false, problem: '檔案有 UTF-8 BOM，但內容不是合法的 UTF-8' };
  }
  const cp932 = decodeStrictly(body, 'shift_jis');
  if (cp932 !== undefined) {
    return { ok: true, text: cp932, encoding: 'cp932' };
  }
  return { ok: false, problem: '無法以 UTF-8 或 CP932 解碼，請確認檔案是遊戲匯出的原始檔' };
}
