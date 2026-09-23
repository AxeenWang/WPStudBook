import type { DesignatedPairing } from './designated'
import { damPlacement, type DamRole } from './generation'
import type { LineGeneration } from './lines'

/** 指定配種實際選的母馬：規則上的身分，或尚未指定用途（需求規格 8.4） */
export type SelectedDam = DamRole | { kind: 'unassigned' }

/** 阻止：錯誤的一方與規則指定的對象（需求規格 10.3） */
export interface BreedingBlock {
  side: 'sire' | 'dam'
  /** 規則指定的系與代數；'start' 表示第 1 系起點母馬群 */
  expected: LineGeneration | 'start'
  /** 不符的項目：系、代數，或身分（八系以外的種牡馬、待指定用途或起點用的母馬） */
  mismatches: ('line' | 'generation' | 'role')[]
}

/** 警告並確認：零代市場種牡馬例外配市場母馬，需保存原因（需求規格 7.3） */
export interface BreedingWarning {
  kind: 'zero-sire-market-mare'
}

export interface BreedingCheck {
  blocks: BreedingBlock[]
  warnings: BreedingWarning[]
}

/**
 * 檢查指定配種實際選的種牡馬與母馬是否符合規則（需求規格 10.3）。
 * sire 為實際種牡馬在八系中的系與代數，八系以外的種牡馬傳 null。
 * 只比對系與代數；種牡馬是否為現任，由任務看板判斷。
 */
export function checkDesignatedBreeding(
  pairing: DesignatedPairing,
  sire: LineGeneration | null,
  dam: SelectedDam,
): BreedingCheck {
  const blocks: BreedingBlock[] = []
  const warnings: BreedingWarning[] = []

  const sireMismatches: BreedingBlock['mismatches'] =
    sire === null ? ['role'] : compare(pairing.sire, sire)
  if (sireMismatches.length > 0) {
    blocks.push({ side: 'sire', expected: pairing.sire, mismatches: sireMismatches })
  }

  // 母馬實際計入的母馬群；待指定用途的母馬不屬於任何母馬群
  const actual = dam.kind === 'unassigned' ? null : damPlacement(dam)
  if (pairing.mares.kind === 'start') {
    if (actual?.kind !== 'start') {
      blocks.push({ side: 'dam', expected: 'start', mismatches: ['role'] })
    }
    return { blocks, warnings }
  }

  const expected = { line: pairing.mares.line, generation: pairing.mares.generation }
  const damMismatches: BreedingBlock['mismatches'] =
    actual?.kind === 'group' ? compare(expected, actual) : ['role']
  if (damMismatches.length > 0) {
    blocks.push({ side: 'dam', expected, mismatches: damMismatches })
  } else if (dam.kind === 'substitute' && pairing.sire.generation === 0) {
    warnings.push({ kind: 'zero-sire-market-mare' })
  }
  return { blocks, warnings }
}

function compare(expected: LineGeneration, actual: LineGeneration): ('line' | 'generation')[] {
  const mismatches: ('line' | 'generation')[] = []
  if (actual.line !== expected.line) mismatches.push('line')
  if (actual.generation !== expected.generation) mismatches.push('generation')
  return mismatches
}
