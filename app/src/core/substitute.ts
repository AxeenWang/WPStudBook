import type { LinePosition } from './lines'
import {
  findParentSystemConflict,
  parentSystemOf,
  type LineSystemSnapshot,
  type SystemTable,
} from './systems'

/** 替代第 forLine 系第 forGeneration 代的市場母馬（需求規格 8.3） */
export interface SubstituteMare {
  forLine: LinePosition
  forGeneration: number
  /** 自身父系所屬：她父馬的子系統；不知道時留空 */
  ownSireSystem?: string
}

/** 撞到的對象：已成立的系，或同一代替代其他系的市場母馬 */
export type SubstituteConflictKind = 'line' | 'substitute'

export interface SubstituteConflict {
  kind: SubstituteConflictKind
  parentSystem: string
  /** 撞到的系；kind 為 substitute 時是那些母馬替代的系，由小到大 */
  lines: LinePosition[]
}

export interface SubstituteCheck {
  /** 自身父系留空或對照表查不到，無法判斷：只提示、不要求確認（需求規格 8.3） */
  unknown: boolean
  /** 有內容時警告並確認（需求規格 8.3、10.3） */
  conflicts: SubstituteConflict[]
}

/**
 * 替代母馬的親系統會不會讓後代 3 代前撞系（需求規格 8.3）。
 * others 是同一代、已登記的其他替代母馬；替代同一系的母馬之間不比較。
 * 與她替代的系相同（最理想），或八系與同代其他替代母馬都沒用到的親系統，都不警告。
 */
export function checkSubstituteMare(
  mare: SubstituteMare,
  table: SystemTable,
  lines: LineSystemSnapshot,
  others: readonly SubstituteMare[],
): SubstituteCheck {
  const parentSystem = parentSystemOf(table, mare.ownSireSystem ?? null)
  if (parentSystem === null) return { unknown: true, conflicts: [] }

  const conflicts: SubstituteConflict[] = []
  // 與第 q 系以外的已成立系相同：和建立新系時的親系統檢查是同一條規則（需求規格 7.2、8.3）
  const lineConflict = findParentSystemConflict(lines, mare.forLine, parentSystem)
  if (lineConflict) conflicts.push({ kind: 'line', ...lineConflict })

  const conflictingMares = others
    .filter(
      (other) =>
        other.forGeneration === mare.forGeneration &&
        other.forLine !== mare.forLine &&
        parentSystemOf(table, other.ownSireSystem ?? null) === parentSystem,
    )
    .map((other) => other.forLine)
  if (conflictingMares.length > 0) {
    conflicts.push({
      kind: 'substitute',
      parentSystem,
      lines: [...new Set(conflictingMares)].sort((a, b) => a - b),
    })
  }
  return { unknown: false, conflicts }
}
