import type { MareYearly } from '../domain/mare-yearly.ts';
import type { AppDatabase } from './database.ts';
import { gameKeyRange, isPlainRecord, withoutGameId } from './records.ts';

export function toMareYearly(value: unknown): MareYearly | undefined {
  // 本機資料由本程式寫入；備份匯入的年度資料由 validateCollections 驗證。
  return isPlainRecord(value) ? (withoutGameId(value) as unknown as MareYearly) : undefined;
}

export async function listMareYearly(database: AppDatabase, gameId: string): Promise<MareYearly[]> {
  const values: unknown[] = await database.getAll('mareYearly', gameKeyRange(gameId));
  return values.map(toMareYearly).filter((record) => record !== undefined);
}
