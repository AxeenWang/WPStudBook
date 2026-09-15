import type { LinePosition } from './line.ts';

export type PairDistance = 1 | 2 | 4;

/** 市場馬（含替代母馬、建系與補系用的市場種牡馬）為零代（需求規格 3 章「代數」）。 */
export const MARKET_GENERATION = 0;

const DISTANCE_CYCLE = [1, 2, 4] as const;

/** 需求規格 4.3、7.3：產出 1 代是起點沒有距離，2、5、8…代為 1，3、6、9…代為 2，4、7、10…代為 4。 */
export function pairDistanceFor(targetGeneration: number): PairDistance | undefined {
  if (!Number.isInteger(targetGeneration) || targetGeneration < 2) {
    return undefined;
  }
  return DISTANCE_CYCLE[(targetGeneration - 2) % 3];
}

export interface Lineage {
  readonly position: LinePosition;
  readonly generation: number;
}

/** 需求規格 8.2：產駒屬於父馬所在的系位置，代數為父母代數較大者加 1。 */
export function offspringLineage(sire: Lineage, damGeneration: number): Lineage {
  return { position: sire.position, generation: Math.max(sire.generation, damGeneration) + 1 };
}
