import { listBoard } from '../core/board'
import type { LinePosition } from '../core/lines'
import { normalizeSystemName } from '../core/systems'
import type { WPStudBookDatabase } from './database'
import { buildRuleSnapshot, readRuleRows, ruleTables } from './loaders'
import type { HorseRow, LineRow, StallionRow, WriteWarning } from './records'
import { saveSystemEntry, withSystemEntry } from './system-writes'
import {
  confirmation,
  gate,
  lineSystemsFromRows,
  parentDuplicateWarnings,
  readLinesAndSystems,
  resolveZeroStallion,
  runWrite,
  type WriteContext,
  type WriteOptions,
  type WriteResult,
  type ZeroStallionBlock,
  type ZeroStallionInput,
} from './writes'

// 系的寫入操作：開啟新系、系統名稱變更、代表色（需求規格 7.1、7.2；技術設計 4.3「寫入操作」）

/** 代表色：`#` 加 6 位十六進位 */
const COLOR = /^#[0-9A-Fa-f]{6}$/

/** 開啟新系的輸入（需求規格 7.1） */
export interface OpenLineInput {
  line: LinePosition
  /** 目前子系統 */
  subsystem: string
  /** 子系統的親系統；照對照表的規則新增或修改 */
  parentSystem: string
  /** 代表色（`#rrggbb`）；自動分配由畫面預填 */
  color: string
  stallion: ZeroStallionInput
}

/**
 * 開啟新系的阻止原因：
 * - not-openable：該系不在任務看板的可開啟分支中（已開啟、原系還沒到達分支前一代、或補公系進行中）
 * - blank：子系統或親系統空白
 * - color：代表色的格式不符
 * - 其他：零代市場種牡馬的輸入不符（ZeroStallionBlock）
 */
export type OpenLineBlock =
  | { kind: 'not-openable' }
  | { kind: 'blank'; field: 'subsystem' | 'parentSystem' }
  | { kind: 'color' }
  | ZeroStallionBlock

/** 開啟的系、零代的任用與零代市場種牡馬 */
export interface OpenedLine {
  line: LineRow
  appointment: StallionRow
  horse: HorseRow
}

/**
 * 開啟新系（需求規格 7.1、7.3）：該系要在任務看板的可開啟分支中（技術設計 4.2）。
 * 寫入系位置（開啟年為目前遊戲年）、零代市場種牡馬的在崗任用與事件 line-opened；
 * 子系統沒登錄時新增對照表一筆，已登錄但親系統不同時改為填入的親系統。
 * 親系統與其他系重複時警告並確認（LINE-03）。開啟後不提供撤銷（7.1 位置固定）。
 */
export async function openLine(
  db: WPStudBookDatabase,
  gameId: string,
  input: OpenLineInput,
  options: WriteOptions = {},
): Promise<WriteResult<OpenedLine, OpenLineBlock>> {
  return runWrite(db, gameId, ruleTables(db), options, async (context) => {
    const rows = await readRuleRows(db, gameId, context.game)
    const { openableBranches } = listBoard(buildRuleSnapshot(rows).eightLines)
    const subsystem = normalizeSystemName(input.subsystem)
    const parentSystem = normalizeSystemName(input.parentSystem)
    const blocks: OpenLineBlock[] = []
    if (!openableBranches.some((entry) => entry.branch.newLine === input.line)) {
      blocks.push({ kind: 'not-openable' })
    }
    if (subsystem === null) blocks.push({ kind: 'blank', field: 'subsystem' })
    if (parentSystem === null) blocks.push({ kind: 'blank', field: 'parentSystem' })
    if (!COLOR.test(input.color)) blocks.push({ kind: 'color' })
    const stallion = await resolveZeroStallion(context, input.stallion)
    if (!stallion.ok) blocks.push(...stallion.blocks)
    if (subsystem === null || parentSystem === null || !stallion.ok || blocks.length > 0) {
      return { status: 'blocked', blocks }
    }
    const line: LineRow = {
      gameId,
      line: input.line,
      subsystem,
      color: input.color,
      openedYear: context.game.currentYear,
    }
    const warnings = parentDuplicateWarnings(
      lineSystemsFromRows(rows.lines, rows.systems),
      lineSystemsFromRows(
        [...rows.lines, line],
        withSystemEntry(rows.systems, gameId, subsystem, parentSystem),
      ),
    )
    const stop = gate([], warnings, context.confirmed)
    if (stop) return stop
    const { horse, isNew } = stallion.value
    const appointment: StallionRow = {
      id: crypto.randomUUID(),
      gameId,
      line: input.line,
      generation: 0,
      horseId: horse.id,
      status: 'active',
    }
    await db.lines.add(line)
    await saveSystemEntry(context, rows.systems, subsystem, parentSystem)
    if (isNew) await db.horses.add(horse)
    await db.stallions.add(appointment)
    await context.addEvent({
      kind: 'line-opened',
      line: input.line,
      horseId: horse.id,
      stallionId: appointment.id,
      subsystem,
      ...confirmation(warnings),
    })
    return context.done({ line, appointment, horse }, warnings)
  })
}

/** 系統名稱變更的輸入：新的子系統，以及選填的親系統 */
export interface LineSubsystemInput {
  subsystem: string
  /** 填了就照對照表的規則新增或修改；沒填而對照表查不到時親系統未知（需求規格 7.2） */
  parentSystem?: string
}

/**
 * 系統名稱變更的阻止原因：
 * - blank：子系統空白，或填了親系統卻是空白
 * - unchanged：新名稱與目前相同
 */
export type LineSubsystemBlock =
  { kind: 'blank'; field: 'subsystem' | 'parentSystem' } | { kind: 'unchanged' }

/**
 * 變更已開啟的系目前的子系統名稱（需求規格 7.1、7.2、LINE-06）：位置、任用、配種與代數不變。
 * 親系統因此與其他系重複時警告並確認。事件 line-subsystem-changed 記原名稱、新名稱與年份，
 * 「該系用過的舊名」（7.2）由開啟與名稱變更的事件查得。該系還沒開啟時丟出錯誤。
 */
export async function changeLineSubsystem(
  db: WPStudBookDatabase,
  gameId: string,
  line: LinePosition,
  input: LineSubsystemInput,
  options: WriteOptions = {},
): Promise<WriteResult<LineRow, LineSubsystemBlock>> {
  return runWrite(db, gameId, [db.lines, db.systems], options, async (context) => {
    const { lines, systems } = await readLinesAndSystems(context)
    const current = lines.find((row) => row.line === line)
    if (!current) throw new Error(`第 ${line} 系還沒開啟`)
    const subsystem = normalizeSystemName(input.subsystem)
    const parentSystem =
      input.parentSystem === undefined ? undefined : normalizeSystemName(input.parentSystem)
    const blocks: LineSubsystemBlock[] = []
    if (subsystem === null) blocks.push({ kind: 'blank', field: 'subsystem' })
    else if (subsystem === current.subsystem) blocks.push({ kind: 'unchanged' })
    if (parentSystem === null) blocks.push({ kind: 'blank', field: 'parentSystem' })
    if (subsystem === null || parentSystem === null || blocks.length > 0) {
      return { status: 'blocked', blocks }
    }
    const next = { ...current, subsystem }
    const warnings = parentDuplicateWarnings(
      lineSystemsFromRows(lines, systems),
      lineSystemsFromRows(
        lines.map((row) => (row.line === line ? next : row)),
        parentSystem === undefined
          ? systems
          : withSystemEntry(systems, gameId, subsystem, parentSystem),
      ),
    )
    const stop = gate([], warnings, context.confirmed)
    if (stop) return stop
    if (parentSystem !== undefined) {
      await saveSystemEntry(context, systems, subsystem, parentSystem)
    }
    await saveLineSubsystem(context, current, subsystem, warnings)
    return context.done(next, warnings)
  })
}

/**
 * 寫入系的子系統名稱變更與事件 line-subsystem-changed；系統名稱變更與零代市場種牡馬的補入、替換共用。
 * horseId 是造成變更的零代市場種牡馬，記為事件的對象。在 runWrite 的交易內呼叫，交易要包含 lines
 */
export async function saveLineSubsystem(
  context: WriteContext,
  current: LineRow,
  subsystem: string,
  warnings: readonly WriteWarning[] = [],
  horseId?: string,
): Promise<void> {
  await context.db.lines.put({ ...current, subsystem })
  await context.addEvent({
    kind: 'line-subsystem-changed',
    line: current.line,
    ...(horseId === undefined ? {} : { horseId }),
    from: current.subsystem,
    to: subsystem,
    ...confirmation(warnings),
  })
}

/** 代表色的阻止原因：格式不符 */
export interface LineColorBlock {
  kind: 'color'
}

/**
 * 修改系的代表色（需求規格 7.1）：只檢查格式，不寫事件。和目前相同時不寫入。
 * 該系還沒開啟時丟出錯誤。
 */
export async function changeLineColor(
  db: WPStudBookDatabase,
  gameId: string,
  line: LinePosition,
  color: string,
  options: WriteOptions = {},
): Promise<WriteResult<LineRow, LineColorBlock>> {
  return runWrite(db, gameId, [db.lines], options, async (context) => {
    const current = await db.lines.get([gameId, line])
    if (!current) throw new Error(`第 ${line} 系還沒開啟`)
    const blocks: LineColorBlock[] = COLOR.test(color) ? [] : [{ kind: 'color' }]
    const stop = gate(blocks, [], context.confirmed)
    if (stop) return stop
    if (color === current.color) return { status: 'done', value: current, warnings: [] }
    const next = { ...current, color }
    await db.lines.put(next)
    return context.done(next)
  })
}
