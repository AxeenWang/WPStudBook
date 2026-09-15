/** 回傳第一個不符合資料契約 JSON 值的位置與原因；全部符合時回傳 undefined。 */
export function findInvalidJsonValue(value: unknown, path: string): string | undefined {
  if (value === null) {
    return `${path} 是 null（資料契約以欄位不存在表示未知）`;
  }
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return undefined;
    case 'number':
      return Number.isFinite(value) ? undefined : `${path} 不是有限數值`;
    case 'object':
      return Array.isArray(value) ? findInArray(value, path) : findInObject(value, path);
    default:
      return `${path} 的型別 ${typeof value} 不是 JSON 值`;
  }
}

function findInArray(items: readonly unknown[], path: string): string | undefined {
  for (const [index, item] of items.entries()) {
    const problem = findInvalidJsonValue(item, `${path}[${String(index)}]`);
    if (problem !== undefined) {
      return problem;
    }
  }
  return undefined;
}

function findInObject(value: object, path: string): string | undefined {
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return `${path} 不是一般物件`;
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, item] of entries) {
    const problem = findInvalidJsonValue(item, `${path}.${key}`);
    if (problem !== undefined) {
      return problem;
    }
  }
  return undefined;
}
