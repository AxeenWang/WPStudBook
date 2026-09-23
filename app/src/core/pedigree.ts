/** 血統中的一匹馬（規則輸入；由儲存層依馬匹紀錄彙整） */
export interface PedigreeHorse {
  /** 內部識別；4 代內是否重複以此判斷（需求規格 6.1） */
  id: string
  /** 馬名；判斷始祖例外用（父系與自己同名，需求規格 10.2） */
  name?: string
  /** 這匹馬的父系，也就是他父親所屬的子系統；不知道時留空（需求規格第 3 章） */
  sireSystem?: string
  /** 建系期的市場馬（零代市場種牡馬或替代母馬）；資料不足的例外判斷用（需求規格 10.2） */
  buildPhaseMarket?: boolean
}

/** 血統節點；父母沒有內部紀錄時為 null */
export interface PedigreeNode {
  horse: PedigreeHorse
  sire: PedigreeNode | null
  dam: PedigreeNode | null
}

/** 一次配種的雙方；沒有內部紀錄時為 null */
export interface Mating {
  sire: PedigreeNode | null
  dam: PedigreeNode | null
}

/** 4 代內的代數上限：父母、祖父母、曾祖父母、高祖父母（需求規格 10.2） */
export const CLOSE_GENERATIONS = 4

/**
 * 第 generation 代祖先，依父、母展開（1 是父母，4 是高祖父母），共 2 的 generation 次方個位置；
 * 沒有內部紀錄的位置為 null，它上面的祖先也都是 null。
 */
export function ancestorsAt(mating: Mating, generation: number): (PedigreeNode | null)[] {
  if (!Number.isInteger(generation) || generation < 1) {
    throw new RangeError(`祖先代數必須是 1 以上的整數：${generation}`)
  }
  let current: (PedigreeNode | null)[] = [mating.sire, mating.dam]
  for (let level = 1; level < generation; level++) {
    current = current.flatMap((node) => [node?.sire ?? null, node?.dam ?? null])
  }
  return current
}

/** 4 代內出現兩次以上的馬（需求規格 4.3 インブリード、10.2） */
export interface DuplicateAncestor {
  horse: PedigreeHorse
  /** 出現在哪幾代，由小到大；1 是父母 */
  generations: number[]
  /** 在 4 代內出現的次數 */
  count: number
}

/**
 * 4 代內重複的馬（需求規格 10.2）：只看父母到高祖父母的 30 個位置，
 * 只在第 5 代才重複的不算。
 */
export function duplicateAncestors(mating: Mating): DuplicateAncestor[] {
  const seen = new Map<string, DuplicateAncestor>()
  for (let generation = 1; generation <= CLOSE_GENERATIONS; generation++) {
    for (const node of ancestorsAt(mating, generation)) {
      if (!node) continue
      const entry = seen.get(node.horse.id) ?? { horse: node.horse, generations: [], count: 0 }
      entry.count += 1
      if (!entry.generations.includes(generation)) entry.generations.push(generation)
      seen.set(node.horse.id, entry)
    }
  }
  return [...seen.values()].filter((entry) => entry.count > 1)
}
