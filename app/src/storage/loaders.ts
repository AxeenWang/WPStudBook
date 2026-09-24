import type { EightLineSnapshot } from '../core/board'
import type { LineSystemSnapshot, SystemTable } from '../core/systems'
import type { WPStudBookDatabase } from './database'
import { loadGame, loadSettings } from './games'
import type { HorseRow } from './records'
import { buildEightLineSnapshot, buildLineSystems, buildSystemTable } from './snapshot'

// 讀取 Dexie、交給純函式組成核心的輸入（技術設計 4.3「規則輸入快照的彙整」）。
// 找不到遊戲局，或資料列之間的關聯斷掉時，丟出帶識別的錯誤（技術設計第 5 章的預期外失敗）。

/** 任務看板與規則檢查共用的規則輸入（技術設計 4.2） */
export interface RuleSnapshot {
  eightLines: EightLineSnapshot
  systemTable: SystemTable
  lineSystems: LineSystemSnapshot
}

/** 讀取一局的規則輸入快照；在同一個唯讀交易內讀完，資料一致。年齡以目前遊戲年計算 */
export async function loadRuleSnapshot(
  db: WPStudBookDatabase,
  gameId: string,
): Promise<RuleSnapshot> {
  return db.transaction(
    'r',
    [
      db.games,
      db.settings,
      db.lines,
      db.systems,
      db.stallions,
      db.mares,
      db.horses,
      db.restorations,
    ],
    async () => {
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
      const systemTable = buildSystemTable(systems)
      return {
        eightLines: buildEightLineSnapshot(
          { lines, stallions, mares, horses, restorations },
          game.currentYear,
          settings,
        ),
        systemTable,
        lineSystems: buildLineSystems(lines, systemTable),
      }
    },
  )
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
