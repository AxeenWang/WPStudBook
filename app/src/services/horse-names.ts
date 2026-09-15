import { trackingName } from '../domain/foal.ts';
import { horseDisplayName, nameForTracking } from '../domain/horse.ts';
import type { AppDatabase } from '../storage/database.ts';
import { getFoalsByIds } from '../storage/foals.ts';
import { getHorsesByIds } from '../storage/horses.ts';

/**
 * 馬匹的顯示名稱（需求規格 9.4）：完整馬名、正式馬名或基本馬名，未命名的自家產駒顯示追蹤名。
 * 找不到或沒有任何名稱的馬匹不列入，由呼叫端決定退回的文字。
 */
export async function loadHorseNames(
  database: AppDatabase,
  gameId: string,
  horseIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(horseIds)];
  const [horses, foals] = await Promise.all([
    getHorsesByIds(database, gameId, ids),
    getFoalsByIds(database, gameId, ids),
  ]);
  const dams = await getHorsesByIds(database, gameId, [
    ...new Set([...foals.values()].map((foal) => foal.damId)),
  ]);
  const names = new Map<string, string>();
  for (const [id, horse] of horses) {
    const foal = foals.get(id);
    const dam = foal === undefined ? undefined : dams.get(foal.damId);
    const tracking =
      foal === undefined
        ? undefined
        : trackingName(dam === undefined ? undefined : nameForTracking(dam), foal.birthYear);
    const name = horseDisplayName(horse, tracking);
    if (name !== undefined) {
      names.set(id, name);
    }
  }
  return names;
}
