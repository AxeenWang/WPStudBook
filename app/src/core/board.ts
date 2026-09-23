import {
  designatedPairing,
  restorationPairing,
  type DesignatedPairing,
  type MareGroupRef,
} from './designated'
import {
  BRANCHES,
  BUILD_PHASE_LAST_GENERATION,
  LINE_POSITIONS,
  assertGeneration,
  branchOf,
  pairingDistance,
  partnerLine,
  type Branch,
  type LinePosition,
} from './lines'

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
  /** 其中的自家母馬數；零代市場種牡馬原則只配自家母馬，不足時才例外補入替代母馬（需求規格 7.3） */
  ownMares: number
}

/** 補公系：第 generation 代沒有種牡馬可以延續，以零代市場種牡馬代替（需求規格 7.6） */
export interface SireRestorationSlot {
  side: 'sire'
  /** 斷血的代數 */
  generation: number
  /** 補入的零代市場種牡馬狀態；還沒選定時留空 */
  stallion?: StallionState
}

/** 補母系：第 generation 代母馬群從未成立，也生不出母駒（需求規格 7.6） */
export interface DamRestorationSlot {
  side: 'dam'
  /** 斷血的代數 */
  generation: number
}

/** 已宣告的斷血補系，由儲存層依補系紀錄彙整 */
export type RestorationSlot = SireRestorationSlot | DamRestorationSlot

export interface LineSnapshot {
  line: LinePosition
  /** 已開啟：建系起點或建立新系時已填寫系統與零代市場種牡馬（需求規格 7.1） */
  opened: boolean
  stallions: StallionSlot[]
  /** 各代母馬群；第 1 系 0 代母馬群就是第 1 系起點母馬群 */
  mareGroups: MareGroupSlot[]
  /** 已宣告的斷血補系；沒有時為空陣列 */
  restorations: RestorationSlot[]
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
  /** 其中的自家母馬數：建立新系的任務以此判斷自家母馬是否不足，由使用者決定是否例外補入（需求規格 7.3） */
  ownMares: number
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

/** 補系的狀態（需求規格 7.6） */
export interface RestorationStatus {
  /** 斷血的系 */
  line: LinePosition
  /** 斷血的代數 */
  generation: number
  side: 'sire' | 'dam'
  /** 補系任務：補公系為補公系配對；補母系為配這個母馬群、產出下一代的配對 */
  pairing: DesignatedPairing
  /**
   * 補系進行中：補系產駒還沒接上後繼。補公系是產出的那一代還沒有種牡馬紀錄；
   * 補母系是補系任務產出的那一代母馬群還沒成立
   */
  inProgress: boolean
}

export interface Board {
  openableBranches: OpenableBranch[]
  /** 依產出代數、系位置排序 */
  tasks: BoardTask[]
  /** 已宣告的補系，依系位置、代數排序，同一代補公系在前 */
  restorations: RestorationStatus[]
}

/**
 * 列出可開啟的分支、目前的任務與補系的狀態（需求規格 7.3、7.4、7.6、7.7）。
 * 判斷方式見技術設計 4.2「任務看板的判斷」。
 */
export function listBoard(snapshot: EightLineSnapshot): Board {
  const lookup = createLookup(snapshot)
  const openableBranches = BRANCHES.filter((branch) => isOpenable(branch, lookup)).map(
    (branch) => ({ branch, pairings: branchPairings(branch, lookup) }),
  )
  const tasks: BoardTask[] = []
  // 建系分支最高產出 4 代；快照稀疏時也要列得出建系任務
  const maxCandidate = Math.max(lookup.maxGeneration + 1, BUILD_PHASE_LAST_GENERATION)
  for (let generation = 1; generation <= maxCandidate; generation++) {
    for (const line of LINE_POSITIONS) {
      const pairing = pairingFor(line, generation, lookup)
      if (pairing && isVisible(pairing, lookup) && !isEnded(pairing, lookup)) {
        tasks.push(toTask(pairing, lookup))
      }
    }
  }
  const restorations = LINE_POSITIONS.flatMap((line) =>
    lookup.restorations(line).map((slot) => restorationStatus(line, slot, lookup)),
  )
  return { openableBranches, tasks, restorations }
}

interface Lookup {
  maxGeneration: number
  isOpened(line: LinePosition): boolean
  stallion(line: LinePosition, generation: number): StallionState | undefined
  mareGroup(line: LinePosition, generation: number): MareGroupSlot | undefined
  /** 某系到達第 generation 代：該代有種牡馬紀錄，或該代母馬群已成立 */
  reached(line: LinePosition, generation: number): boolean
  /** 該系已宣告的補系，依代數排序，同一代補公系在前 */
  restorations(line: LinePosition): RestorationSlot[]
  sireRestoration(line: LinePosition, generation: number): SireRestorationSlot | undefined
  damRestored(line: LinePosition, generation: number): boolean
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

  for (const entry of snapshot.lines) {
    for (const slot of entry.mareGroups) {
      if (slot.ownMares > slot.activeMares) {
        throw new RangeError(
          `快照的第 ${entry.line} 系 ${slot.generation} 代母馬群，自家母馬數多於列入任務的母馬數`,
        )
      }
    }
    for (const slot of entry.restorations) {
      assertGeneration(slot.generation, '斷血代數', 1)
      if (!entry.opened || slot.generation < branchOf(entry.line).outputGeneration) {
        throw new RangeError(`快照的第 ${entry.line} 系在 ${slot.generation} 代還沒成立，不能補系`)
      }
      const same = entry.restorations.filter(
        (other) => other.side === slot.side && other.generation === slot.generation,
      )
      if (same.length > 1) {
        throw new RangeError(`快照的第 ${entry.line} 系 ${slot.generation} 代補系重複`)
      }
    }
  }

  const stallion = (line: LinePosition, generation: number) =>
    lineOf(line).stallions.find((slot) => slot.generation === generation)?.state
  const mareGroup = (line: LinePosition, generation: number) =>
    lineOf(line).mareGroups.find((slot) => slot.generation === generation)
  const generations = snapshot.lines.flatMap((entry) =>
    [...entry.stallions, ...entry.mareGroups, ...entry.restorations].map((slot) => slot.generation),
  )
  return {
    maxGeneration: Math.max(0, ...generations),
    isOpened: (line) => lineOf(line).opened,
    stallion,
    mareGroup,
    reached: (line, generation) =>
      stallion(line, generation) !== undefined || mareGroup(line, generation)?.established === true,
    restorations: (line) =>
      [...lineOf(line).restorations].sort(
        (a, b) => a.generation - b.generation || (a.side === 'sire' ? -1 : 1),
      ),
    sireRestoration: (line, generation) =>
      lineOf(line).restorations.find(
        (slot): slot is SireRestorationSlot =>
          slot.side === 'sire' && slot.generation === generation,
      ),
    damRestored: (line, generation) =>
      lineOf(line).restorations.some(
        (slot) => slot.side === 'dam' && slot.generation === generation,
      ),
  }
}

/** 第 line 系產出第 generation 代的指定配對：宣告補公系後固定為補公系配對（需求規格 7.6） */
function pairingFor(
  line: LinePosition,
  generation: number,
  lookup: Lookup,
): DesignatedPairing | null {
  return lookup.sireRestoration(line, generation - 1)
    ? restorationPairing(line, generation - 1)
    : designatedPairing(line, generation)
}

function isOpenable(branch: Branch, lookup: Lookup): boolean {
  if (lookup.isOpened(branch.newLine)) return false
  if (branch.parent === null) return true
  // 補公系進行中，斷血的那一系不開新分支（需求規格 7.6）
  const parent = branch.parent
  const restoring = lookup
    .restorations(parent)
    .some((slot) => slot.side === 'sire' && isInProgress(parent, slot, lookup))
  return !restoring && lookup.reached(parent, branch.outputGeneration - 1)
}

function branchPairings(branch: Branch, lookup: Lookup): DesignatedPairing[] {
  const lines = branch.parent === null ? [branch.newLine] : [branch.parent, branch.newLine]
  return lines.flatMap((line) => pairingFor(line, branch.outputGeneration, lookup) ?? [])
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
        lookup.stallion(line, generation - 1) !== undefined && maresReady(pairing.mares, lookup)
      )
    case 'restore':
      // 補公系宣告後就出現，比照建立新系在開啟後出現（需求規格 7.6）
      return true
  }
}

/** 循環任務的母馬群就緒：已成立，或已宣告補母系（需求規格 7.4、7.6） */
function maresReady(mares: MareGroupRef, lookup: Lookup): boolean {
  return (
    mares.kind === 'group' &&
    (lookup.mareGroup(mares.line, mares.generation)?.established === true ||
      lookup.damRestored(mares.line, mares.generation))
  )
}

/** 世代交接：同系下一代任務已出現，且這條任務的母馬全部離圈或種牡馬已離場（需求規格 7.4） */
function isEnded(pairing: DesignatedPairing, lookup: Lookup): boolean {
  const next = pairingFor(pairing.output.line, pairing.output.generation + 1, lookup)
  if (!next || !isVisible(next, lookup)) return false
  const sireEnded = sireState(pairing, lookup) === 'ended'
  return sireEnded || (maresOf(pairing, lookup)?.activeMares ?? 0) === 0
}

/** 任務種牡馬的狀態：補公系看補入的零代市場種牡馬，其他看該系那一代的種牡馬 */
function sireState(pairing: DesignatedPairing, lookup: Lookup): StallionState | undefined {
  return pairing.kind === 'restore'
    ? lookup.sireRestoration(pairing.output.line, pairing.output.generation - 1)?.stallion
    : lookup.stallion(pairing.sire.line, pairing.sire.generation)
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
  const state = sireState(pairing, lookup)
  const sireStatus = state === undefined ? 'unassigned' : SIRE_STATUS[state]
  const group = maresOf(pairing, lookup)
  const activeMares = group?.activeMares ?? 0
  return {
    pairing,
    sireStatus,
    activeMares,
    ownMares: group?.ownMares ?? 0,
    needsMares: group?.established === true && activeMares === 0,
    paused: sireStatus === 'missing',
  }
}

/** 配第 line 系第 generation 代母馬群、產出下一代的系：下一代配對距離的配對系（需求規格 4.3） */
function damPartnerLine(line: LinePosition, generation: number): LinePosition {
  const distance = pairingDistance(generation + 1)
  if (distance === null) throw new RangeError(`第 ${line} 系 ${generation} 代母馬群沒有配對系`)
  return partnerLine(line, distance)
}

/**
 * 補系進行中：補系產駒還沒接上後繼（需求規格 7.6）。
 * 補公系是產出的那一代還沒有種牡馬紀錄；補母系是補系任務產出的那一代母馬群還沒成立。
 */
function isInProgress(line: LinePosition, slot: RestorationSlot, lookup: Lookup): boolean {
  const output = slot.generation + 1
  return slot.side === 'sire'
    ? lookup.stallion(line, output) === undefined
    : lookup.mareGroup(damPartnerLine(line, slot.generation), output)?.established !== true
}

function restorationStatus(
  line: LinePosition,
  slot: RestorationSlot,
  lookup: Lookup,
): RestorationStatus {
  const taskLine = slot.side === 'sire' ? line : damPartnerLine(line, slot.generation)
  const pairing = pairingFor(taskLine, slot.generation + 1, lookup)
  if (!pairing) throw new RangeError(`第 ${line} 系 ${slot.generation} 代補系沒有對應的配對`)
  return {
    line,
    generation: slot.generation,
    side: slot.side,
    pairing,
    inProgress: isInProgress(line, slot, lookup),
  }
}
