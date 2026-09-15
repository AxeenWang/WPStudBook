/** 資料契約中的 JSON 值。依設計決策 5.3 節，未知以「欄位不存在」表示，不使用 null。 */
export type JsonValue = string | number | boolean | readonly JsonValue[] | JsonObject;

export interface JsonObject {
  readonly [key: string]: JsonValue;
}
