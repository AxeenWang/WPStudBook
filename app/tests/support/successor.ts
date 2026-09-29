import type { WPStudBookDatabase } from '../../src/storage/database'
import type { BreedingRow, HorseRow, Sex } from '../../src/storage/records'
import { cyclePhaseHerd } from './breeding'
import { addTestGame, testDatabase } from './database'
import {
  GAME,
  horseRow,
  lineRow,
  ownFoalRow,
  ownMareRow,
  restorationRow,
  stallionRow,
} from './rows'

/** 測試資料的配種紀錄不看血統檢查的結果 */
const PEDIGREE = { estimate: null, duplicates: [], warnings: [] }

/** 第 1 系 4 代 S14 × 第 2 系 4 代自家母駒 mareId → 第 1 系 5 代的八系指定配種，受胎 */
function designated(id: string, mareId: string, year: number): BreedingRow {
  return {
    id,
    gameId: GAME,
    mareId,
    year,
    kind: 'designated',
    sireId: 'S14',
    conception: '受胎',
    rule: {
      distance: 1,
      sire: { line: 1, generation: 4 },
      dam: { kind: 'own', line: 2, generation: 4 },
      output: { line: 1, generation: 5 },
      pedigree: PEDIGREE,
    },
  }
}

/** S14 所生、出生紀錄連到 breedingId 的第 1 系 5 代產駒，牧場處置為保留 */
function foal(
  id: string,
  sex: Sex,
  birthYear: number,
  damId: string,
  breedingId: string,
): HorseRow {
  return horseRow(id, {
    sex,
    birthYear,
    sireId: 'S14',
    damId,
    birth: { breedingId, placement: { line: 1, generation: 5 } },
    disposition: 'keep',
  })
}

/**
 * 測試用的後繼牧場（循環期牧場 cyclePhaseHerd，目前遊戲年 1990）：第 1 系 4 代 S14 在崗；
 * 第 2 系 4 代自家母駒 D24（1980 年生）與 D24B（1981 年生）都在圈，父母不同。
 * 八系指定配種（S14 × 第 2 系 4 代 → 第 1 系 5 代，都受胎）：D24 的 1986、1987、1989、1990 年（B86、B87、B89、B90），
 * D24B 的 1988 年（B88）；D24B 在 1989 年另有自由配種 F89（ノーザンダンサー，受胎）。
 * 產駒都是第 1 系 5 代、保留：公駒 C87（B86 所生）、C89（B88 所生，C87 的同父異母弟弟），
 * 牝駒 F88（B87 所生）、F90（B89 所生，F88 的同父同母妹妹）；另有 D24B 的自由配種所生牝駒 FREE90（待售）。
 * B90 的產駒還沒出生
 */
export async function successorHerd(): Promise<WPStudBookDatabase> {
  const db = await cyclePhaseHerd({ dam: { birthYear: 1980 } })
  await db.horses.add(ownFoalRow('D24B', 2, 4, { birthYear: 1981 }))
  await db.mares.add(ownMareRow('D24B', 2, 4))
  await db.breedings.bulkAdd([
    designated('B86', 'D24', 1986),
    designated('B87', 'D24', 1987),
    designated('B88', 'D24B', 1988),
    designated('B89', 'D24', 1989),
    designated('B90', 'D24', 1990),
    {
      id: 'F89',
      gameId: GAME,
      mareId: 'D24B',
      year: 1989,
      kind: 'free',
      sireName: 'ノーザンダンサー',
      conception: '受胎',
    },
  ])
  await db.horses.bulkAdd([
    foal('C87', 'male', 1987, 'D24', 'B86'),
    foal('F88', 'female', 1988, 'D24', 'B87'),
    foal('C89', 'male', 1989, 'D24B', 'B88'),
    foal('F90', 'female', 1990, 'D24', 'B89'),
    horseRow('FREE90', {
      sex: 'female',
      birthYear: 1990,
      sireName: 'ノーザンダンサー',
      damId: 'D24B',
      birth: { breedingId: 'F89' },
      disposition: 'for-sale',
    }),
  ])
  return db
}

/** 第 5 系零代 Z5R（補公系 R1）× 第 1 系 12 代自家母駒 D112 → 第 5 系 13 代的補公系指定配種，受胎 */
function restored(id: string, year: number): BreedingRow {
  return {
    id,
    gameId: GAME,
    mareId: 'D112',
    year,
    kind: 'designated',
    sireId: 'Z5R',
    conception: '受胎',
    rule: {
      distance: 4,
      sire: { line: 5, generation: 0 },
      dam: { kind: 'own', line: 1, generation: 12 },
      output: { line: 5, generation: 13 },
      restoration: true,
      pedigree: PEDIGREE,
    },
  }
}

/**
 * 測試用的補公系牧場，目前遊戲年 1990：第 1 系與第 5 系已開啟。第 5 系 12 代的種牡馬 S512 已引退，
 * 宣告了第 5 系 12 代補公系（R1），補入的零代市場種牡馬 Z5R 在崗；第 1 系 12 代自家母駒 D112（1980 年生）在圈。
 * 補公系配對（第 5 系零代 × 第 1 系 12 代母馬群 → 第 5 系 13 代）的指定配種都受胎：
 * 1989 年的 BR89 生下公駒 C513（1990 年生），1990 年的 BR90 產駒還沒出生
 */
export async function restorationHerd(): Promise<WPStudBookDatabase> {
  const db = testDatabase()
  await addTestGame(db)
  await db.lines.bulkAdd([lineRow(1, '系1子'), lineRow(5, '系5子')])
  await db.horses.bulkAdd([
    horseRow('S512', { sex: 'male', birth: { placement: { line: 5, generation: 12 } } }),
    horseRow('Z5R', { sex: 'male', sireSystem: '系5子' }),
    ownFoalRow('D112', 1, 12, { birthYear: 1980 }),
    horseRow('C513', {
      sex: 'male',
      birthYear: 1990,
      sireId: 'Z5R',
      damId: 'D112',
      birth: { breedingId: 'BR89', placement: { line: 5, generation: 13 } },
      disposition: 'keep',
    }),
  ])
  await db.stallions.bulkAdd([
    stallionRow('S512', 5, 12, { status: 'retired' }),
    stallionRow('Z5R', 5, 0, { restorationId: 'R1' }),
  ])
  await db.restorations.add(restorationRow('R1', 5, 12, 'sire'))
  await db.mares.add(ownMareRow('D112', 1, 12))
  await db.breedings.bulkAdd([restored('BR89', 1989), restored('BR90', 1990)])
  return db
}
