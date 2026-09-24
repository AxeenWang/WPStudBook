import type {
  EightLineSnapshot,
  MareGroupSlot,
  RestorationSlot,
  StallionSlot,
  StallionState,
} from '../core/board'
import { damPlacement, type DamRole } from '../core/generation'
import { LINE_POSITIONS, type LinePosition } from '../core/lines'
import { ageInYear, mareListedInTasks, type MareAgeSettings } from '../core/mares'
import type { SisterStatus } from '../core/sisters'
import { parentSystemOf, type LineSystemSnapshot, type SystemTable } from '../core/systems'
import type { HorseRow, LineRow, MareRow, RestorationRow, StallionRow, SystemRow } from './records'

// 把資料列組成核心的規則輸入快照（技術設計 4.2、4.3「規則輸入快照的彙整」）。全部是純函式。

/** 系統對照表（需求規格 7.2） */
export function buildSystemTable(rows: readonly SystemRow[]): SystemTable {
  return rows.map(({ subsystem, parentSystem, origin }) =>
    origin === undefined ? { subsystem, parentSystem } : { subsystem, parentSystem, origin },
  )
}

/** 八系目前的系統，固定八筆：已開啟的系，子系統取系位置，親系統查對照表，查不到時留空 */
export function buildLineSystems(
  lines: readonly LineRow[],
  table: SystemTable,
): LineSystemSnapshot {
  return LINE_POSITIONS.map((line) => {
    const subsystem = lines.find((row) => row.line === line)?.subsystem ?? null
    return { line, subsystem, parentSystem: parentSystemOf(table, subsystem) }
  })
}

/**
 * 同一格（某系某代，或某次補公系）的任用彙整成種牡馬狀態（需求規格 7.7）：
 * 有在崗的為在崗；否則有狀態留空的（預定後繼）為已指定；否則為已離場。沒有任用時回傳 undefined。
 */
export function stallionState(rows: readonly StallionRow[]): StallionState | undefined {
  return rows.length === 0 ? undefined : occupiedState(rows)
}

/** 至少有一筆任用時的種牡馬狀態 */
function occupiedState(rows: readonly StallionRow[]): StallionState {
  if (rows.some((row) => row.status === 'active')) return 'active'
  if (rows.some((row) => row.status === undefined)) return 'waiting'
  return 'ended'
}

/**
 * 母馬在規則上的身分（需求規格 8.2、8.3）；待指定用途與自由配種所生的母馬不屬於任何母馬群，回傳 null。
 * 用途與母馬群欄位矛盾時丟出 RangeError：自家與替代母馬缺少系或代數、起點母馬不在第 1 系 0 代、
 * 不屬於母馬群的母馬帶有系或代數。
 */
export function damRoleOf(mare: MareRow): DamRole | null {
  const { usage, groupLine: line, groupGeneration: generation } = mare
  if (usage === 'unassigned' || usage === 'free') {
    if (line !== undefined || generation !== undefined) {
      throw new RangeError(`不屬於母馬群的母馬不能有系或代數：${mare.horseId}`)
    }
    return null
  }
  if (line === undefined || generation === undefined) {
    throw new RangeError(`母馬缺少所屬母馬群的系或代數：${mare.horseId}`)
  }
  if (usage === 'start') {
    if (line !== 1 || generation !== 0) {
      throw new RangeError(`起點母馬必須在第 1 系 0 代：${mare.horseId}`)
    }
    return { kind: 'start' }
  }
  return usage === 'own'
    ? { kind: 'own', line, generation }
    : { kind: 'substitute', forLine: line, forGeneration: generation }
}

/** 彙整八系快照需要的資料列 */
export interface EightLineRows {
  lines: readonly LineRow[]
  stallions: readonly StallionRow[]
  mares: readonly MareRow[]
  /** 至少包含在圈母馬的馬匹資料，用來算馬齡 */
  horses: readonly HorseRow[]
  restorations: readonly RestorationRow[]
}

/**
 * 規則輸入快照（技術設計 4.2「規則輸入快照」、4.3「規則輸入快照的彙整」）。
 * year 是目前遊戲年，用來算馬齡；settings 是這一局的母馬年齡設定。
 * 在圈母馬找不到馬匹資料、自家母駒缺少接替狀態時丟出錯誤。
 */
export function buildEightLineSnapshot(
  rows: EightLineRows,
  year: number,
  settings: MareAgeSettings,
): EightLineSnapshot {
  const horses = new Map(rows.horses.map((horse) => [horse.id, horse]))
  return {
    lines: LINE_POSITIONS.map((line) => ({
      line,
      opened: rows.lines.some((row) => row.line === line),
      stallions: stallionSlots(
        rows.stallions.filter((row) => row.line === line && row.restorationId === undefined),
      ),
      mareGroups: mareGroupSlots(line, rows.mares, (mare) => listed(mare, horses, year, settings)),
      restorations: restorationSlots(line, rows.restorations, rows.stallions),
    })),
  }
}

/** 同一系不屬於補系的任用，依代數分格 */
function stallionSlots(rows: readonly StallionRow[]): StallionSlot[] {
  const generations = [...new Set(rows.map((row) => row.generation))].sort((a, b) => a - b)
  return generations.map((generation) => ({
    generation,
    state: occupiedState(rows.filter((row) => row.generation === generation)),
  }))
}

/** 第 line 系的母馬群，依代數排序；母馬全部離圈的群仍然列出 */
function mareGroupSlots(
  line: LinePosition,
  mares: readonly MareRow[],
  isListed: (mare: MareRow) => boolean,
): MareGroupSlot[] {
  const groups = new Map<number, MareRow[]>()
  for (const mare of mares) {
    const role = damRoleOf(mare)
    if (!role) continue
    const placement = damPlacement(role)
    const group = placement.kind === 'start' ? { line: 1, generation: 0 } : placement
    if (group.line !== line) continue
    groups.set(group.generation, [...(groups.get(group.generation) ?? []), mare])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([generation, members]) => {
      const active = members.filter(isListed)
      return {
        generation,
        established: members.some((mare) => mare.usage === 'own' && mare.establishedGeneration),
        activeMares: active.length,
        ownMares: active.filter((mare) => mare.usage === 'own').length,
      }
    })
}

/** 母馬是否列入任務（需求規格 8.5、8.9）；不在圈的母馬不必查馬匹資料 */
function listed(
  mare: MareRow,
  horses: ReadonlyMap<string, HorseRow>,
  year: number,
  settings: MareAgeSettings,
): boolean {
  if (mare.herd !== 'in-herd') return false
  const horse = horses.get(mare.horseId)
  if (!horse) throw new Error(`找不到母馬的馬匹資料：${mare.horseId}`)
  const age = horse.birthYear === undefined ? undefined : ageInYear(horse.birthYear, year)
  return mareListedInTasks({ inHerd: true, age, sisterStatus: sisterStatusOf(mare) }, settings)
}

/** 自家母駒的接替狀態；市場母馬留空。自家母駒沒有接替狀態時丟出 RangeError */
function sisterStatusOf(mare: MareRow): SisterStatus | undefined {
  if (mare.usage !== 'own') return undefined
  if (mare.sisterStatus === undefined) {
    throw new RangeError(`自家母駒缺少接替狀態：${mare.horseId}`)
  }
  return mare.sisterStatus
}

/**
 * 第 line 系已宣告的補系，不含已撤銷的；依代數排序，同一代補公系在前。
 * 補公系補入的種牡馬狀態只看屬於這次補系的任用，還沒選定時留空。
 */
function restorationSlots(
  line: LinePosition,
  restorations: readonly RestorationRow[],
  stallions: readonly StallionRow[],
): RestorationSlot[] {
  return restorations
    .filter((row) => row.line === line && !row.revoked)
    .sort((a, b) => a.generation - b.generation || sideOrder(a) - sideOrder(b))
    .map((row): RestorationSlot => {
      if (row.side === 'dam') return { side: 'dam', generation: row.generation }
      const state = stallionState(stallions.filter((stallion) => stallion.restorationId === row.id))
      return state === undefined
        ? { side: 'sire', generation: row.generation }
        : { side: 'sire', generation: row.generation, stallion: state }
    })
}

function sideOrder(row: RestorationRow): number {
  return row.side === 'sire' ? 0 : 1
}
