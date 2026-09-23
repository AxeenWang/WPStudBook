import type { LineGeneration } from './lines'
import { parentSystemOf, type LineSystem, type SystemTable } from './systems'

/**
 * 種牡馬接任後的狀態（需求規格 7.7）：
 * active 在崗、replaced 已被取代、withdrawn 退出生產行列、retired 已引退；退出與引退由使用者標示
 */
export type StallionStatus = 'active' | 'replaced' | 'withdrawn' | 'retired'

/** 兄弟比較與選定現任用的種牡馬資料（由儲存層依馬匹紀錄彙整） */
export interface StallionRecord {
  /** 內部識別 */
  id: string
  /** 所在的系與代數：自家產駒依出生紀錄，市場種牡馬為該系零代 */
  placement: LineGeneration
  /** 父馬的內部識別；市場種牡馬沒有 */
  sireId?: string
  /** 接任後的狀態；還沒接任時留空 */
  status?: StallionStatus
}

/** 兄弟比較不接受的種牡馬：與比較對象不同系、不同代或不同父 */
export interface BrotherBlock {
  id: string
  mismatches: ('line' | 'generation' | 'sire')[]
}

/**
 * 兄弟比較只接受同系同代的同父兄弟，不要求同母（需求規格 7.7）；選入不符的種牡馬一律阻止。
 * reference 是比較的對象（例如目前的現任），candidates 是要選入並排比較的種牡馬。
 * 比較只列資料，不判定優劣，也不自動更換現任。
 */
export function checkBrothers(
  reference: StallionRecord,
  candidates: readonly StallionRecord[],
): BrotherBlock[] {
  const blocks: BrotherBlock[] = []
  for (const candidate of candidates) {
    const mismatches: BrotherBlock['mismatches'] = []
    if (candidate.placement.line !== reference.placement.line) mismatches.push('line')
    if (candidate.placement.generation !== reference.placement.generation) {
      mismatches.push('generation')
    }
    if (reference.sireId === undefined || candidate.sireId !== reference.sireId) {
      mismatches.push('sire')
    }
    if (mismatches.length > 0) blocks.push({ id: candidate.id, mismatches })
  }
  return blocks
}

/** 種牡馬狀態的變更；還沒接任的種牡馬沒有 from */
export interface StallionStatusChange {
  id: string
  from?: StallionStatus
  to: StallionStatus
}

/**
 * 使用者選定現任（需求規格 7.7）：每系每代同時只有一匹在崗。
 * 選定的改為在崗，同系同代原本在崗的改為已被取代；其他系、其他代與已退出、已引退的不變。
 * 前任、後任、生效年與原因由儲存層保存，前任的配種、產駒與血緣保持原連結。
 * 選定的種牡馬不在 stallions 中，或已退出生產行列、已引退時丟出 RangeError。
 */
export function chooseIncumbent(
  chosenId: string,
  stallions: readonly StallionRecord[],
): StallionStatusChange[] {
  const chosen = stallions.find((stallion) => stallion.id === chosenId)
  if (!chosen) throw new RangeError(`找不到要接任的種牡馬：${chosenId}`)
  if (chosen.status === 'withdrawn' || chosen.status === 'retired') {
    throw new RangeError(`已退出生產行列或已引退的種牡馬不能接任：${chosenId}`)
  }
  const changes: StallionStatusChange[] = []
  if (chosen.status !== 'active') changes.push({ id: chosen.id, from: chosen.status, to: 'active' })
  for (const stallion of stallions) {
    if (
      stallion.id !== chosen.id &&
      stallion.status === 'active' &&
      stallion.placement.line === chosen.placement.line &&
      stallion.placement.generation === chosen.placement.generation
    ) {
      changes.push({ id: stallion.id, from: 'active', to: 'replaced' })
    }
  }
  return changes
}

/** 替換的零代市場種牡馬與所在系的系統差異 */
export interface MarketStallionSystemCheck {
  /** 子系統不同：警告並確認，確認後更新該系目前的子系統名稱 */
  subsystem: { current: string | null; replacement: string } | null
  /** 親系統也不同：一併提示影響活血；替換者的子系統沒登錄在對照表時 replacement 為 null */
  parentSystem: { current: string | null; replacement: string | null } | null
}

/**
 * 市場種牡馬替換提前引退的零代種牡馬時（需求規格 7.7、11.9），
 * 比較他本身的父系與該系目前的子系統：不同時警告並確認；親系統也不同時一併提示影響活血。
 * 父系不明時無法比較，不警告。
 */
export function checkMarketStallionSystem(
  line: LineSystem,
  sireSystem: string | undefined,
  table: SystemTable,
): MarketStallionSystemCheck {
  if (sireSystem === undefined || sireSystem === line.subsystem) {
    return { subsystem: null, parentSystem: null }
  }
  const replacementParent = parentSystemOf(table, sireSystem)
  return {
    subsystem: { current: line.subsystem, replacement: sireSystem },
    parentSystem:
      replacementParent === line.parentSystem
        ? null
        : { current: line.parentSystem, replacement: replacementParent },
  }
}

/** 現任種牡馬的提醒年齡預設 26 歲（需求規格 7.7） */
export const DEFAULT_STALLION_REMINDER_AGE = 26

/** 現任達提醒年齡（可調）時提醒準備後繼；只提示（需求規格 7.7） */
export function needsSuccessorReminder(age: number, reminderAge: number): boolean {
  return age >= reminderAge
}
