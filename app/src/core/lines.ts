/** 八系的系位置 1～8（需求規格第 3 章、7.1）：位置永久固定，配種、代數與循環規則都綁定位置 */
export type LinePosition = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

/** 兩兩互換配對的配對距離（需求規格 4.3）：是組別代號，不是兩系系號的差 */
export type PairingDistance = 1 | 2 | 4

/** 規則上的位置：第 line 系第 generation 代；市場馬為零代 */
export interface LineGeneration {
  line: LinePosition
  generation: number
}

export const LINE_POSITIONS: readonly LinePosition[] = [1, 2, 3, 4, 5, 6, 7, 8]

const DISTANCE_CYCLE: readonly PairingDistance[] = [1, 2, 4]

/**
 * 產出第 outputGeneration 代的配對距離（需求規格 4.3、7.3）。
 * 1 代是建系起點，沒有距離；2、3、4 代為 1、2、4；5 代起 1、2、4 輪替。
 */
export function pairingDistance(outputGeneration: number): PairingDistance | null {
  if (!Number.isInteger(outputGeneration) || outputGeneration < 1) {
    throw new RangeError(`產出代數必須是 1 以上的整數：${outputGeneration}`)
  }
  if (outputGeneration === 1) return null
  return DISTANCE_CYCLE[(outputGeneration - 2) % DISTANCE_CYCLE.length]
}

/** 各配對距離的互換配對（需求規格 4.3 表，2026-09-21 決定） */
export const PAIRING_TABLE: Readonly<
  Record<PairingDistance, readonly (readonly [LinePosition, LinePosition])[]>
> = {
  1: [
    [1, 2],
    [3, 4],
    [5, 7],
    [6, 8],
  ],
  2: [
    [1, 3],
    [2, 4],
    [5, 6],
    [7, 8],
  ],
  4: [
    [1, 5],
    [2, 7],
    [3, 6],
    [4, 8],
  ],
}

/** 配對距離為 distance 時，與第 line 系互換配對的系 */
export function partnerLine(line: LinePosition, distance: PairingDistance): LinePosition {
  for (const [a, b] of PAIRING_TABLE[distance]) {
    if (a === line) return b
    if (b === line) return a
  }
  throw new RangeError(`配對表沒有第 ${line} 系`)
}

export interface Branch {
  /** 這個分支產出的代數：1 是建系起點，2～4 是分支 */
  outputGeneration: number
  /** 分出新系的原系；建系起點沒有原系 */
  parent: LinePosition | null
  /** 這個分支成立的系 */
  newLine: LinePosition
}

/**
 * 建系起點與分支（需求規格 7.3），依分支圖由上而下編號：
 * 產出 2 代 1→2；3 代 1→3、2→4；4 代 1→5、3→6、2→7、4→8。
 */
export const BRANCHES: readonly Branch[] = [
  { outputGeneration: 1, parent: null, newLine: 1 },
  { outputGeneration: 2, parent: 1, newLine: 2 },
  { outputGeneration: 3, parent: 1, newLine: 3 },
  { outputGeneration: 3, parent: 2, newLine: 4 },
  { outputGeneration: 4, parent: 1, newLine: 5 },
  { outputGeneration: 4, parent: 3, newLine: 6 },
  { outputGeneration: 4, parent: 2, newLine: 7 },
  { outputGeneration: 4, parent: 4, newLine: 8 },
]

/** 成立第 line 系的分支 */
export function branchOf(line: LinePosition): Branch {
  const branch = BRANCHES.find((candidate) => candidate.newLine === line)
  if (!branch) throw new RangeError(`沒有成立第 ${line} 系的分支`)
  return branch
}
