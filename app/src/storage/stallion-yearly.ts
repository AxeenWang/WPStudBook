import type { StallionYearly } from '../domain/stallion-yearly.ts';
import type { AppDatabase } from './database.ts';
import { gameKeyRange, isPlainRecord, withoutGameId } from './records.ts';

export function toStallionYearly(value: unknown): StallionYearly | undefined {
  // 本機資料由本程式寫入；備份匯入的年度資料由 validateCollections 驗證。
  return isPlainRecord(value) ? (withoutGameId(value) as unknown as StallionYearly) : undefined;
}

export async function listStallionYearly(
  database: AppDatabase,
  gameId: string,
): Promise<StallionYearly[]> {
  const values: unknown[] = await database.getAll('stallionYearly', gameKeyRange(gameId));
  return values.map(toStallionYearly).filter((record) => record !== undefined);
}

/** 以 [gameId, horseId, gameYear] 索引讀取一匹種牡馬全部年度的資料（遊戲年由小到大）。 */
export async function listStallionYearlyForHorse(
  database: AppDatabase,
  gameId: string,
  horseId: string,
): Promise<StallionYearly[]> {
  const values: unknown[] = await database.getAllFromIndex(
    'stallionYearly',
    'horseId+gameYear',
    IDBKeyRange.bound(
      [gameId, horseId, Number.NEGATIVE_INFINITY],
      [gameId, horseId, Number.POSITIVE_INFINITY],
    ),
  );
  return values.map(toStallionYearly).filter((record) => record !== undefined);
}
