import type { StallionDuty } from '../domain/stallion-duty.ts';
import type { AppDatabase } from './database.ts';
import { gameKeyRange, isPlainRecord, withoutGameId } from './records.ts';

export async function listStallionDuties(
  database: AppDatabase,
  gameId: string,
): Promise<StallionDuty[]> {
  const values: unknown[] = await database.getAll('stallionDuties', gameKeyRange(gameId));
  // 本機資料由本程式寫入；備份匯入的任期由 validateCollections 驗證。
  return values
    .filter(isPlainRecord)
    .map((value) => withoutGameId(value) as unknown as StallionDuty);
}
