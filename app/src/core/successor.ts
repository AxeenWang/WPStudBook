import { checkDesignatedBreeding, type BreedingBlock } from './check'
import { designatedPairing, restorationPairing } from './designated'
import { foalPlacement, type DamRole } from './generation'
import type { LineGeneration } from './lines'

/** 八系指定配種所生：配種紀錄的規則快照與出生紀錄的系與代數（需求規格 7.4、9.1） */
export interface DesignatedOrigin {
  kind: 'designated'
  /** 配種紀錄的實際種牡馬（內部識別）；對應不到內部馬匹時留空 */
  breedingSireId?: string
  /** 配種紀錄的母馬（內部識別） */
  breedingDamId?: string
  /** 規則快照中種牡馬的系與代數 */
  sire: LineGeneration
  /** 規則快照中母馬的身分 */
  dam: DamRole
  /** 出生紀錄的系與代數 */
  recorded: LineGeneration
  /**
   * 規則快照記下這次是補公系配對（需求規格 7.6）：種牡馬是補入的零代市場種牡馬，
   * 以補公系配對核對；其他配種留空
   */
  restoration?: boolean
}

/**
 * 產駒的出生來源：八系指定配種所生，或 free（自由配種所生；沒有配種紀錄，
 * 例如購入時已受胎，或配到八系以外的種牡馬時，也比照自由配種產駒，需求規格 9.5、11.4）
 */
export type FoalOrigin = DesignatedOrigin | { kind: 'free' }

/** 要成為正式後繼的自家產駒：母駒進入母馬群，或公駒接任現任、指定為預定後繼（需求規格 9.6） */
export interface SuccessorCandidate {
  /** 產駒記載的父馬（內部識別）；不知道時留空 */
  sireId?: string
  /** 產駒記載的母馬（內部識別）；不知道時留空 */
  damId?: string
  origin: FoalOrigin
}

/**
 * 核對不符的項目（需求規格 5.2：後繼的系、代數與規則不符時阻止）：
 * - free-breeding：自由配種所生，不可成為八系後繼（9.5）
 * - parents：產駒記載的父母與配種紀錄不符，或有一方不明
 * - placement：依規則快照重算的系與代數與出生紀錄不符；expected 是重算的結果
 * - pairing：這次配種不是出生紀錄那一代的指定配對（例如偏離規則的配種），補公系所生則以補公系配對比對；
 *   blocks 是 10.3 的阻止內容，該系在那一代還沒成立時為空陣列
 * - target：要進入的母馬群或接任的位置與出生紀錄不符；expected 是出生紀錄的系與代數
 */
export type SuccessorBlock =
  | { mismatch: 'free-breeding' }
  | { mismatch: 'parents' }
  | { mismatch: 'placement'; expected: LineGeneration }
  | { mismatch: 'pairing'; blocks: BreedingBlock[] }
  | { mismatch: 'target'; expected: LineGeneration }

/**
 * 進入母馬群或接任前，再次核對父母、系與代數，不符時阻止（需求規格 9.6）。
 * target 是要進入的母馬群，或要接任、指定為預定後繼的系與代數。
 */
export function verifySuccessor(
  candidate: SuccessorCandidate,
  target: LineGeneration,
): SuccessorBlock[] {
  const { origin } = candidate
  if (origin.kind === 'free') return [{ mismatch: 'free-breeding' }]
  const blocks: SuccessorBlock[] = []
  const parentsMatch =
    candidate.sireId !== undefined &&
    candidate.damId !== undefined &&
    candidate.sireId === origin.breedingSireId &&
    candidate.damId === origin.breedingDamId
  if (!parentsMatch) blocks.push({ mismatch: 'parents' })
  const computed = foalPlacement(origin.sire, origin.dam)
  if (!samePlacement(computed, origin.recorded)) {
    blocks.push({ mismatch: 'placement', expected: computed })
  } else {
    // 系與代數算得對，還要是那一代規則指定的配對（10.3），補公系所生以補公系配對核對（7.6）；
    // 零代種牡馬例外配市場母馬只警告，不阻止
    const { line, generation } = origin.recorded
    const pairing = origin.restoration
      ? restorationPairing(line, generation - 1)
      : designatedPairing(line, generation)
    const pairingBlocks = pairing
      ? checkDesignatedBreeding(pairing, origin.sire, origin.dam).blocks
      : []
    if (!pairing || pairingBlocks.length > 0) {
      blocks.push({ mismatch: 'pairing', blocks: pairingBlocks })
    }
  }
  if (!samePlacement(origin.recorded, target)) {
    blocks.push({ mismatch: 'target', expected: origin.recorded })
  }
  return blocks
}

function samePlacement(a: LineGeneration, b: LineGeneration): boolean {
  return a.line === b.line && a.generation === b.generation
}
