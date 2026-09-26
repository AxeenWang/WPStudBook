import type { LinePosition } from './lines'

/** 系統對照表的一筆：子系統與它的親系統（需求規格 7.2） */
export interface SystemEntry {
  /** 子系統名稱，例如 `マンノウォー` */
  subsystem: string
  /** 親系統名稱，例如 `マッチェム` */
  parentSystem: string
  /** 分出來源：這個子系統原本從哪一個子系統獨立出來；沒有登錄時留空 */
  origin?: string
}

/** 使用者維護的系統對照表 */
export type SystemTable = readonly SystemEntry[]

/** 某個系位置目前的系統；系尚未開啟時兩個欄位都是 null（需求規格 7.1） */
export interface LineSystem {
  line: LinePosition
  subsystem: string | null
  parentSystem: string | null
}

/** 八系目前的系統，八個系位置各一筆 */
export type LineSystemSnapshot = readonly LineSystem[]

/** 查子系統的親系統；沒有登錄時回傳 null */
export function parentSystemOf(table: SystemTable, subsystem: string | null): string | null {
  if (subsystem === null) return null
  return table.find((entry) => entry.subsystem === subsystem)?.parentSystem ?? null
}

/** 查子系統的分出來源；沒有登錄時回傳 null（需求規格 7.2，10.2 的始祖例外用） */
export function originOf(table: SystemTable, subsystem: string | null): string | null {
  if (subsystem === null) return null
  return table.find((entry) => entry.subsystem === subsystem)?.origin ?? null
}

/** 兩個以上的系用同一個親系統（需求規格 7.2） */
export interface ParentSystemDuplicate {
  parentSystem: string
  /** 用到這個親系統的系，由小到大 */
  lines: LinePosition[]
}

export interface LineSystemSummary {
  /** 八系用到的親系統種類數；活血最多只能到這個數（需求規格 4.3、7.2） */
  distinctCount: number
  duplicates: ParentSystemDuplicate[]
}

/** 總覽用：八系親系統的種類數與重複的系（需求規格 7.2） */
export function summarizeLineSystems(lines: LineSystemSnapshot): LineSystemSummary {
  const byParentSystem = new Map<string, LinePosition[]>()
  for (const entry of lines) {
    if (entry.parentSystem === null) continue
    const group = byParentSystem.get(entry.parentSystem) ?? []
    group.push(entry.line)
    byParentSystem.set(entry.parentSystem, group)
  }
  const duplicates: ParentSystemDuplicate[] = []
  for (const [parentSystem, group] of byParentSystem) {
    if (group.length > 1) {
      duplicates.push({ parentSystem, lines: [...group].sort((a, b) => a - b) })
    }
  }
  return { distinctCount: byParentSystem.size, duplicates }
}

/**
 * 建立新系或更新系統名稱時的親系統檢查（需求規格 7.2）：
 * 與其他系目前的親系統重複時回傳衝突，由畫面警告並確認；沒有重複時回傳 null。
 */
export function findParentSystemConflict(
  lines: LineSystemSnapshot,
  line: LinePosition,
  parentSystem: string | null,
): ParentSystemDuplicate | null {
  if (parentSystem === null) return null
  const conflicting = lines
    .filter((entry) => entry.line !== line && entry.parentSystem === parentSystem)
    .map((entry) => entry.line)
    .sort((a, b) => a - b)
  return conflicting.length === 0 ? null : { parentSystem, lines: conflicting }
}

/**
 * 系統名稱的統一寫法：去掉前後空白與結尾的「系」（需求規格 11.1：`エクリプス系` → `エクリプス`）。
 * 匯入檔的 `父系` 與手動輸入的系統名稱都照這個寫法保存，才對得上系統對照表；沒有名稱時回傳 null。
 */
export function normalizeSystemName(text: string): string | null {
  const trimmed = text.trim()
  const name = trimmed.endsWith('系') ? trimmed.slice(0, -1) : trimmed
  return name === '' ? null : name
}
