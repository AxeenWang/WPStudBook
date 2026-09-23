import { designatedPairing, type DesignatedPairing } from './designated'
import { BRANCHES, LINE_POSITIONS, type Branch, type LinePosition } from './lines'

/**
 * 某系某代種牡馬的狀態，由儲存層依種牡馬紀錄彙整（需求規格 7.7）：
 * - active：在崗
 * - waiting：已指定、還沒正式供用（尚未誕生、競走中、已引退待指定）
 * - ended：退出生產行列或已引退，同一代也沒有其他在崗或已指定的種牡馬
 */
export type StallionState = 'active' | 'waiting' | 'ended'

export interface StallionSlot {
  generation: number
  state: StallionState
}

export interface MareGroupSlot {
  generation: number
  /** 該代已成立：第一匹自家母駒以暫定或正式保留轉入（需求規格 8.2）；只有替代母馬時為 false */
  established: boolean
  /** 列入任務的母馬數：生產中的自家母馬（暫定保留、候選、正式保留）與替代母馬 */
  activeMares: number
}

export interface LineSnapshot {
  line: LinePosition
  /** 已開啟：建系起點或建立新系時已填寫系統與零代市場種牡馬（需求規格 7.1） */
  opened: boolean
  stallions: StallionSlot[]
  /** 各代母馬群；第 1 系 0 代母馬群就是第 1 系起點母馬群 */
  mareGroups: MareGroupSlot[]
}

/** 規則輸入快照：八系目前的狀態，八個系位置各一筆，由儲存層依資料表彙整 */
export interface EightLineSnapshot {
  lines: LineSnapshot[]
}

/**
 * 任務種牡馬的狀態：
 * - ready：在崗
 * - waiting：已指定、還沒正式供用
 * - missing：已離場且沒有後任，任務暫停
 * - unassigned：還沒有指定
 */
export type SireStatus = 'ready' | 'waiting' | 'missing' | 'unassigned'

export interface BoardTask {
  pairing: DesignatedPairing
  sireStatus: SireStatus
  /** 指定母馬群列入任務的匹數 */
  activeMares: number
  /** 母馬群已成立但沒有列入任務的母馬：顯示「已成立，母馬群待補」（需求規格 7.6） */
  needsMares: boolean
  /** 缺少現任種牡馬（零代時為缺少目標種牡馬），任務暫停（需求規格 7.7） */
  paused: boolean
}

export interface OpenableBranch {
  branch: Branch
  /** 建系起點一條；其他分支為推進原系與建立新系兩條 */
  pairings: DesignatedPairing[]
}

export interface Board {
  openableBranches: OpenableBranch[]
  /** 依產出代數、系位置排序 */
  tasks: BoardTask[]
}

/**
 * 列出可開啟的分支與目前的任務（需求規格 7.3、7.4、7.7）。
 * 判斷方式見技術設計 4.2「任務看板的判斷」。
 */
export function listBoard(snapshot: EightLineSnapshot): Board {
  const lookup = createLookup(snapshot)
  const openableBranches = BRANCHES.filter((branch) => isOpenable(branch, lookup)).map(
    (branch) => ({ branch, pairings: branchPairings(branch) }),
  )
  const tasks: BoardTask[] = []
  for (let generation = 1; generation <= lookup.maxGeneration + 1; generation++) {
    for (const line of LINE_POSITIONS) {
      const pairing = designatedPairing(line, generation)
      if (pairing && isVisible(pairing, lookup) && !isEnded(pairing, lookup)) {
        tasks.push(toTask(pairing, lookup))
      }
    }
  }
  return { openableBranches, tasks }
}

interface Lookup {
  maxGeneration: number
  isOpened(line: LinePosition): boolean
  stallion(line: LinePosition, generation: number): StallionState | undefined
  mareGroup(line: LinePosition, generation: number): MareGroupSlot | undefined
  /** 某系到達第 generation 代：該代有種牡馬紀錄，或該代母馬群已成立 */
  reached(line: LinePosition, generation: number): boolean
}

function createLookup(snapshot: EightLineSnapshot): Lookup {
  const byLine = new Map<LinePosition, LineSnapshot>()
  for (const entry of snapshot.lines) {
    if (byLine.has(entry.line)) throw new RangeError(`快照的第 ${entry.line} 系重複`)
    byLine.set(entry.line, entry)
  }
  const lineOf = (line: LinePosition): LineSnapshot => {
    const entry = byLine.get(line)
    if (!entry) throw new RangeError(`快照缺少第 ${line} 系`)
    return entry
  }
  // 八個系位置都要有
  for (const line of LINE_POSITIONS) lineOf(line)

  const stallion = (line: LinePosition, generation: number) =>
    lineOf(line).stallions.find((slot) => slot.generation === generation)?.state
  const mareGroup = (line: LinePosition, generation: number) =>
    lineOf(line).mareGroups.find((slot) => slot.generation === generation)
  const generations = snapshot.lines.flatMap((entry) =>
    [...entry.stallions, ...entry.mareGroups].map((slot) => slot.generation),
  )
  return {
    maxGeneration: Math.max(0, ...generations),
    isOpened: (line) => lineOf(line).opened,
    stallion,
    mareGroup,
    reached: (line, generation) =>
      stallion(line, generation) !== undefined || mareGroup(line, generation)?.established === true,
  }
}

function isOpenable(branch: Branch, lookup: Lookup): boolean {
  if (lookup.isOpened(branch.newLine)) return false
  return branch.parent === null || lookup.reached(branch.parent, branch.outputGeneration - 1)
}

function branchPairings(branch: Branch): DesignatedPairing[] {
  const lines = branch.parent === null ? [branch.newLine] : [branch.parent, branch.newLine]
  return lines.flatMap((line) => designatedPairing(line, branch.outputGeneration) ?? [])
}

function isVisible(pairing: DesignatedPairing, lookup: Lookup): boolean {
  const { line, generation } = pairing.output
  switch (pairing.kind) {
    case 'start':
    case 'found':
      return lookup.isOpened(line)
    case 'advance':
      return lookup.reached(line, generation - 1)
    case 'cycle':
      return (
        lookup.stallion(line, generation - 1) !== undefined &&
        maresOf(pairing, lookup)?.established === true
      )
  }
}

/** 世代交接：同系下一代任務已出現，且這條任務的母馬全部離圈或種牡馬已離場（需求規格 7.4） */
function isEnded(pairing: DesignatedPairing, lookup: Lookup): boolean {
  const next = designatedPairing(pairing.output.line, pairing.output.generation + 1)
  if (!next || !isVisible(next, lookup)) return false
  const sireEnded = lookup.stallion(pairing.sire.line, pairing.sire.generation) === 'ended'
  return sireEnded || (maresOf(pairing, lookup)?.activeMares ?? 0) === 0
}

function maresOf(pairing: DesignatedPairing, lookup: Lookup): MareGroupSlot | undefined {
  return pairing.mares.kind === 'start'
    ? lookup.mareGroup(1, 0)
    : lookup.mareGroup(pairing.mares.line, pairing.mares.generation)
}

const SIRE_STATUS: Record<StallionState, SireStatus> = {
  active: 'ready',
  waiting: 'waiting',
  ended: 'missing',
}

function toTask(pairing: DesignatedPairing, lookup: Lookup): BoardTask {
  const state = lookup.stallion(pairing.sire.line, pairing.sire.generation)
  const sireStatus = state === undefined ? 'unassigned' : SIRE_STATUS[state]
  const group = maresOf(pairing, lookup)
  const activeMares = group?.activeMares ?? 0
  return {
    pairing,
    sireStatus,
    activeMares,
    needsMares: group?.established === true && activeMares === 0,
    paused: sireStatus === 'missing',
  }
}
