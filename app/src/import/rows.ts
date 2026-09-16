/** 欄位分隔（需求規格 11.1）：表頭含 Tab 時為 Tab 分隔，否則為逗號分隔。 */
export type Delimiter = '\t' | ',';

export interface SourceTable {
  readonly delimiter: Delimiter;
  readonly header: readonly string[];
  /** 資料列；行號從 1 起算，不含表頭。 */
  readonly rows: readonly (readonly string[])[];
}

export type SplitResult =
  | { readonly ok: true; readonly table: SourceTable }
  | { readonly ok: false; readonly problem: string };

const LINE_BREAK = /\r\n|\n|\r/u;

function toLines(text: string): string[] {
  const lines = text.split(LINE_BREAK);
  // 檔尾的換行會多切出一個空字串；中間的空行留著，交由欄數驗證當成資料異常。
  while (lines.length > 0 && lines.at(-1) === '') {
    lines.pop();
  }
  return lines;
}

/**
 * 依分隔字元切出表頭與資料列（需求規格 11.1）。
 *
 * 不處理引號跳脫：Tab 分隔檔的欄位內容本來就可能含逗號（附錄 A），遊戲也沒有匯出過引號；
 * 真的遇到需要跳脫的逗號分隔檔時，欄數會對不上而停止，不會靜默錯位。
 * 內容一律不修剪（需求規格 11.1），`戦績` 等欄位的空白有格式意義。
 */
export function splitTable(text: string): SplitResult {
  const lines = toLines(text);
  const [headerLine] = lines;
  if (headerLine === undefined || headerLine === '') {
    return { ok: false, problem: '檔案沒有表頭' };
  }
  const delimiter: Delimiter = headerLine.includes('\t') ? '\t' : ',';
  const header = headerLine.split(delimiter);
  if (header.length < 2) {
    return { ok: false, problem: '無法辨識欄位分隔：表頭沒有 Tab 也沒有逗號' };
  }
  return {
    ok: true,
    table: {
      delimiter,
      header,
      rows: lines.slice(1).map((line) => line.split(delimiter)),
    },
  };
}
