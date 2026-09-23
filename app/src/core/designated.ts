import {
  LINE_POSITIONS,
  assertGeneration,
  branchOf,
  pairingDistance,
  partnerLine,
  type LineGeneration,
  type LinePosition,
  type PairingDistance,
} from './lines'

/** 配對種類：建系起點、推進原系、建立新系、循環、補公系（需求規格 7.3、7.4、7.6） */
export type PairingKind = 'start' | 'advance' | 'found' | 'cycle' | 'restore'

/** 規則指定的母馬來源：第 1 系起點母馬群，或第 line 系第 generation 代母馬群（含替代母馬） */
export type MareGroupRef =
  { kind: 'start' } | { kind: 'group'; line: LinePosition; generation: number }

export interface DesignatedPairing {
  kind: PairingKind
  /** 配對距離；建系起點為 null */
  distance: PairingDistance | null
  /** 規則指定的種牡馬；零代表示該系的零代市場種牡馬（建系起點、建立新系、補公系） */
  sire: LineGeneration
  mares: MareGroupRef
  /** 預計產出 */
  output: LineGeneration
}

/**
 * 產出第 line 系第 outputGeneration 代的指定配對（需求規格 7.3、7.4、10.3）。
 * 種牡馬為該系前一代（該系在這一代成立時為零代市場種牡馬），母馬為配對系前一代母馬群；
 * 1 代只有第 1 系起點。該系在這一代還沒成立時回傳 null。
 */
export function designatedPairing(
  line: LinePosition,
  outputGeneration: number,
): DesignatedPairing | null {
  const distance = pairingDistance(outputGeneration)
  const founding = branchOf(line).outputGeneration
  if (outputGeneration < founding) return null
  const output = { line, generation: outputGeneration }
  if (distance === null) {
    return {
      kind: 'start',
      distance,
      sire: { line, generation: 0 },
      mares: { kind: 'start' },
      output,
    }
  }
  const mares: MareGroupRef = {
    kind: 'group',
    line: partnerLine(line, distance),
    generation: outputGeneration - 1,
  }
  if (outputGeneration === founding) {
    return { kind: 'found', distance, sire: { line, generation: 0 }, mares, output }
  }
  return {
    kind: outputGeneration <= 4 ? 'advance' : 'cycle',
    distance,
    sire: { line, generation: outputGeneration - 1 },
    mares,
    output,
  }
}

/** 產出第 outputGeneration 代的所有指定配對，依系位置排序 */
export function designatedPairings(outputGeneration: number): DesignatedPairing[] {
  return LINE_POSITIONS.flatMap((line) => designatedPairing(line, outputGeneration) ?? [])
}

/**
 * 補公系的指定配對（需求規格 7.6、10.3）：第 line 系第 brokenGeneration 代沒有種牡馬可以延續時，
 * 以該系零代市場種牡馬代替第 brokenGeneration 代種牡馬，配原本指定的配對系母馬群，產出下一代。
 * 例：第 5 系 12 代斷血 → 第 5 系零代 × 第 1 系 12 代母馬群 → 第 5 系 13 代。
 * 斷血代數早於該系成立的代數（包括零代）時回傳 null；不是 0 以上的整數時丟出 RangeError。
 */
export function restorationPairing(
  line: LinePosition,
  brokenGeneration: number,
): DesignatedPairing | null {
  assertGeneration(brokenGeneration, '斷血代數', 0)
  if (brokenGeneration < branchOf(line).outputGeneration) return null
  const pairing = designatedPairing(line, brokenGeneration + 1)
  return pairing && { ...pairing, kind: 'restore', sire: { line, generation: 0 } }
}
