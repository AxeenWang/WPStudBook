import { BUILD_PHASE_LAST_GENERATION, type LinePosition } from '../core/lines'
import {
  CLOSE_GENERATIONS,
  type Mating,
  type PedigreeHorse,
  type PedigreeNode,
} from '../core/pedigree'
import type { HorseRow, LineRow, MareRow, RestorationRow, StallionRow } from './records'
import { damRoleOf } from './snapshot'

/** 組血統樹需要的資料列 */
export interface PedigreeRows {
  /** 至少包含樹上的每一匹馬：配種雙方往上到第 4 代 */
  horses: readonly HorseRow[]
  /** 樹上的馬的種牡馬任用 */
  stallions: readonly StallionRow[]
  /** 樹上的馬的母馬資料 */
  mares: readonly MareRow[]
  restorations: readonly RestorationRow[]
  lines: readonly LineRow[]
}

/**
 * 一次配種的血統樹（需求規格 10.2；技術設計 4.3「規則輸入快照的彙整」的血統樹）：
 * 從種牡馬與母馬往上展開到第 4 代，第 5 代不展開。沒有內部紀錄的父母為 null。
 * 樹上的馬找不到資料、零代市場種牡馬所在的系沒有開啟、補公系任用找不到宣告時丟出錯誤。
 */
export function buildMating(
  sireId: string | undefined,
  damId: string | undefined,
  rows: PedigreeRows,
): Mating {
  const horses = new Map(rows.horses.map((horse) => [horse.id, horse]))
  const node = (id: string | undefined, depth: number): PedigreeNode | null => {
    if (id === undefined) return null
    const horse = horses.get(id)
    if (!horse) throw new Error(`找不到馬匹：${id}`)
    const expand = depth < CLOSE_GENERATIONS
    return {
      horse: pedigreeHorse(horse, rows),
      sire: expand ? node(horse.sireId, depth + 1) : null,
      dam: expand ? node(horse.damId, depth + 1) : null,
    }
  }
  return { sire: node(sireId, 1), dam: node(damId, 1) }
}

/**
 * 血統樹上的一匹馬：馬名用基本馬名。零代市場種牡馬（含補公系補入的）父系留空時，
 * 改填他所在系目前的子系統（需求規格 10.2）。
 */
function pedigreeHorse(horse: HorseRow, rows: PedigreeRows): PedigreeHorse {
  const zeroGeneration = rows.stallions.filter(
    (row) => row.horseId === horse.id && row.generation === 0,
  )
  const mare = rows.mares.find((row) => row.horseId === horse.id)
  const firstZero = zeroGeneration[0]
  return {
    id: horse.id,
    name: horse.baseName,
    sireSystem:
      horse.sireSystem ??
      (firstZero === undefined ? undefined : currentSubsystem(firstZero.line, rows.lines)),
    buildPhaseMarket:
      zeroGeneration.some((row) => buildPhaseStallion(row, rows.restorations)) ||
      (mare !== undefined && buildPhaseMare(mare)),
  }
}

function currentSubsystem(line: LinePosition, lines: readonly LineRow[]): string {
  const row = lines.find((candidate) => candidate.line === line)
  if (!row) throw new Error(`零代市場種牡馬所在的第 ${line} 系沒有開啟`)
  return row.subsystem
}

/**
 * 建系期的零代市場種牡馬（需求規格 10.2）：建系起點與建立新系的（含依 7.7 替換上來的）一律是；
 * 補公系補入的只在補公系配對產出 4 代以內時是（使用者 2026-09-24 決定）
 */
function buildPhaseStallion(row: StallionRow, restorations: readonly RestorationRow[]): boolean {
  if (row.restorationId === undefined) return true
  const restoration = restorations.find((candidate) => candidate.id === row.restorationId)
  if (!restoration) throw new Error(`找不到補系宣告：${row.restorationId}`)
  return restoration.generation + 1 <= BUILD_PHASE_LAST_GENERATION
}

/**
 * 建系期的替代母馬（需求規格 10.2）：依目前的用途，第 1 系起點用，
 * 或替代的代數讓產駒在 4 代以內（替代 3 代以內）
 */
function buildPhaseMare(mare: MareRow): boolean {
  const role = damRoleOf(mare)
  if (role?.kind === 'start') return true
  return role?.kind === 'substitute' && role.forGeneration + 1 <= BUILD_PHASE_LAST_GENERATION
}
