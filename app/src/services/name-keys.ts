import { toBaseName, type Horse } from '../domain/horse.ts';

/**
 * 名稱比對的鍵：去除前後空白（需求規格 11.3），也比對去除 `(外)`、`[地]` 前綴後的基本馬名，
 * 因為同一匹馬在不同檔案或手動輸入時可能一邊有前綴、一邊沒有。
 */
export function nameKeys(names: readonly (string | undefined)[]): Set<string> {
  const keys = new Set<string>();
  for (const name of names) {
    if (name === undefined) {
      continue;
    }
    for (const key of [name.trim(), toBaseName(name).trim()]) {
      if (key !== '') {
        keys.add(key);
      }
    }
  }
  return keys;
}

/** 馬匹的完整馬名、基本馬名、正式馬名與別名。 */
export function horseNameKeys(horse: Horse | undefined): Set<string> {
  return horse === undefined
    ? new Set()
    : nameKeys([
        horse.fullName,
        horse.baseName,
        horse.officialName,
        ...horse.aliases.map((alias) => alias.name),
      ]);
}

/** 名稱是否符合其中一個比對鍵。 */
export function matchesName(name: string | undefined, keys: ReadonlySet<string>): boolean {
  return name !== undefined && [...nameKeys([name])].some((key) => keys.has(key));
}
