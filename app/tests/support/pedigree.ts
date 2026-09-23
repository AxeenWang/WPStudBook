import type { Mating, PedigreeHorse, PedigreeNode } from '../../src/core/pedigree'

export interface HorseSpec extends Omit<PedigreeHorse, 'id'> {
  /** 父；省略表示沒有內部紀錄 */
  sire?: PedigreeNode | null
  /** 母；省略表示沒有內部紀錄 */
  dam?: PedigreeNode | null
}

/** 測試用：建立一個血統節點 */
export function horseNode(id: string, spec: HorseSpec = {}): PedigreeNode {
  const { sire = null, dam = null, ...horse } = spec
  return { horse: { id, ...horse }, sire, dam }
}

/** 測試用：一匹祖父母，以及他 3 代前那兩個位置的子系統 */
export interface GrandparentSpec {
  /** 這匹祖父母自己的父系；他沒有紀錄的父親由此推定 */
  sireSystem?: string
  /** 建系期市場馬（零代市場種牡馬或替代母馬） */
  buildPhaseMarket?: boolean
  /** 父的子系統；省略表示那個位置沒有內部紀錄 */
  sire?: string
  /** 母的子系統；省略表示那個位置沒有內部紀錄 */
  dam?: string
}

/**
 * 測試用：以 4 匹祖父母建立一次配種。
 * 3 代前的 8 個位置由每匹祖父母的 sire、dam 決定，順序與 ancestorSlots 的 index 相同。
 */
export function matingWithGrandparents(
  specs: readonly [GrandparentSpec, GrandparentSpec, GrandparentSpec, GrandparentSpec],
): Mating {
  const grandparent = (index: number): PedigreeNode => {
    const spec = specs[index]
    return horseNode(`G${index}`, {
      sireSystem: spec.sireSystem,
      buildPhaseMarket: spec.buildPhaseMarket,
      sire: spec.sire === undefined ? null : horseNode(`A${index}s`, { sireSystem: spec.sire }),
      dam: spec.dam === undefined ? null : horseNode(`A${index}d`, { sireSystem: spec.dam }),
    })
  }
  return {
    sire: horseNode('P0', { sire: grandparent(0), dam: grandparent(1) }),
    dam: horseNode('P1', { sire: grandparent(2), dam: grandparent(3) }),
  }
}
