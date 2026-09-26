import { normalizeSystemName } from '../core/systems'
import type { WPStudBookDatabase } from './database'
import type { SystemRow, SystemValue } from './records'
import {
  confirmation,
  gate,
  lineSystemsFromRows,
  parentDuplicateWarnings,
  readLinesAndSystems,
  runWrite,
  type WriteContext,
  type WriteOptions,
  type WriteResult,
} from './writes'

// 系統對照表的寫入操作（需求規格 7.2；技術設計 4.3「寫入操作」）

/** 新增系統對照表一筆的輸入 */
export interface NewSystemInput {
  subsystem: string
  parentSystem: string
  /** 分出來源；留空或只有空白表示沒有 */
  origin?: string
}

/** 修改系統對照表一筆的輸入：親系統（升格）與分出來源；分出來源留空表示清除 */
export interface SystemChangeInput {
  parentSystem: string
  origin?: string
}

/**
 * 系統對照表的阻止原因：
 * - blank：必填的名稱空白（名稱先去掉前後空白與結尾「系」）
 * - origin-is-self：分出來源是這個子系統自己
 * - already-registered：新增的子系統已經登錄，請改用修改
 */
export type SystemBlock =
  | { kind: 'blank'; field: 'subsystem' | 'parentSystem' }
  | { kind: 'origin-is-self' }
  | { kind: 'already-registered' }

/**
 * 新增系統對照表的一筆（需求規格 7.2）。名稱都經 normalizeSystemName；子系統不能已經登錄。
 * 已開啟的系因此有了親系統、而且與其他系重複時警告並確認。寫入事件 system-added。
 */
export async function addSystem(
  db: WPStudBookDatabase,
  gameId: string,
  input: NewSystemInput,
  options: WriteOptions = {},
): Promise<WriteResult<SystemRow, SystemBlock>> {
  return runWrite(db, gameId, [db.lines, db.systems], options, async (context) => {
    const { lines, systems } = await readLinesAndSystems(context)
    const subsystem = normalizeSystemName(input.subsystem)
    const parentSystem = normalizeSystemName(input.parentSystem)
    const origin = optionalName(input.origin)
    const blocks = systemBlocks(subsystem, parentSystem, origin)
    if (subsystem !== null && systems.some((row) => row.subsystem === subsystem)) {
      blocks.push({ kind: 'already-registered' })
    }
    if (subsystem === null || parentSystem === null || blocks.length > 0) {
      return { status: 'blocked', blocks }
    }
    const row = systemRow(gameId, subsystem, { parentSystem, origin })
    const warnings = parentDuplicateWarnings(
      lineSystemsFromRows(lines, systems),
      lineSystemsFromRows(lines, [...systems, row]),
    )
    const stop = gate([], warnings, context.confirmed)
    if (stop) return stop
    await db.systems.add(row)
    await context.addEvent({
      kind: 'system-added',
      system: subsystem,
      ...systemValue(row),
      ...confirmation(warnings),
    })
    return context.done(row, warnings)
  })
}

/**
 * 修改系統對照表的一筆（需求規格 7.2）：改親系統（子系統升格）或分出來源，子系統名稱不改。
 * 已開啟的系因此改了親系統、而且與其他系重複時警告並確認。
 * 事件 system-changed 記原值、新值與年份；沒有變更時不寫入。子系統沒有登錄時丟出錯誤。
 */
export async function changeSystem(
  db: WPStudBookDatabase,
  gameId: string,
  subsystem: string,
  change: SystemChangeInput,
  options: WriteOptions = {},
): Promise<WriteResult<SystemRow, SystemBlock>> {
  return runWrite(db, gameId, [db.lines, db.systems], options, async (context) => {
    const { lines, systems } = await readLinesAndSystems(context)
    const current = systems.find((row) => row.subsystem === subsystem)
    if (!current) throw new Error(`找不到系統對照表的子系統：${subsystem}`)
    const parentSystem = normalizeSystemName(change.parentSystem)
    const origin = optionalName(change.origin)
    const blocks = systemBlocks(subsystem, parentSystem, origin)
    if (parentSystem === null || blocks.length > 0) return { status: 'blocked', blocks }
    const next = systemRow(gameId, subsystem, { parentSystem, origin })
    if (next.parentSystem === current.parentSystem && next.origin === current.origin) {
      return { status: 'done', value: current, warnings: [] }
    }
    const warnings = parentDuplicateWarnings(
      lineSystemsFromRows(lines, systems),
      lineSystemsFromRows(
        lines,
        systems.map((row) => (row.subsystem === subsystem ? next : row)),
      ),
    )
    const stop = gate([], warnings, context.confirmed)
    if (stop) return stop
    await db.systems.put(next)
    await context.addEvent({
      kind: 'system-changed',
      system: subsystem,
      from: systemValue(current),
      to: systemValue(next),
      ...confirmation(warnings),
    })
    return context.done(next, warnings)
  })
}

/** 選填的系統名稱：沒有填或只有空白時為 null */
function optionalName(text: string | undefined): string | null {
  return text === undefined ? null : normalizeSystemName(text)
}

/** 名稱空白與分出來源是自己的阻止原因 */
function systemBlocks(
  subsystem: string | null,
  parentSystem: string | null,
  origin: string | null,
): SystemBlock[] {
  const blocks: SystemBlock[] = []
  if (subsystem === null) blocks.push({ kind: 'blank', field: 'subsystem' })
  if (parentSystem === null) blocks.push({ kind: 'blank', field: 'parentSystem' })
  if (origin !== null && origin === subsystem) blocks.push({ kind: 'origin-is-self' })
  return blocks
}

/** 對照表的一列；沒有分出來源時不寫那個欄位 */
function systemRow(
  gameId: string,
  subsystem: string,
  value: { parentSystem: string; origin: string | null },
): SystemRow {
  return value.origin === null
    ? { gameId, subsystem, parentSystem: value.parentSystem }
    : { gameId, subsystem, parentSystem: value.parentSystem, origin: value.origin }
}

/** 事件記下的對照表內容：親系統與分出來源 */
function systemValue(row: SystemRow): SystemValue {
  return row.origin === undefined
    ? { parentSystem: row.parentSystem }
    : { parentSystem: row.parentSystem, origin: row.origin }
}

/**
 * 對照表把 subsystem 登錄或改成 parentSystem 之後的內容（純函式，不寫入）：
 * 沒登錄時新增一筆；已登錄時改親系統，分出來源不變
 */
export function withSystemEntry(
  rows: readonly SystemRow[],
  gameId: string,
  subsystem: string,
  parentSystem: string,
): SystemRow[] {
  if (!rows.some((row) => row.subsystem === subsystem)) {
    return [...rows, { gameId, subsystem, parentSystem }]
  }
  return rows.map((row) => (row.subsystem === subsystem ? { ...row, parentSystem } : row))
}

/**
 * 寫入 withSystemEntry 的變更與對照表事件（system-added 或 system-changed）；已經相同時什麼都不做。
 * 開啟新系與系統名稱變更填了親系統時使用；在 runWrite 的交易內呼叫，交易要包含 systems
 */
export async function saveSystemEntry(
  context: WriteContext,
  rows: readonly SystemRow[],
  subsystem: string,
  parentSystem: string,
): Promise<void> {
  const { db, game } = context
  const current = rows.find((row) => row.subsystem === subsystem)
  if (!current) {
    await db.systems.add({ gameId: game.id, subsystem, parentSystem })
    await context.addEvent({ kind: 'system-added', system: subsystem, parentSystem })
  } else if (current.parentSystem !== parentSystem) {
    const next = { ...current, parentSystem }
    await db.systems.put(next)
    await context.addEvent({
      kind: 'system-changed',
      system: subsystem,
      from: systemValue(current),
      to: systemValue(next),
    })
  }
}
