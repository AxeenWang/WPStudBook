import { designatedPairing } from '../../src/core/designated'
import { branchOf, type LinePosition } from '../../src/core/lines'
import type { Mating, PedigreeNode } from '../../src/core/pedigree'
import type { LineSystem, SystemEntry } from '../../src/core/systems'
import { eightLineSystems, subsystemOfLine } from './systems'

export interface EightLinePlanOptions {
  /** 覆寫替代母馬的自身父系；回傳 undefined 表示用預設值，也就是與她替代的系相同（需求規格 8.3 最理想的情況） */
  substituteSubsystem?: (line: LinePosition, generation: number) => string | undefined
}

export interface EightLinePlan {
  /** 產出第 line 系第 generation 代的配種，含完整祖先 */
  matingOf(line: LinePosition, generation: number): Mating
  table: SystemEntry[]
  lines: LineSystem[]
}

/**
 * 測試用：模擬依需求規格 7.3 建系、7.4 循環的八系計畫，產生血統樹。
 * 配對本身來自 core 的 designatedPairing，對照 docs/specs/八系巡迴圖.html 的模擬結果。
 * 市場馬（零代種牡馬、替代母馬、起點母馬）沒有父母紀錄，零代種牡馬與替代母馬有自己的父系。
 */
export function buildEightLinePlan(options: EightLinePlanOptions = {}): EightLinePlan {
  const { table, lines } = eightLineSystems()
  const cache = new Map<string, PedigreeNode>()
  const remember = (id: string, build: () => PedigreeNode): PedigreeNode => {
    const cached = cache.get(id)
    if (cached) return cached
    const node = build()
    cache.set(id, node)
    return node
  }

  const zeroStallion = (line: LinePosition): PedigreeNode =>
    remember(`Z${line}`, () => ({
      horse: {
        id: `Z${line}`,
        name: `第${line}系零代種牡馬`,
        sireSystem: subsystemOfLine(line),
        buildPhaseMarket: true,
      },
      sire: null,
      dam: null,
    }))

  const substitute = (line: LinePosition, generation: number): PedigreeNode =>
    remember(`M${line}-${generation}`, () => ({
      horse: {
        id: `M${line}-${generation}`,
        name: `替代第${line}系${generation}代`,
        sireSystem: options.substituteSubsystem?.(line, generation) ?? subsystemOfLine(line),
        // 產出 1～4 代的配對用的替代母馬屬於建系期
        buildPhaseMarket: generation <= 3,
      },
      sire: null,
      dam: null,
    }))

  const startMare = (): PedigreeNode =>
    remember('M0', () => ({
      horse: { id: 'M0', name: '第1系起點母馬', buildPhaseMarket: true },
      sire: null,
      dam: null,
    }))

  const ownHorse = (line: LinePosition, generation: number, sex: 'm' | 'f'): PedigreeNode =>
    remember(`H${line}-${generation}-${sex}`, () => {
      const mating = matingOf(line, generation)
      return {
        horse: {
          id: `H${line}-${generation}-${sex}`,
          name: `第${line}系${generation}代${sex === 'm' ? '牡' : '牝'}`,
          sireSystem: subsystemOfLine(line),
        },
        sire: mating.sire,
        dam: mating.dam,
      }
    })

  function matingOf(line: LinePosition, generation: number): Mating {
    const pairing = designatedPairing(line, generation)
    if (!pairing) throw new Error(`第 ${line} 系在 ${generation} 代還沒成立`)
    const sire =
      pairing.sire.generation === 0
        ? zeroStallion(line)
        : ownHorse(line, pairing.sire.generation, 'm')
    if (pairing.mares.kind === 'start') return { sire, dam: startMare() }
    const { line: mareLine, generation: mareGeneration } = pairing.mares
    const founded = mareGeneration >= branchOf(mareLine).outputGeneration
    const dam = founded
      ? ownHorse(mareLine, mareGeneration, 'f')
      : substitute(mareLine, mareGeneration)
    return { sire, dam }
  }

  return { matingOf, table, lines }
}
