import type { Horse } from '../domain/horse.ts';
import { MARKET_GENERATION } from '../domain/lineage.ts';
import {
  checkPedigree,
  INBREEDING_GENERATIONS,
  type AncestorNode,
  type AncestorTree,
  type PedigreeCheck,
} from '../domain/pedigree-check.ts';
import { parentSystemOf, type SystemMapEntry } from '../domain/system-map.ts';
import { FIRST_CYCLE_GENERATION, type TaskPhase } from '../domain/task.ts';
import { listLines } from '../storage/lines.ts';
import { listMares } from '../storage/mares.ts';
import { listStallionDuties } from '../storage/stallion-duties.ts';
import { listSystemMapEntries } from '../storage/system-map.ts';
import type { ServiceContext } from './context.ts';
import { requireCurrentGame } from './games.ts';
import { loadAncestors } from './pedigree.ts';

/** 產出的幼駒往上 3 代就是 8 匹曾祖父母（需求規格 4.3）。 */
const GREAT_GRANDPARENT_DEPTH = 3;

/** 建系期產出的最後一代（需求規格 7.3）：與 4 代內重複的檢查範圍無關，只是恰好同為 4。 */
const LAST_BUILDING_GENERATION = FIRST_CYCLE_GENERATION - 1;

/**
 * 建系期的市場馬（需求規格 10.2、PED-11）：第 1 系起點母馬、建系分支用的替代母馬，
 * 以及產出 4 代以內的零代市場種牡馬。之後補血補入的市場馬不算，資料不足要照常確認。
 */
async function loadBuildingPhaseMarketIds(
  context: ServiceContext,
  gameId: string,
): Promise<Set<string>> {
  const [mares, lines, duties] = await Promise.all([
    listMares(context.database, gameId),
    listLines(context.database, gameId),
    listStallionDuties(context.database, gameId),
  ]);
  const ids = new Set<string>();
  for (const mare of mares) {
    if (mare.group.kind === 'starter') {
      ids.add(mare.id);
    } else if (
      mare.group.kind === 'substitute' &&
      mare.group.generation < LAST_BUILDING_GENERATION
    ) {
      // 替代第 q 系 N 代的市場母馬產出 N+1 代；建系只到產出 4 代。
      ids.add(mare.id);
    }
  }
  const buildingPositions = new Set(
    lines
      .filter((line) => line.branch.targetGeneration <= LAST_BUILDING_GENERATION)
      .map((line) => line.position),
  );
  for (const duty of duties) {
    if (
      duty.role === 'current' &&
      duty.generation === MARKET_GENERATION &&
      buildingPositions.has(duty.position)
    ) {
      ids.add(duty.horseId);
    }
  }
  return ids;
}

interface TreeSource {
  readonly horses: ReadonlyMap<string, Horse>;
  readonly systemMap: readonly SystemMapEntry[];
  readonly buildingPhaseMarketIds: ReadonlySet<string>;
}

function ancestorNode(horse: Horse, source: TreeSource): AncestorNode {
  const parentSystem =
    horse.sireSubsystem === undefined
      ? undefined
      : parentSystemOf(source.systemMap, horse.sireSubsystem);
  return {
    horseId: horse.id,
    ...(parentSystem === undefined ? {} : { parentSystem }),
    buildingPhaseMarket: source.buildingPhaseMarketIds.has(horse.id),
  };
}

/**
 * 以預計產出的幼駒為起點建立祖先樹（需求規格 4.3、10.2）：父馬與母馬是第 1 代，
 * 曾祖父母是第 3 代的 8 個位置。資料不足的位置依「下一代是不是建系期市場馬」分類（PED-11）。
 */
function buildAncestorTree(sire: Horse, dam: Horse, source: TreeSource): AncestorTree {
  const greatGrandparents: (AncestorNode | undefined)[] = [];
  const counts = new Map<string, number>();
  let unlinkedAncestors = 0;
  let buildingPhaseGaps = 0;

  /** 這一層的位置：有內部馬匹，或已經是資料不足的空位。 */
  let level: (Horse | undefined)[] = [sire, dam];
  for (let depth = 1; depth <= INBREEDING_GENERATIONS; depth += 1) {
    for (const horse of level) {
      if (horse !== undefined) {
        counts.set(horse.id, (counts.get(horse.id) ?? 0) + 1);
      }
    }
    if (depth === GREAT_GRANDPARENT_DEPTH) {
      greatGrandparents.push(
        ...level.map((horse) => (horse === undefined ? undefined : ancestorNode(horse, source))),
      );
    }
    if (depth === INBREEDING_GENERATIONS) {
      break;
    }
    const next: (Horse | undefined)[] = [];
    for (const horse of level) {
      if (horse === undefined) {
        // 空位不再往上展開，也不重複計算缺漏。
        next.push(undefined, undefined);
        continue;
      }
      const fromBuildingPhase = source.buildingPhaseMarketIds.has(horse.id);
      for (const parentId of [horse.sireId, horse.damId]) {
        const parent = parentId === undefined ? undefined : source.horses.get(parentId);
        if (parent === undefined) {
          if (fromBuildingPhase) {
            buildingPhaseGaps += 1;
          } else {
            unlinkedAncestors += 1;
          }
        }
        next.push(parent);
      }
    }
    level = next;
  }
  const duplicateAncestors = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
  return { greatGrandparents, duplicateAncestors, unlinkedAncestors, buildingPhaseGaps };
}

export interface BreedingPedigreeInput {
  readonly phase: TaskPhase;
  readonly sireId: string;
  readonly damId: string;
}

/**
 * 指定配種前的血統檢查（需求規格 10.1、10.2）：建系期不計算；循環期預估活血種數、
 * 檢查 4 代內重複的馬，並判斷資料是否不足。找不到父母時視為資料不足。
 */
export async function checkBreedingPedigree(
  context: ServiceContext,
  input: BreedingPedigreeInput,
): Promise<PedigreeCheck> {
  const game = await requireCurrentGame(context);
  if (input.phase === 'building') {
    return checkPedigree('building', {
      greatGrandparents: [],
      duplicateAncestors: [],
      unlinkedAncestors: 0,
      buildingPhaseGaps: 0,
    });
  }
  const [sireAncestors, damAncestors, systemMap, buildingPhaseMarketIds] = await Promise.all([
    loadAncestors(context, game.id, input.sireId, GREAT_GRANDPARENT_DEPTH),
    loadAncestors(context, game.id, input.damId, GREAT_GRANDPARENT_DEPTH),
    listSystemMapEntries(context.database, game.id),
    loadBuildingPhaseMarketIds(context, game.id),
  ]);
  const horses = new Map<string, Horse>([...sireAncestors, ...damAncestors]);
  const sire = horses.get(input.sireId);
  const dam = horses.get(input.damId);
  if (sire === undefined || dam === undefined) {
    return checkPedigree('cycling', {
      greatGrandparents: [],
      duplicateAncestors: [],
      unlinkedAncestors: 1,
      buildingPhaseGaps: 0,
    });
  }
  return checkPedigree(
    'cycling',
    buildAncestorTree(sire, dam, { horses, systemMap, buildingPhaseMarketIds }),
  );
}
