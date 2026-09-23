import { BUILD_PHASE_LAST_GENERATION, type LinePosition } from './lines'
import {
  ancestorSlots,
  duplicateAncestors,
  type AncestorSlot,
  type DuplicateAncestor,
  type Mating,
} from './pedigree'
import { parentSystemOf, type LineSystemSnapshot, type SystemTable } from './systems'

/** 活血成立的最少種數（需求規格 4.3：3 代前 8 匹祖先的親系統 6 種以上成立） */
export const VITALITY_ESTABLISHED = 6

/** 活血的最大種數（需求規格 4.3） */
export const VITALITY_MAX = 8

/** 3 代前一個位置的親系統 */
export interface VitalitySlot extends AncestorSlot {
  /** 這個位置的親系統；判斷不出來時為 null */
  parentSystem: string | null
}

/**
 * exact：8 個位置都判斷得出來，顯示確定的種數
 * at-least：有未知位置，但已知種數已達成立門檻，顯示「至少 N 種（成立）」
 * insufficient：有未知位置且已知種數未達門檻，顯示「資料不足」
 */
export type VitalityStatus = 'exact' | 'at-least' | 'insufficient'

export interface VitalityEstimate {
  slots: VitalitySlot[]
  /** 已知的親系統種類數 */
  count: number
  status: VitalityStatus
  /** 活血是否成立（已知種數達 6 種） */
  established: boolean
  /** 還缺的系：八系目前的親系統沒有出現在 3 代前的（需求規格 10.2） */
  missingLines: LinePosition[]
  /** 判斷不出親系統的位置，也就是決定還缺的系的未知祖先（需求規格 10.2） */
  unknownSlots: number[]
}

/** 預估產駒的活血種數（需求規格 4.3、10.2） */
export function estimateVitality(
  mating: Mating,
  table: SystemTable,
  lines: LineSystemSnapshot,
): VitalityEstimate {
  const slots: VitalitySlot[] = ancestorSlots(mating, table).map((slot) => ({
    ...slot,
    parentSystem: parentSystemOf(table, slot.subsystem),
  }))
  const known = slots
    .map((slot) => slot.parentSystem)
    .filter((parentSystem): parentSystem is string => parentSystem !== null)
  const count = new Set(known).size
  const unknownSlots = slots.filter((slot) => slot.parentSystem === null).map((slot) => slot.index)
  const missingLines = lines
    .filter((entry) => entry.parentSystem !== null && !known.includes(entry.parentSystem))
    .map((entry) => entry.line)
  const established = count >= VITALITY_ESTABLISHED
  const status: VitalityStatus =
    unknownSlots.length === 0 ? 'exact' : established ? 'at-least' : 'insufficient'
  return { slots, count, status, established, missingLines, unknownSlots }
}

/**
 * 血統警告（需求規格 10.2）：
 * - vitality-below-max：活血少於 8 種
 * - close-inbreeding：4 代內有重複的馬
 * - insufficient-data：血統資料不足
 */
export type PedigreeWarningKind = 'vitality-below-max' | 'close-inbreeding' | 'insufficient-data'

export interface PedigreeWarning {
  kind: PedigreeWarningKind
  /** 只提示、不要求確認：未知位置只來自建系期的市場種牡馬或替代母馬（需求規格 10.2 的例外） */
  hintOnly: boolean
}

export interface PedigreeCheck {
  /** 建系期不計算活血（需求規格 10.1），此時為 null */
  estimate: VitalityEstimate | null
  duplicates: DuplicateAncestor[]
  warnings: PedigreeWarning[]
}

/**
 * 指定配種前的血統檢查（需求規格 10.1、10.2）。
 * 建系期（產出 4 代以下）不計算活血，也不因市場馬血統不完整而警告；
 * 循環期的警告一律只警告並確認，不阻止。
 */
export function checkPedigree(
  outputGeneration: number,
  mating: Mating,
  table: SystemTable,
  lines: LineSystemSnapshot,
): PedigreeCheck {
  if (outputGeneration <= BUILD_PHASE_LAST_GENERATION) {
    return { estimate: null, duplicates: [], warnings: [] }
  }
  const estimate = estimateVitality(mating, table, lines)
  const duplicates = duplicateAncestors(mating)
  const warnings: PedigreeWarning[] = []
  // 例外只適用於未知位置造成的警告，而且所有未知位置都要來自建系期市場馬
  const unknownOnlyFromBuildPhase = estimate.slots
    .filter((slot) => slot.parentSystem === null)
    .every((slot) => slot.fromBuildPhaseMarket)
  if (estimate.status === 'insufficient') {
    warnings.push({ kind: 'insufficient-data', hintOnly: unknownOnlyFromBuildPhase })
  } else if (estimate.count < VITALITY_MAX) {
    warnings.push({
      kind: 'vitality-below-max',
      hintOnly: estimate.status === 'at-least' && unknownOnlyFromBuildPhase,
    })
  }
  if (duplicates.length > 0) warnings.push({ kind: 'close-inbreeding', hintOnly: false })
  return { estimate, duplicates, warnings }
}
