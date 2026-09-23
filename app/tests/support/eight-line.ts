import { designatedPairing, type DesignatedPairing } from '../../src/core/designated'
import type { LinePosition } from '../../src/core/lines'

/** 取得規則指定的配對；該系在這一代還沒成立時丟出錯誤 */
export function pairingOf(line: LinePosition, outputGeneration: number): DesignatedPairing {
  const pairing = designatedPairing(line, outputGeneration)
  if (!pairing) throw new Error(`第 ${line} 系在 ${outputGeneration} 代還沒成立`)
  return pairing
}

/** 用需求規格的說法描述配對，例如「第 1 系 1 代 × 第 2 系 1 代母馬群 → 第 1 系 2 代」 */
export function describePairing(pairing: DesignatedPairing): string {
  const mares =
    pairing.mares.kind === 'start'
      ? '第 1 系起點母馬群'
      : `第 ${pairing.mares.line} 系 ${pairing.mares.generation} 代母馬群`
  return `第 ${pairing.sire.line} 系 ${pairing.sire.generation} 代 × ${mares} → 第 ${pairing.output.line} 系 ${pairing.output.generation} 代`
}
