export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalJsonError';
  }
}

export function compareCodeUnits(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/**
 * 設計決策 5.4 節的標準化 JSON：欄位名依字典序（UTF-16 碼元）排序、陣列保持原順序、不含空白。
 * 值為 undefined 的欄位視為不存在；其他無法以 JSON 表示的值丟出 CanonicalJsonError。
 */
export function canonicalJson(value: unknown): string {
  return serialize(value, '$');
}

function serialize(value: unknown, path: string): string {
  if (value === null) {
    return 'null';
  }
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError(`${path} 不是有限數值`);
      }
      return JSON.stringify(value);
    case 'object':
      return Array.isArray(value) ? serializeArray(value, path) : serializeObject(value, path);
    default:
      throw new CanonicalJsonError(`${path} 的型別 ${typeof value} 無法寫入 JSON`);
  }
}

function serializeArray(items: readonly unknown[], path: string): string {
  const parts = items.map((item, index) => {
    const itemPath = `${path}[${String(index)}]`;
    if (item === undefined) {
      throw new CanonicalJsonError(`${itemPath} 是 undefined`);
    }
    return serialize(item, itemPath);
  });
  return `[${parts.join(',')}]`;
}

function serializeObject(value: object, path: string): string {
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalJsonError(`${path} 不是一般物件`);
  }
  const entries: [string, unknown][] = Object.entries(value);
  const parts = entries
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => compareCodeUnits(a, b))
    .map(([key, item]) => `${JSON.stringify(key)}:${serialize(item, `${path}.${key}`)}`);
  return `{${parts.join(',')}}`;
}
