import type { LineGeneration, LinePosition } from './lines'

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

/** 計算產駒代數時母馬的代數：替代母馬以她替代的代數計，起點母馬為零代（需求規格 8.2） */
export function damGeneration(dam: DamRole): number {
  switch (dam.kind) {
    case 'own':
      return dam.generation
    case 'substitute':
      return dam.forGeneration
    case 'start':
      return 0
  }
}

/** 產駒的系與代數：系跟父馬所在的系位置，代數為父母代數較大者加 1（需求規格 8.2） */
export function foalPlacement(sire: LineGeneration, dam: DamRole): LineGeneration {
  return { line: sire.line, generation: Math.max(sire.generation, damGeneration(dam)) + 1 }
}
