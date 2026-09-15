import type { Horse } from '../domain/horse.ts';
import type { AppDatabase } from './database.ts';
import { isPlainRecord, withGameId, withoutGameId, type StoredRecord } from './records.ts';

/** nameKeys 的分隔字元（設計決策 5.2 節）。 */
export const NAME_KEY_SEPARATOR = '\u001f';

const NAME_FIELDS = ['fullName', 'baseName', 'officialName'] as const;

function aliasNames(aliases: unknown): unknown[] {
  return Array.isArray(aliases)
    ? aliases.map((alias: unknown) => (isPlainRecord(alias) ? alias.name : undefined))
    : [];
}

function nameKey(gameId: string, name: string): string {
  return `${gameId}${NAME_KEY_SEPARATOR}${name}`;
}

/**
 * 完整馬名、基本馬名、正式馬名與別名，去除前後空白後捨棄空字串並去除重複，再加上 gameId
 * （IndexedDB 多值索引不能與複合鍵合用）。名稱比較可忽略前後空白（需求規格 11.3）；紀錄本身的名稱保留原文。
 */
export function horseNameKeys(gameId: string, horse: object): string[] {
  const fieldNames = NAME_FIELDS.map((field): unknown => Reflect.get(horse, field));
  const aliases: unknown = Reflect.get(horse, 'aliases');
  const names = [...fieldNames, ...aliasNames(aliases)]
    .filter((name): name is string => typeof name === 'string')
    .map((name) => name.trim())
    .filter((name) => name !== '');
  return [...new Set(names)].map((name) => nameKey(gameId, name));
}

/** 寫入 horses 的紀錄：加上 gameId 並依名稱重建 nameKeys。 */
export function withHorseNameKeys(gameId: string, horse: object): StoredRecord {
  return { ...withGameId(gameId, horse), nameKeys: horseNameKeys(gameId, horse) };
}

export function toHorse(value: unknown): Horse | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }
  const fields = Object.entries(withoutGameId(value)).filter(([key]) => key !== 'nameKeys');
  // 本機資料由本程式寫入；備份匯入的馬匹由 validateCollections 驗證。
  return Object.fromEntries(fields) as unknown as Horse;
}

export async function getHorse(
  database: AppDatabase,
  gameId: string,
  horseId: string,
): Promise<Horse | undefined> {
  const value: unknown = await database.get('horses', [gameId, horseId]);
  return toHorse(value);
}

export async function findHorseByIdentity(
  database: AppDatabase,
  gameId: string,
  abilityNo: number,
  birthYear: number,
): Promise<Horse | undefined> {
  const value: unknown = await database.getFromIndex('horses', 'abilityNo+birthYear', [
    gameId,
    abilityNo,
    birthYear,
  ]);
  return toHorse(value);
}

/** 精確名稱查詢（完整馬名、基本馬名、正式馬名或別名），忽略前後空白，只找同一局。 */
export async function findHorsesByName(
  database: AppDatabase,
  gameId: string,
  name: string,
): Promise<Horse[]> {
  const values: unknown[] = await database.getAllFromIndex(
    'horses',
    'nameKeys',
    nameKey(gameId, name.trim()),
  );
  return values.map(toHorse).filter((horse) => horse !== undefined);
}
/** 以單一唯讀交易讀出多匹馬；找不到的 id 不列入。 */
export async function getHorsesByIds(
  database: AppDatabase,
  gameId: string,
  horseIds: readonly string[],
): Promise<Map<string, Horse>> {
  const transaction = database.transaction('horses', 'readonly');
  const requests: Promise<unknown>[] = horseIds.map((id) => transaction.store.get([gameId, id]));
  const [values] = await Promise.all([Promise.all(requests), transaction.done]);
  const horses = new Map<string, Horse>();
  for (const value of values) {
    const horse = toHorse(value);
    if (horse !== undefined) {
      horses.set(horse.id, horse);
    }
  }
  return horses;
}
