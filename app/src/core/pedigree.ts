import { assertGeneration } from './lines'
import { originOf, type SystemTable } from './systems'

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
  assertGeneration(generation, '祖先代數', 1)
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

/** 3 代前祖先的位置數（需求規格 4.3：3 代前 8 匹祖先） */
export const ANCESTOR_SLOTS = 8

/** 3 代前 8 個位置之一的系統判斷（需求規格 10.2） */
export interface AncestorSlot {
  /** 位置 0～7；0 是父父父，7 是母母母 */
  index: number
  /** 這個位置的馬；沒有內部紀錄時為 null */
  horse: PedigreeHorse | null
  /** 這個位置的子系統；判斷不出來時為 null */
  subsystem: string | null
  /** 子系統是由子女的父系推定的，畫面標示「推定」（需求規格 10.2） */
  inferred: boolean
  /** 沒有內部紀錄，而且他的子女是建系期市場馬（需求規格 10.2 的例外） */
  fromBuildPhaseMarket: boolean
}

/**
 * 3 代前 8 匹祖先的子系統（需求規格 10.2）：
 * 有內部紀錄的馬，系統就是他自己的父系；沒有紀錄的父親，用子女的父系推定；
 * 沒有紀錄的母親一律未知（匯入檔沒有母父系統）。
 */
export function ancestorSlots(mating: Mating, table: SystemTable): AncestorSlot[] {
  const children = ancestorsAt(mating, 2)
  return ancestorsAt(mating, 3).map((node, index) => {
    if (node) {
      return {
        index,
        horse: node.horse,
        subsystem: node.horse.sireSystem ?? null,
        inferred: false,
        fromBuildPhaseMarket: false,
      }
    }
    const child = children[index >> 1] ?? null
    const fromBuildPhaseMarket = child?.horse.buildPhaseMarket === true
    const isSirePosition = index % 2 === 0
    const subsystem = isSirePosition && child ? inferSireSubsystem(child.horse, table) : null
    return { index, horse: null, subsystem, inferred: subsystem !== null, fromBuildPhaseMarket }
  })
}

/**
 * 沒有內部紀錄的父親：系統跟著父親走，所以用子女的父系推定。
 * 子女的父系與子女自己同名時，子女是該系統的始祖，父親屬於分出來源（需求規格 7.2、10.2）；
 * 沒有登錄分出來源時為未知，不以子女自己的系統推定。
 */
function inferSireSubsystem(child: PedigreeHorse, table: SystemTable): string | null {
  const childSystem = child.sireSystem ?? null
  if (childSystem === null) return null
  if (child.name === childSystem) return originOf(table, childSystem)
  return childSystem
}
