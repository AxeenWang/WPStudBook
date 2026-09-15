/** 系統對照表的一筆：子系統→親系統（需求規格 7.2）。 */
export interface SystemMapEntry {
  readonly id: string;
  readonly subsystem: string;
  readonly parentSystem: string;
}

/** 系統名稱去掉結尾「系」（需求規格 11.1、設計決策 5.3 節）；不修剪空白，手動輸入由服務層先修剪。 */
export function stripSystemSuffix(name: string): string {
  return name.endsWith('系') ? name.slice(0, -1) : name;
}

export function parentSystemOf(
  entries: readonly SystemMapEntry[],
  subsystem: string,
): string | undefined {
  return entries.find((entry) => entry.subsystem === subsystem)?.parentSystem;
}
