import type { LinePosition } from '../core/lines'
import { checkMarketStallionSystem } from '../core/stallions'
import { parentSystemOf } from '../core/systems'
import type { WPStudBookDatabase } from './database'
import { saveLineSubsystem } from './line-writes'
import type { HorseRow, StallionChangeReason, StallionRow, WriteWarning } from './records'
import { buildSystemTable } from './snapshot'
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

// 種牡馬的寫入操作：補入或替換零代市場種牡馬、種牡馬狀態（需求規格 7.6、7.7；技術設計 4.3「寫入操作」）

/** 零代任用的格：某系建系時的零代，或某一次補公系宣告 */
export type ZeroSlot =
  { kind: 'founding'; line: LinePosition } | { kind: 'restoration'; restorationId: string }

/** 補入或替換零代市場種牡馬的輸入 */
export interface AssignZeroStallionInput {
  slot: ZeroSlot
  stallion: ZeroStallionInput
  /** 更換現任的原因（需求規格 7.7）；替換時必填，補公系第一次選定時可以省略 */
  reason?: StallionChangeReason
}

/**
 * 補入或替換零代市場種牡馬的阻止原因：
 * - slot-occupied：那一格已有在崗或已指定的種牡馬；要先標示前任引退，再替換（需求規格 7.7）
 * - reason-required：替換（那一格只剩已離場的種牡馬）要附原因
 * - already-in-slot：選的馬已在這一格任用過
 * - 其他：零代市場種牡馬的輸入不符（ZeroStallionBlock）
 */
export type AssignZeroStallionBlock =
  | { kind: 'slot-occupied' }
  | { kind: 'reason-required' }
  | { kind: 'already-in-slot' }
  | ZeroStallionBlock

/** 新的零代任用與他的馬匹 */
export interface AssignedStallion {
  appointment: StallionRow
  horse: HorseRow
}

/**
 * 補入或替換零代市場種牡馬（需求規格 7.6、7.7、STL-06、STL-07）：
 * 建系的零代或補公系補入的格空著（補公系第一次選定），或只剩已離場的種牡馬（替換）時，新增一筆在崗的零代任用；
 * 替換要附原因，生效年為目前遊戲年，前任的任用、配種與產駒保持原連結。
 * 他的父系與該系目前的子系統不同時警告並確認（親系統也不同時一併提示），確認後該系的子系統改為他的父系；
 * 因此造成的親系統重複列在同一份警告。父系不明時不比較。
 * 事件 stallion-assigned 記原因與同一格原本的種牡馬。
 * 系還沒開啟、補系宣告找不到、屬於其他局、已撤銷或是補母系時丟出錯誤。
 */
export async function assignZeroStallion(
  db: WPStudBookDatabase,
  gameId: string,
  input: AssignZeroStallionInput,
  options: WriteOptions = {},
): Promise<WriteResult<AssignedStallion, AssignZeroStallionBlock>> {
  const tables = [db.lines, db.systems, db.horses, db.stallions, db.restorations]
  return runWrite(db, gameId, tables, options, async (context) => {
    const { line, restorationId } = await slotOf(context, input.slot)
    const { lines, systems } = await readLinesAndSystems(context)
    const lineRow = lines.find((row) => row.line === line)
    if (!lineRow) throw new Error(`第 ${line} 系還沒開啟`)
    const previous = (
      await db.stallions.where('[gameId+line+generation]').equals([gameId, line, 0]).toArray()
    ).filter((row) => row.restorationId === restorationId)

    const blocks: AssignZeroStallionBlock[] = []
    if (previous.some((row) => row.status === 'active' || row.status === undefined)) {
      blocks.push({ kind: 'slot-occupied' })
    } else if (previous.length > 0 && input.reason === undefined) {
      blocks.push({ kind: 'reason-required' })
    }
    const stallion = await resolveZeroStallion(context, input.stallion)
    if (!stallion.ok) {
      blocks.push(...stallion.blocks)
    } else if (previous.some((row) => row.horseId === stallion.value.horse.id)) {
      blocks.push({ kind: 'already-in-slot' })
    }
    if (!stallion.ok || blocks.length > 0) return { status: 'blocked', blocks }

    const { horse, isNew } = stallion.value
    const table = buildSystemTable(systems)
    const check = checkMarketStallionSystem(
      {
        line,
        subsystem: lineRow.subsystem,
        parentSystem: parentSystemOf(table, lineRow.subsystem),
      },
      horse.sireSystem,
      table,
    )
    const warnings: WriteWarning[] = []
    if (check.subsystem) {
      const replacement = check.subsystem.replacement
      warnings.push({
        kind: 'stallion-system',
        line,
        subsystem: check.subsystem,
        parentSystem: check.parentSystem,
      })
      warnings.push(
        ...parentDuplicateWarnings(
          lineSystemsFromRows(lines, systems),
          lineSystemsFromRows(
            lines.map((row) => (row.line === line ? { ...row, subsystem: replacement } : row)),
            systems,
          ),
        ),
      )
    }
    const stop = gate([], warnings, context.confirmed)
    if (stop) return stop

    const appointment: StallionRow = {
      id: crypto.randomUUID(),
      gameId,
      line,
      generation: 0,
      ...(restorationId === undefined ? {} : { restorationId }),
      horseId: horse.id,
      status: 'active',
    }
    if (isNew) await db.horses.add(horse)
    await db.stallions.add(appointment)
    await context.addEvent({
      kind: 'stallion-assigned',
      line,
      horseId: horse.id,
      stallionId: appointment.id,
      ...(restorationId === undefined ? {} : { restorationId }),
      ...(input.reason === undefined ? {} : { reason: reasonOf(input.reason) }),
      replacedHorseIds: previous.flatMap((row) => row.horseId ?? []),
      ...confirmation(warnings),
    })
    if (check.subsystem) await saveLineSubsystem(context, lineRow, check.subsystem.replacement)
    return context.done({ appointment, horse }, warnings)
  })
}

/** 零代任用的格所在的系與補系宣告；補系宣告找不到、屬於其他局、已撤銷或是補母系時丟出錯誤 */
async function slotOf(
  context: WriteContext,
  slot: ZeroSlot,
): Promise<{ line: LinePosition; restorationId?: string }> {
  if (slot.kind === 'founding') return { line: slot.line }
  const restoration = await context.db.restorations.get(slot.restorationId)
  if (!restoration || restoration.gameId !== context.game.id) {
    throw new Error(`找不到補系宣告：${slot.restorationId}`)
  }
  if (restoration.revoked || restoration.side !== 'sire') {
    throw new Error(`補系宣告不是有效的補公系：${slot.restorationId}`)
  }
  return { line: restoration.line, restorationId: restoration.id }
}

/** 原因的說明去掉前後空白，空白時不寫說明 */
function reasonOf(reason: StallionChangeReason): StallionChangeReason {
  const note = reason.note?.trim()
  return note ? { kind: reason.kind, note } : { kind: reason.kind }
}

/** 種牡馬狀態可以改成的值：標示退出生產行列、已引退，或更正回在崗 */
export type StallionStatusTarget = 'withdrawn' | 'retired' | 'active'

/**
 * 種牡馬狀態的阻止原因：
 * - invalid-transition：不能這樣改。退出與引退只能從在崗或已被取代標示；
 *   在崗只能從退出或引退更正；已被取代由更換現任設定，預定後繼的取消也不在這裡
 * - slot-active：更正回在崗，但同一格已有其他在崗的種牡馬 stallionId；換人要用更換現任
 */
export type StallionStatusBlock =
  { kind: 'invalid-transition' } | { kind: 'slot-active'; stallionId: string }

/**
 * 標示種牡馬退出生產行列或已引退，或更正回在崗（需求規格 7.7：由使用者標示）；
 * 維持每格（某系某代的一般任用，或同一次補公系的任用）最多一匹在崗。
 * 事件 stallion-status-changed 記原狀態與新狀態。任用找不到或屬於其他局時丟出錯誤。
 */
export async function setStallionStatus(
  db: WPStudBookDatabase,
  gameId: string,
  stallionId: string,
  to: StallionStatusTarget,
  options: WriteOptions = {},
): Promise<WriteResult<StallionRow, StallionStatusBlock>> {
  return runWrite(db, gameId, [db.stallions], options, async (context) => {
    const current = await db.stallions.get(stallionId)
    if (!current || current.gameId !== gameId) {
      throw new Error(`找不到種牡馬的任用：${stallionId}`)
    }
    const from = current.status
    const allowed =
      to === 'active'
        ? from === 'withdrawn' || from === 'retired'
        : from === 'active' || from === 'replaced'
    const blocks: StallionStatusBlock[] = allowed ? [] : [{ kind: 'invalid-transition' }]
    if (allowed && to === 'active') {
      const other = (
        await db.stallions
          .where('[gameId+line+generation]')
          .equals([gameId, current.line, current.generation])
          .toArray()
      ).find(
        (row) =>
          row.id !== current.id &&
          row.restorationId === current.restorationId &&
          row.status === 'active',
      )
      if (other) blocks.push({ kind: 'slot-active', stallionId: other.id })
    }
    if (from === undefined || blocks.length > 0) return { status: 'blocked', blocks }
    const next = { ...current, status: to }
    await db.stallions.put(next)
    await context.addEvent({
      kind: 'stallion-status-changed',
      line: current.line,
      ...(current.horseId === undefined ? {} : { horseId: current.horseId }),
      stallionId,
      generation: current.generation,
      ...(current.restorationId === undefined ? {} : { restorationId: current.restorationId }),
      from,
      to,
    })
    return context.done(next)
  })
}
