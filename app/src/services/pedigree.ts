import { trackingName } from '../domain/foal.ts';
import { horseDisplayName, nameForTracking, type Horse } from '../domain/horse.ts';
import { buildPedigree, type PedigreeHorseNode, type PedigreeStatus } from '../domain/pedigree.ts';
import type { CurrentDuty } from '../domain/stallion-duty.ts';
import { listFoals } from '../storage/foals.ts';
import { getHorsesByIds } from '../storage/horses.ts';
import { listMares } from '../storage/mares.ts';
import { listStallionDuties } from '../storage/stallion-duties.ts';
import type { ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import { requireCurrentGame } from './games.ts';

/** 血緣表預設顯示到曾祖父母；每次展開多一代。 */
export const PEDIGREE_DEFAULT_GENERATIONS = 3;
export const PEDIGREE_MAX_GENERATIONS = 10;

export interface Pedigree {
  readonly generations: number;
  readonly root: PedigreeHorseNode;
  /** 還有更上一代的資料，而且未達上限。 */
  readonly canExpand: boolean;
}

function anyExpandable(node: PedigreeHorseNode): boolean {
  if (node.expandable) {
    return true;
  }
  return [node.sire, node.dam].some((parent) => parent?.kind === 'horse' && anyExpandable(parent));
}

/** 依內部識別逐代讀出馬匹；多讀一代，讓最上層未命名的產駒也能顯示追蹤名。 */
export async function loadAncestors(
  context: ServiceContext,
  gameId: string,
  rootId: string,
  generations: number,
): Promise<Map<string, Horse>> {
  const horses = new Map<string, Horse>();
  let ids = [rootId];
  for (let depth = 0; depth <= generations + 1 && ids.length > 0; depth += 1) {
    const missing = [...new Set(ids)].filter((id) => !horses.has(id));
    for (const [id, horse] of await getHorsesByIds(context.database, gameId, missing)) {
      horses.set(id, horse);
    }
    ids = ids.flatMap((id) => {
      const horse = horses.get(id);
      return horse === undefined
        ? []
        : [horse.sireId, horse.damId].filter((item): item is string => item !== undefined);
    });
  }
  return horses;
}

/**
 * 開啟血緣表（需求規格 10.4、PED-09）：已售出、定年引退、被取代的祖先照常列出並標示，父母關係不中斷。
 */
export async function loadPedigree(
  context: ServiceContext,
  horseId: string,
  generations: number = PEDIGREE_DEFAULT_GENERATIONS,
): Promise<Pedigree> {
  if (!Number.isInteger(generations) || generations < 1 || generations > PEDIGREE_MAX_GENERATIONS) {
    throw new ServiceError(
      'invalidInput',
      `血緣表代數必須是 1～${String(PEDIGREE_MAX_GENERATIONS)} 的整數`,
    );
  }
  const game = await requireCurrentGame(context);
  const [horses, mares, foals, duties] = await Promise.all([
    loadAncestors(context, game.id, horseId, generations),
    listMares(context.database, game.id),
    listFoals(context.database, game.id),
    listStallionDuties(context.database, game.id),
  ]);
  const maresById = new Map(mares.map((mare) => [mare.id, mare]));
  const foalsById = new Map(foals.map((foal) => [foal.id, foal]));
  const statusOf = (id: string): PedigreeStatus[] => {
    const statuses = new Set<PedigreeStatus>();
    const mare = maresById.get(id);
    if (mare?.status === 'left' && mare.leftReason !== undefined) {
      statuses.add(mare.leftReason);
    } else if (mare === undefined && foalsById.get(id)?.disposition === 'sold') {
      statuses.add('sold');
    }
    // 只看最近一次現任任期：被取代後又選回在崗的種牡馬不標示已被取代。
    const latest = duties
      .filter((duty): duty is CurrentDuty => duty.role === 'current' && duty.horseId === id)
      .sort(
        (a, b) =>
          b.startYear - a.startYear ||
          Number(b.dutyStatus === 'onDuty') - Number(a.dutyStatus === 'onDuty'),
      )[0]?.dutyStatus;
    if (latest !== undefined && latest !== 'onDuty') {
      statuses.add(latest);
    }
    return [...statuses];
  };
  const nameOf = (horse: Horse): string => {
    const foal = foalsById.get(horse.id);
    const dam = foal === undefined ? undefined : horses.get(foal.damId);
    const tracking =
      foal === undefined
        ? undefined
        : trackingName(dam === undefined ? undefined : nameForTracking(dam), foal.birthYear);
    return horseDisplayName(horse, tracking) ?? '（沒有馬名）';
  };
  const root = buildPedigree(horseId, generations, { horses, statusOf, nameOf });
  if (root === undefined) {
    throw new ServiceError('invalidInput', '找不到這匹馬');
  }
  return {
    generations,
    root,
    canExpand: generations < PEDIGREE_MAX_GENERATIONS && anyExpandable(root),
  };
}
