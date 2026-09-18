import { isStallionHorse, type Horse } from '../domain/horse.ts';
import type { AppDatabase } from '../storage/database.ts';
import { findHorsesByName } from '../storage/horses.ts';
import { listStallionDuties } from '../storage/stallion-duties.ts';

/**
 * 是不是一筆種牡馬紀錄（需求規格 11.8）：出現在五月種牡馬總表、自家產駒已登記成為種牡馬，
 * 或有八系任期的馬。單純同名的繁殖牝馬或競走馬不算。
 */
function isStallionRecord(horse: Horse, dutyHorseIds: ReadonlySet<string>): boolean {
  return (
    horse.stallionListing !== undefined || isStallionHorse(horse) || dutyHorseIds.has(horse.id)
  );
}

/**
 * 父馬名稱對照（需求規格 11.8、STL-12）：四月與一月的 `父馬`、七月的 `種付け種牡馬`
 * 唯一對應到一筆種牡馬紀錄時連結內部識別；同名多筆或對應不到時保留外部名稱，
 * 所以那些名稱不會出現在回傳的對照裡。
 *
 * 名稱比對走 `horses.nameKeys`（完整馬名、基本馬名、正式馬名與別名，忽略前後空白）。
 */
export async function matchStallionNames(
  database: AppDatabase,
  gameId: string,
  names: readonly string[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(names.map((name) => name.trim()).filter((name) => name !== ''))];
  if (wanted.length === 0) {
    return new Map();
  }
  const duties = await listStallionDuties(database, gameId);
  const dutyHorseIds = new Set(
    duties
      .map((duty) => duty.horseId)
      .filter((horseId): horseId is string => horseId !== undefined),
  );
  const matched = new Map<string, string>();
  const found = await Promise.all(wanted.map((name) => findHorsesByName(database, gameId, name)));
  for (const [index, horses] of found.entries()) {
    const name = wanted[index];
    const stallions = horses.filter((horse) => isStallionRecord(horse, dutyHorseIds));
    // 唯一對應才連結；同名多筆就保留外部名稱，不猜是哪一匹。
    if (name !== undefined && stallions.length === 1 && stallions[0] !== undefined) {
      matched.set(name, stallions[0].id);
    }
  }
  return matched;
}
