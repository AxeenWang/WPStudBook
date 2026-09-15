import type { Conception } from '../domain/breeding.ts';
import type { AppDatabase } from './database.ts';
import { gameKeyRange, isPlainRecord } from './records.ts';

/** 指定遊戲年各母馬的受胎狀態（鍵為母馬 id）；沒有受胎狀態的紀錄是未登記，不列入。 */
export async function listConceptionsInYear(
  database: AppDatabase,
  gameId: string,
  gameYear: number,
): Promise<Map<string, Conception>> {
  const values: unknown[] = await database.getAll('breedings', gameKeyRange(gameId));
  const conceptions = new Map<string, Conception>();
  for (const value of values) {
    if (
      isPlainRecord(value) &&
      value.gameYear === gameYear &&
      typeof value.mareId === 'string' &&
      typeof value.conception === 'string'
    ) {
      // 本機資料由本程式寫入；配種紀錄的欄位規則在子計畫 2-3 加入。
      conceptions.set(value.mareId, value.conception as Conception);
    }
  }
  return conceptions;
}
