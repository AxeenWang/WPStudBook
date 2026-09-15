import type { Horse, Sex } from './horse.ts';

/** 血緣表節點的狀態標示（需求規格 10.4）：已售出、已引退、已被取代、退出生產行列。 */
export type PedigreeStatus = 'sold' | 'retired' | 'replaced' | 'outOfService';

export interface PedigreeHorseNode {
  readonly kind: 'horse';
  readonly horseId: string;
  readonly name: string;
  readonly sex: Sex;
  readonly birthYear: number | undefined;
  readonly statuses: readonly PedigreeStatus[];
  /** 同一匹馬在這張血緣表的祖先中出現兩次以上。 */
  readonly duplicate: boolean;
  /** 已達顯示代數，但還有更上一代的資料。 */
  readonly expandable: boolean;
  /** 已達顯示代數時為 undefined。 */
  readonly sire: PedigreeNode | undefined;
  readonly dam: PedigreeNode | undefined;
}

/** 父母只有匯入名稱，尚未連結內部馬匹。 */
export interface PedigreeExternalNode {
  readonly kind: 'external';
  readonly name: string;
  readonly sex: Sex;
}

/** 父母沒有內部識別也沒有名稱：資料不足。 */
export interface PedigreeMissingNode {
  readonly kind: 'missing';
  readonly sex: Sex;
}

export type PedigreeNode = PedigreeHorseNode | PedigreeExternalNode | PedigreeMissingNode;

export interface PedigreeSource {
  readonly horses: ReadonlyMap<string, Horse>;
  readonly statusOf: (horseId: string) => readonly PedigreeStatus[];
  readonly nameOf: (horse: Horse) => string;
}

function parentIds(horse: Horse): string[] {
  return [horse.sireId, horse.damId].filter((id): id is string => id !== undefined);
}

function hasParentData(horse: Horse): boolean {
  return (
    horse.sireId !== undefined ||
    horse.sireName !== undefined ||
    horse.damId !== undefined ||
    horse.damName !== undefined
  );
}

/** 顯示範圍內各祖先（不含起點）出現的次數。 */
function countAncestors(
  root: Horse,
  generations: number,
  horses: ReadonlyMap<string, Horse>,
): Map<string, number> {
  const counts = new Map<string, number>();
  let level: Horse[] = [root];
  for (let depth = 1; depth <= generations; depth += 1) {
    const next: Horse[] = [];
    for (const horse of level) {
      for (const id of parentIds(horse)) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
        const parent = horses.get(id);
        if (parent !== undefined) {
          next.push(parent);
        }
      }
    }
    level = next;
  }
  return counts;
}

/**
 * 血緣表（需求規格 10.4）：從任一馬匹依內部識別向上展開指定代數。已售出、引退、被取代者照常列出並標示狀態，
 * 不形成斷點；只有匯入名稱的父母以外部參考節點顯示；標示重複祖先與資料不足的節點。
 */
export function buildPedigree(
  rootId: string,
  generations: number,
  source: PedigreeSource,
): PedigreeHorseNode | undefined {
  const root = source.horses.get(rootId);
  if (root === undefined) {
    return undefined;
  }
  const counts = countAncestors(root, generations, source.horses);

  const parentNode = (
    id: string | undefined,
    name: string | undefined,
    sex: Sex,
    depth: number,
  ): PedigreeNode => {
    const parent = id === undefined ? undefined : source.horses.get(id);
    if (parent !== undefined) {
      return horseNode(parent, depth);
    }
    return name === undefined ? { kind: 'missing', sex } : { kind: 'external', name, sex };
  };

  const horseNode = (horse: Horse, depth: number): PedigreeHorseNode => {
    const atLimit = depth >= generations;
    return {
      kind: 'horse',
      horseId: horse.id,
      name: source.nameOf(horse),
      sex: horse.sex,
      birthYear: horse.birthYear,
      statuses: source.statusOf(horse.id),
      duplicate: depth > 0 && (counts.get(horse.id) ?? 0) > 1,
      expandable: atLimit && hasParentData(horse),
      sire: atLimit ? undefined : parentNode(horse.sireId, horse.sireName, 'male', depth + 1),
      dam: atLimit ? undefined : parentNode(horse.damId, horse.damName, 'female', depth + 1),
    };
  };

  return horseNode(root, 0);
}
