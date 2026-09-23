import { LINE_POSITIONS, type LinePosition } from '../../src/core/lines'
import type { LineSystem, SystemEntry } from '../../src/core/systems'

/** 測試用的第 line 系子系統名稱 */
export function subsystemOfLine(line: LinePosition): string {
  return `系${line}子`
}

/** 測試用的第 line 系親系統名稱 */
export function parentSystemOfLine(line: LinePosition): string {
  return `系${line}親`
}

/** 測試用：以「系位置 → [子系統, 親系統]」建立八系目前的系統；沒寫到的系為未開啟 */
export function lineSystemsOf(
  specs: Partial<Record<LinePosition, readonly [subsystem: string, parentSystem: string]>>,
): LineSystem[] {
  return LINE_POSITIONS.map((line) => {
    const spec = specs[line]
    return { line, subsystem: spec?.[0] ?? null, parentSystem: spec?.[1] ?? null }
  })
}

/** 測試用：以「[子系統, 親系統, 分出來源?]」建立系統對照表 */
export function systemTableOf(
  entries: readonly (readonly [subsystem: string, parentSystem: string, origin?: string])[],
): SystemEntry[] {
  return entries.map(([subsystem, parentSystem, origin]) => ({ subsystem, parentSystem, origin }))
}

/** 測試用：八系各有自己的子系統與親系統，對照表與八系現況一致 */
export function eightLineSystems(): { table: SystemEntry[]; lines: LineSystem[] } {
  return {
    table: LINE_POSITIONS.map((line) => ({
      subsystem: subsystemOfLine(line),
      parentSystem: parentSystemOfLine(line),
    })),
    lines: LINE_POSITIONS.map((line) => ({
      line,
      subsystem: subsystemOfLine(line),
      parentSystem: parentSystemOfLine(line),
    })),
  }
}
