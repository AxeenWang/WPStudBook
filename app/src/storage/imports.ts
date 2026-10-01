import type { ImportSnapshot } from '../core/imports'
import type { WPStudBookDatabase } from './database'
import { loadGame } from './games'

// CE 匯入的快照與套用（技術設計 4.4「資料流」「流程」）

/**
 * 讀出匯入比對快照（技術設計 4.4「資料流」第 4 步）：在一個唯讀交易內讀遊戲局、這一局的匯入紀錄與檢查點的摘要。
 * 遊戲局不存在時丟出錯誤
 */
export async function loadImportSnapshot(
  db: WPStudBookDatabase,
  gameId: string,
): Promise<ImportSnapshot> {
  return db.transaction('r', [db.games, db.imports, db.checkpoints], async () => {
    const game = await loadGame(db, gameId)
    const imports = await db.imports.where('gameId').equals(gameId).toArray()
    const checkpoints = await db.checkpoints.where('gameId').equals(gameId).toArray()
    return {
      gameId,
      currentYear: game.currentYear,
      updatedAt: game.updatedAt,
      imports,
      checkpoints: checkpoints.map(({ id, year, timing, createdAt }) => ({
        id,
        year,
        ...(timing === undefined ? {} : { timing }),
        createdAt,
      })),
    }
  })
}
