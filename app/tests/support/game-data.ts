import type { WPStudBookDatabase } from '../../src/storage/database'
import type { GameData } from '../../src/storage/game-data'
import { DEFAULT_SETTINGS } from '../../src/storage/games'
import type { GameRow } from '../../src/storage/records'
import { addTestGame } from './database'
import { importRecord } from './imports'
import { horseRow, lineRow, restorationRow, stallionRow, startMareRow } from './rows'

/**
 * 一局的樣本資料：每張表至少一列，資料列之間的關聯都接得上（備份的關聯檢查會通過）。
 * 識別以遊戲局開頭，兩局的樣本互不相撞；各表的列依識別排序，與 readGameData 讀出的順序相同。
 * 遊戲局與設定由 addSampleGame 寫入
 */
export function sampleRows(gameId: string): Omit<GameData, 'games' | 'settings'> {
  const id = (name: string) => `${gameId}-${name}`
  return {
    horses: [
      horseRow(id('F'), {
        gameId,
        fullName: 'テストフォール',
        baseName: 'テストフォール',
        nameSource: 'import',
        aliases: ['テストフォ'],
        birthYear: 1990,
        sex: 'male',
        sireId: id('S'),
        damId: id('M'),
        birth: { breedingId: id('B') },
        disposition: 'for-sale',
      }),
      horseRow(id('M'), {
        gameId,
        fullName: '(外)テストメア',
        baseName: 'テストメア',
        nameSource: 'manual',
        abilityNumber: '0x0000',
        birthYear: 1985,
        sex: 'female',
        note: '中文備註',
      }),
      horseRow(id('S'), {
        gameId,
        fullName: 'テストスタリオン',
        baseName: 'テストスタリオン',
        nameSource: 'manual',
        sex: 'male',
      }),
    ],
    lines: [lineRow(1, 'マンノウォー', { gameId })],
    systems: [{ gameId, subsystem: 'マンノウォー', parentSystem: 'マッチェム' }],
    mares: [startMareRow(id('M'), { gameId, location: 32 })],
    mareYears: [
      {
        gameId,
        horseId: id('M'),
        year: 1989,
        mayVigor: { value: 0, boosted: false },
        plan: 'free',
      },
    ],
    stallions: [stallionRow(id('S'), 1, 0, { gameId, id: id('P') })],
    restorations: [restorationRow(id('R'), 1, 1, 'sire', { gameId, revoked: true })],
    breedings: [
      {
        id: id('B'),
        gameId,
        mareId: id('M'),
        year: 1989,
        kind: 'free',
        sireId: id('S'),
        conception: '受胎',
      },
    ],
    matingRatings: [
      { id: id('T'), gameId, mareId: id('M'), sireId: id('S'), year: 1989, grade: 'A', burst: 0 },
    ],
    events: [
      {
        id: id('E'),
        gameId,
        year: 1990,
        recordedAt: '2026-09-24T00:00:00.000Z',
        source: { kind: 'manual' },
        kind: 'foal-added',
        horseId: id('F'),
        breedingId: id('B'),
        disposition: 'for-sale',
      },
    ],
    horseNumbers: [
      {
        id: id('N'),
        gameId,
        horseId: id('M'),
        stage: 'broodmare',
        number: '0x1A2B',
        year: 1989,
        source: { kind: 'import', importType: 'may-herd', importId: id('I') },
      },
    ],
    imports: [importRecord(id('I'), 'may-herd', 1989, { gameId })],
  }
}

/** 寫入一局（addTestGame）與它的樣本資料，回傳 readGameData 應讀到的內容 */
export async function addSampleGame(
  db: WPStudBookDatabase,
  fields: Partial<GameRow> = {},
): Promise<GameData> {
  const game = await addTestGame(db, fields)
  const rows = sampleRows(game.id)
  await db.transaction('rw', db.tables, async () => {
    for (const [name, list] of Object.entries(rows)) await db.table(name).bulkAdd(list)
  })
  return { games: [game], settings: [{ gameId: game.id, ...DEFAULT_SETTINGS }], ...rows }
}
