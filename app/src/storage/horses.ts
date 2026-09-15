import type { Horse } from '../domain/horse.ts';
import type { AppDatabase } from './database.ts';
import { isPlainRecord, withGameId, withoutGameId, type StoredRecord } from './records.ts';

/** nameKeys 的分隔字元（設計決策 5.2 節）。 */
export const NAME_KEY_SEPARATOR = '';

const NAME_FIELDS = ['fullName', 'baseName', 'officialName'] as const;

function aliasNames(aliases: unknown): unknown[] {
  return Array.isArray(aliases)
    ? aliases.map((alias: unknown) => (isPlainRecord(alias) ? alias.name : undefined))
    : [];
}

/** 完整馬名、基本馬名、正式馬名與別名，去除重複後加上 gameId（IndexedDB 多值索引不能與複合鍵合用）。 */
export function horseNameKeys(gameId: string, horse: object): string[] {
  const fieldNames = NAME_FIELDS.map((field): unknown => Reflect.get(horse, field));
  const aliases: unknown = Reflect.get(horse, 'aliases');
  const names = [...fieldNames, ...aliasNames(aliases)].filter(
    (name): name is string => typeof name === 'string' && name !== '',
  );
  return [...new Set(names)].map((name) => `${gameId}${NAME_KEY_SEPARATOR}${name}`);
}

/** 寫入 horses 的紀錄：加上 gameId 並依名稱重建 nameKeys。 */
export function withHorseNameKeys(gameId: string, horse: object): StoredRecord {
  return { ...withGameId(gameId, horse), nameKeys: horseNameKeys(gameId, horse) };
}

function toHorse(value: unknown): Horse | undefined {
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

/** 精確名稱查詢（完整馬名、基本馬名、正式馬名或別名），只找同一局。 */
export async function findHorsesByName(
  database: AppDatabase,
  gameId: string,
  name: string,
): Promise<Horse[]> {
  const values: unknown[] = await database.getAllFromIndex(
    'horses',
    'nameKeys',
    `${gameId}${NAME_KEY_SEPARATOR}${name}`,
  );
  return values.map(toHorse).filter((horse) => horse !== undefined);
}
