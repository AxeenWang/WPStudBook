import type { MareGroupRef } from './designated'
import { assertGeneration, type LineGeneration, type LinePosition } from './lines'

/**
 * 母馬在規則上的身分（需求規格 8.2、8.3）：
 * - own：自家母駒，系與代數由出生紀錄決定
 * - substitute：替代第 forLine 系第 forGeneration 代的市場母馬，本身是零代
 * - start：第 1 系起點用的市場母馬
 */
export type DamRole =
  | { kind: 'own'; line: LinePosition; generation: number }
  | { kind: 'substitute'; forLine: LinePosition; forGeneration: number }
  | { kind: 'start' }

/**
 * 母馬計入的母馬群（需求規格 8.3）：自家母駒在出生紀錄的系與代數，
 * 替代母馬在她替代的系與代數，起點母馬在第 1 系起點母馬群。
 * 自家母駒與替代的代數從 1 代起，不符時丟出 RangeError。
 */
export function damPlacement(dam: DamRole): MareGroupRef {
  switch (dam.kind) {
    case 'own':
      assertGeneration(dam.generation, '母馬代數', 1)
      return { kind: 'group', line: dam.line, generation: dam.generation }
    case 'substitute':
      assertGeneration(dam.forGeneration, '替代代數', 1)
      return { kind: 'group', line: dam.forLine, generation: dam.forGeneration }
    case 'start':
      return { kind: 'start' }
  }
}

/** 計算產駒代數時母馬的代數：替代母馬以她替代的代數計，起點母馬為零代（需求規格 8.2） */
export function damGeneration(dam: DamRole): number {
  const placement = damPlacement(dam)
  return placement.kind === 'start' ? 0 : placement.generation
}

/**
 * 產駒的系與代數：系跟父馬所在的系位置，代數為父母代數較大者加 1（需求規格 8.2）。
 * 種牡馬代數不是 0 以上的整數時丟出 RangeError。
 */
export function foalPlacement(sire: LineGeneration, dam: DamRole): LineGeneration {
  assertGeneration(sire.generation, '種牡馬代數', 0)
  return { line: sire.line, generation: Math.max(sire.generation, damGeneration(dam)) + 1 }
}
