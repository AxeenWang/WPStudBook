import type { PedigreeHorse, PedigreeNode } from '../../src/core/pedigree'

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
