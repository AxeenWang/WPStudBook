import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { createDatabase, type WPStudBookDatabase } from '../../src/storage/database'
import { DEFAULT_SETTINGS } from '../../src/storage/games'
import type { GameRow } from '../../src/storage/records'
import { GAME } from './rows'

/** 測試用資料庫：每次呼叫都是全新、互不相干的 fake-indexeddb */
export function testDatabase(): WPStudBookDatabase {
  return createDatabase('wpstudbook-test', { indexedDB: new IDBFactory(), IDBKeyRange })
}

/**
 * 直接寫入一局與預設設定。識別預設是 rows.ts 的 GAME，方便搭配那裡的資料列；
 * 目前遊戲年預設 1990
 */
export async function addTestGame(
  db: WPStudBookDatabase,
  fields: Partial<GameRow> = {},
): Promise<GameRow> {
  const game: GameRow = {
    id: GAME,
    name: `測試局 ${fields.id ?? GAME}`,
    startYear: 1968,
    currentYear: 1990,
    createdAt: '2026-09-24T00:00:00.000Z',
    updatedAt: '2026-09-24T00:00:00.000Z',
    ...fields,
  }
  await db.games.add(game)
  await db.settings.add({ gameId: game.id, ...DEFAULT_SETTINGS })
  return game
}
