import type { Table } from 'dexie'
import type { EightLineSnapshot } from '../core/board'
import type { KnownHorse } from '../core/identity'
import type { LinePosition } from '../core/lines'
import { CLOSE_GENERATIONS, type Mating } from '../core/pedigree'
import type { OwnMare } from '../core/sisters'
import type { StallionRecord } from '../core/stallions'
import type { SubstituteMare } from '../core/substitute'
import type { SuccessorCandidate } from '../core/successor'
import type { LineSystemSnapshot, SystemTable } from '../core/systems'
import type { WPStudBookDatabase } from './database'
import { loadGame, loadSettings } from './games'
import {
  buildKnownHorses,
  buildOwnMares,
  buildStallionRecords,
  buildSubstituteMares,
  buildSuccessorCandidate,
} from './inputs'
import { buildMating } from './mating'
import type { GameRow, HorseRow, MareRow, SettingsRow, SystemRow } from './records'
import {
  buildEightLineSnapshot,
  buildLineSystems,
  buildSystemTable,
  type EightLineRows,
} from './snapshot'

// 讀取 Dexie、交給純函式組成核心的輸入（技術設計 4.3「規則輸入快照的彙整」）。
// 找不到遊戲局，或資料列之間的關聯斷掉時，丟出帶識別的錯誤（技術設計第 5 章的預期外失敗）。

/** 任務看板與規則檢查共用的規則輸入（技術設計 4.2） */
export interface RuleSnapshot {
  eightLines: EightLineSnapshot
  systemTable: SystemTable
  lineSystems: LineSystemSnapshot
}

/** 規則輸入快照需要的資料列：這一局、設定、系、系統對照表、任用、母馬與她們的馬匹、補系宣告 */
export interface RuleRows extends EightLineRows {
  game: GameRow
  settings: SettingsRow
  systems: readonly SystemRow[]
}

/** 規則輸入快照要讀的資料表；讀取與寫入操作的交易都要包含 */
export function ruleTables(db: WPStudBookDatabase): Table[] {
  return [
    db.games,
    db.settings,
    db.lines,
    db.systems,
    db.stallions,
    db.mares,
    db.horses,
    db.restorations,
  ]
}

/**
 * 在呼叫端的交易內讀取規則輸入快照需要的資料列；交易要包含 ruleTables 的資料表。
 * 替所有母馬讀馬匹，任何一匹母馬的馬匹不見都會丟出錯誤
 */
export async function readRuleRows(db: WPStudBookDatabase, gameId: string): Promise<RuleRows> {
  const game = await loadGame(db, gameId)
  const settings = await loadSettings(db, gameId)
  const [lines, systems, stallions, mares, restorations] = await Promise.all([
    db.lines.where('gameId').equals(gameId).toArray(),
    db.systems.where('gameId').equals(gameId).toArray(),
    db.stallions.where('gameId').equals(gameId).toArray(),
    db.mares.where('gameId').equals(gameId).toArray(),
    db.restorations.where('gameId').equals(gameId).toArray(),
  ])
  const horses = await loadHorses(
    db,
    gameId,
    mares.map((mare) => mare.horseId),
  )
  return { game, settings, lines, systems, stallions, mares, horses, restorations }
}

/** 由資料列組出規則輸入快照；年齡以目前遊戲年計算 */
export function buildRuleSnapshot(rows: RuleRows): RuleSnapshot {
  const systemTable = buildSystemTable(rows.systems)
  return {
    eightLines: buildEightLineSnapshot(rows, rows.game.currentYear, rows.settings),
    systemTable,
    lineSystems: buildLineSystems(rows.lines, systemTable),
  }
}

/** 讀取一局的規則輸入快照；在同一個唯讀交易內讀完，資料一致。年齡以目前遊戲年計算 */
export async function loadRuleSnapshot(
  db: WPStudBookDatabase,
  gameId: string,
): Promise<RuleSnapshot> {
  return db.transaction('r', ruleTables(db), async () =>
    buildRuleSnapshot(await readRuleRows(db, gameId)),
  )
}

/**
 * 讀取一次配種的血統樹（需求規格 10.2）：從種牡馬與母馬往上一代一代批次讀到第 4 代；
 * 近親重複的馬只讀一次；任用與母馬資料也只讀這一局的。樹上的馬找不到或屬於其他局時丟出錯誤。
 */
export async function loadMating(
  db: WPStudBookDatabase,
  gameId: string,
  sireId: string | undefined,
  damId: string | undefined,
): Promise<Mating> {
  return db.transaction(
    'r',
    [db.horses, db.stallions, db.mares, db.restorations, db.lines],
    async () => {
      const horses: HorseRow[] = []
      const loaded = new Set<string>()
      let ids = uniqueIds([sireId, damId])
      for (let depth = 1; depth <= CLOSE_GENERATIONS && ids.length > 0; depth++) {
        const rows = await loadHorses(db, gameId, ids)
        horses.push(...rows)
        rows.forEach((row) => loaded.add(row.id))
        ids = uniqueIds(rows.flatMap((row) => [row.sireId, row.damId])).filter(
          (id) => !loaded.has(id),
        )
      }
      const horseIds = horses.map((horse) => horse.id)
      const [stallions, mares, restorations, lines] = await Promise.all([
        db.stallions
          .where('horseId')
          .anyOf(horseIds)
          .and((row) => row.gameId === gameId)
          .toArray(),
        db.mares.bulkGet(horseIds),
        db.restorations.where('gameId').equals(gameId).toArray(),
        db.lines.where('gameId').equals(gameId).toArray(),
      ])
      return buildMating(sireId, damId, {
        horses,
        stallions,
        mares: mares.filter(
          (mare): mare is MareRow => mare !== undefined && mare.gameId === gameId,
        ),
        restorations,
        lines,
      })
    },
  )
}

/**
 * 讀取同父同母的自家母駒（需求規格 8.9），用在轉入時的接替狀態與選定正式保留。
 * 父母任一方不明時不算姊妹，回傳空陣列。
 */
export async function loadSisters(
  db: WPStudBookDatabase,
  gameId: string,
  sireId: string | undefined,
  damId: string | undefined,
): Promise<OwnMare[]> {
  if (sireId === undefined || damId === undefined) return []
  return db.transaction('r', [db.horses, db.mares], async () => {
    const horses = await db.horses
      .where('[gameId+damId]')
      .equals([gameId, damId])
      .filter((horse) => horse.sireId === sireId)
      .toArray()
    const mares = await db.mares.bulkGet(horses.map((horse) => horse.id))
    return buildOwnMares(
      mares.filter((mare): mare is MareRow => mare !== undefined),
      horses,
    )
  })
}

/**
 * 讀取第 line 系第 generation 代的種牡馬紀錄（需求規格 7.7），用在兄弟比較與選定現任。
 * restorationId 留空時是該系該代的一般任用；指定時是那一次補公系補入的任用。
 */
export async function loadStallionRecords(
  db: WPStudBookDatabase,
  gameId: string,
  line: LinePosition,
  generation: number,
  restorationId?: string,
): Promise<StallionRecord[]> {
  return db.transaction('r', [db.stallions, db.horses], async () => {
    const rows = await db.stallions
      .where('[gameId+line+generation]')
      .equals([gameId, line, generation])
      .filter((row) => row.restorationId === restorationId)
      .toArray()
    const horses = await loadHorses(
      db,
      gameId,
      rows.flatMap((row) => row.horseId ?? []),
    )
    return buildStallionRecords(rows, horses)
  })
}

/**
 * 讀取正式後繼核對用的產駒（需求規格 9.6）。
 * 產駒找不到、出生紀錄連結的配種紀錄找不到或屬於其他局時丟出錯誤。
 */
export async function loadSuccessorCandidate(
  db: WPStudBookDatabase,
  gameId: string,
  foalId: string,
): Promise<SuccessorCandidate> {
  return db.transaction('r', [db.horses, db.breedings], async () => {
    const foal = await loadHorse(db, gameId, foalId)
    const breedingId = foal.birth?.breedingId
    if (breedingId === undefined) return buildSuccessorCandidate(foal, undefined)
    const breeding = await db.breedings.get(breedingId)
    if (!breeding || breeding.gameId !== gameId) {
      throw new Error(`找不到配種紀錄：${breedingId}`)
    }
    return buildSuccessorCandidate(foal, breeding)
  })
}

/**
 * 讀取替代第 generation 代的市場母馬（需求規格 8.3），包含已離圈的；exceptHorseId 是正在檢查的母馬本身
 */
export async function loadSubstituteMares(
  db: WPStudBookDatabase,
  gameId: string,
  generation: number,
  exceptHorseId?: string,
): Promise<SubstituteMare[]> {
  return db.transaction('r', [db.mares, db.horses], async () => {
    const mares = await db.mares
      .where('gameId')
      .equals(gameId)
      .filter((mare) => mare.usage === 'substitute' && mare.groupGeneration === generation)
      .toArray()
    const horses = await loadHorses(
      db,
      gameId,
      mares.map((mare) => mare.horseId),
    )
    return buildSubstituteMares(mares, horses, generation, exceptHorseId)
  })
}

/** 讀取身分比對用的既有馬匹（需求規格 6.2）：只讀這一局的馬 */
export async function loadKnownHorses(
  db: WPStudBookDatabase,
  gameId: string,
): Promise<KnownHorse[]> {
  return buildKnownHorses(await db.horses.where('gameId').equals(gameId).toArray())
}

/** 去掉留空與重複的識別 */
function uniqueIds(ids: readonly (string | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => id !== undefined))]
}

/** 讀取同一局的一匹馬；找不到或屬於其他局時丟出錯誤 */
async function loadHorse(db: WPStudBookDatabase, gameId: string, id: string): Promise<HorseRow> {
  const horse = await db.horses.get(id)
  if (!horse || horse.gameId !== gameId) throw new Error(`找不到馬匹：${id}`)
  return horse
}

/** 依識別讀取同一局的馬匹；找不到或屬於其他局時丟出錯誤 */
async function loadHorses(
  db: WPStudBookDatabase,
  gameId: string,
  ids: readonly string[],
): Promise<HorseRow[]> {
  const rows = await db.horses.bulkGet([...ids])
  return rows.map((row, index) => {
    if (!row || row.gameId !== gameId) throw new Error(`找不到馬匹：${ids[index]}`)
    return row
  })
}
