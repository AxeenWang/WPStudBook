import { LINE_POSITIONS, type LinePosition } from '../../src/core/lines'
import type { DesignatedBreedingInput } from '../../src/storage/breeding-writes'
import type { WPStudBookDatabase } from '../../src/storage/database'
import type { BreedingRow, HorseRow } from '../../src/storage/records'
import { addTestGame, testDatabase } from './database'
import { GAME, horseRow, lineRow, ownMareRow, stallionRow, substituteMareRow } from './rows'
import { eightLineSystems, subsystemOfLine } from './systems'

/**
 * 測試用的建系期牧場，目前遊戲年 1990。第 1 系（マンノウォー，親系統 マッチェム）與
 * 第 2 系（ハイペリオン，親系統 ハイペリオン）已開啟。種牡馬都在崗：Z1 第 1 系零代、S11 第 1 系 1 代、
 * Z2 第 2 系零代。母馬都在圈、1985 年生：D11 第 1 系 1 代自家母駒（ハナカゴ，暫定保留，使該代成立）；
 * SUB21 替代第 2 系 1 代（自身父系 ハイペリオン）；SUB11 替代第 1 系 1 代（自身父系 マンノウォー），
 * 登記時例外補入，原因「自家母駒不足」。
 * 任務看板上有「第 1 系 1 代 × 第 2 系 1 代母馬群 → 第 1 系 2 代」與
 * 「第 2 系零代 × 第 1 系 1 代母馬群 → 第 2 系 2 代」
 */
export async function buildPhaseHerd(): Promise<WPStudBookDatabase> {
  const db = testDatabase()
  await addTestGame(db)
  await db.lines.bulkAdd([lineRow(1, 'マンノウォー'), lineRow(2, 'ハイペリオン')])
  await db.systems.bulkAdd([
    { gameId: GAME, subsystem: 'マンノウォー', parentSystem: 'マッチェム' },
    { gameId: GAME, subsystem: 'ハイペリオン', parentSystem: 'ハイペリオン' },
  ])
  await db.horses.bulkAdd([
    horseRow('Z1', { sex: 'male', sireSystem: 'マンノウォー' }),
    horseRow('S11', {
      sex: 'male',
      birthYear: 1985,
      birth: { placement: { line: 1, generation: 1 } },
    }),
    horseRow('Z2', { sex: 'male', sireSystem: 'ハイペリオン' }),
    horseRow('D11', {
      sex: 'female',
      baseName: 'ハナカゴ',
      birthYear: 1985,
      birth: { placement: { line: 1, generation: 1 } },
    }),
    horseRow('SUB21', { sex: 'female', birthYear: 1985, sireSystem: 'ハイペリオン' }),
    horseRow('SUB11', { sex: 'female', birthYear: 1985, sireSystem: 'マンノウォー' }),
  ])
  await db.stallions.bulkAdd([
    stallionRow('Z1', 1, 0),
    stallionRow('S11', 1, 1),
    stallionRow('Z2', 2, 0),
  ])
  await db.mares.bulkAdd([
    ownMareRow('D11', 1, 1),
    substituteMareRow('SUB21', 2, 1),
    substituteMareRow('SUB11', 1, 1, {
      source: { kind: 'market-founding' },
      exceptionReason: '自家母駒不足',
    }),
  ])
  return db
}

/** 指定配種的輸入：任務產出第 line 系第 generation 代，實際種牡馬 sireId */
export function designatedTo(
  line: LinePosition,
  generation: number,
  sireId: string,
  exceptionReason?: string,
): DesignatedBreedingInput {
  return {
    kind: 'designated',
    output: { line, generation },
    sireId,
    ...(exceptionReason === undefined ? {} : { exceptionReason }),
  }
}

/** 建系期（產出 4 代以內）的配種不計算活血（需求規格 10.1），規則快照存的血統檢查結果 */
export const BUILD_PHASE_PEDIGREE = { estimate: null, duplicates: [], warnings: [] }

/** 循環期牧場的血統：覆寫 S14、D24 的欄位（例如父母），以及血統上其他的馬 */
export interface CyclePedigree {
  sire?: Partial<HorseRow>
  dam?: Partial<HorseRow>
  ancestors?: readonly HorseRow[]
}

/**
 * 測試用的循環期牧場，目前遊戲年 1990：八系都已開啟（系1子～系8子，親系統 系1親～系8親）。
 * 第 1 系 4 代種牡馬 S14 在崗，第 2 系 4 代自家母駒 D24（1985 年生）在圈並使該代成立；
 * 任務看板上有「第 1 系 4 代 × 第 2 系 4 代母馬群 → 第 1 系 5 代」。省略 pedigree 時兩匹都沒有父母紀錄
 */
export async function cyclePhaseHerd(pedigree: CyclePedigree = {}): Promise<WPStudBookDatabase> {
  const db = testDatabase()
  await addTestGame(db)
  await db.lines.bulkAdd(LINE_POSITIONS.map((line) => lineRow(line, subsystemOfLine(line))))
  await db.systems.bulkAdd(eightLineSystems().table.map((entry) => ({ gameId: GAME, ...entry })))
  await db.horses.bulkAdd([
    horseRow('S14', {
      sex: 'male',
      birth: { placement: { line: 1, generation: 4 } },
      ...pedigree.sire,
    }),
    horseRow('D24', {
      sex: 'female',
      birthYear: 1985,
      birth: { placement: { line: 2, generation: 4 } },
      ...pedigree.dam,
    }),
    ...(pedigree.ancestors ?? []),
  ])
  await db.stallions.add(stallionRow('S14', 1, 4))
  await db.mares.add(ownMareRow('D24', 2, 4))
  return db
}

/** SUB21 在 1989 年的八系指定配種：第 1 系 1 代 S11 × 替代第 2 系 1 代 → 第 1 系 2 代，受胎 */
export const DESIGNATED_1989: BreedingRow = {
  id: 'B89',
  gameId: GAME,
  mareId: 'SUB21',
  year: 1989,
  kind: 'designated',
  sireId: 'S11',
  conception: '受胎',
  rule: {
    distance: 1,
    sire: { line: 1, generation: 1 },
    dam: { kind: 'substitute', forLine: 2, forGeneration: 1 },
    output: { line: 1, generation: 2 },
    pedigree: BUILD_PHASE_PEDIGREE,
  },
}

/** D11 在 1989 年的自由配種：種牡馬只有外部名稱 ノーザンダンサー，受胎 */
export const FREE_1989: BreedingRow = {
  id: 'F89',
  gameId: GAME,
  mareId: 'D11',
  year: 1989,
  kind: 'free',
  sireName: 'ノーザンダンサー',
  conception: '受胎',
}

/** SUB11 在 1989 年的自由配種：種牡馬 S11，不受胎 */
export const BARREN_1989: BreedingRow = {
  id: 'N89',
  gameId: GAME,
  mareId: 'SUB11',
  year: 1989,
  kind: 'free',
  sireId: 'S11',
  conception: '不受胎',
}

/** 測試用：建系期牧場（buildPhaseHerd）加上 1989 年的三筆配種紀錄，1990 年四月產駒出生 */
export async function foalingHerd(): Promise<WPStudBookDatabase> {
  const db = await buildPhaseHerd()
  await db.breedings.bulkAdd([DESIGNATED_1989, FREE_1989, BARREN_1989])
  return db
}
