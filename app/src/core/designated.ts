import {
  LINE_POSITIONS,
  branchOf,
  pairingDistance,
  partnerLine,
  type LineGeneration,
  type LinePosition,
  type PairingDistance,
} from './lines'

/** 配對種類：建系起點、推進原系、建立新系、循環（需求規格 7.3、7.4） */
export type PairingKind = 'start' | 'advance' | 'found' | 'cycle'

/** 規則指定的母馬來源：第 1 系起點母馬群，或第 line 系第 generation 代母馬群（含替代母馬） */
export type MareGroupRef =
  { kind: 'start' } | { kind: 'group'; line: LinePosition; generation: number }

export interface DesignatedPairing {
  kind: PairingKind
  /** 配對距離；建系起點為 null */
  distance: PairingDistance | null
  /** 規則指定的種牡馬；零代表示該系的零代市場種牡馬 */
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
