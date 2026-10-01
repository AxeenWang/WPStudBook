import { describe, expect, it } from 'vitest'
import { addTestGame, testDatabase } from '../../tests/support/database'
import { importRecord } from '../../tests/support/imports'
import { GAME, checkpointRow } from '../../tests/support/rows'
import { loadImportSnapshot } from './imports'

describe('loadImportSnapshot', () => {
  it('遊戲局的目前遊戲年與更新時間、這一局的匯入紀錄與檢查點的摘要（技術設計 4.4「資料流」）', async () => {
    const db = testDatabase()
    await addTestGame(db, { currentYear: 1971, updatedAt: '2026-10-01T01:00:00.000Z' })
    await addTestGame(db, { id: 'G2' })
    const records = [importRecord('I1', 'may-herd', 1970), importRecord('I2', 'candidates', 1971)]
    await db.imports.bulkAdd([...records, importRecord('I3', 'may-herd', 1970, { gameId: 'G2' })])
    await db.checkpoints.bulkAdd([
      checkpointRow('C1', {
        origin: 'auto',
        year: 1970,
        timing: { month: 5, week: 1 },
        catchUp: { year: 1970, timing: { month: 4, week: 1 } },
        createdAt: '2026-10-01T00:00:01.000Z',
        note: '存檔 A',
        pinned: true,
      }),
      checkpointRow('C2', { year: 1971, createdAt: '2026-10-01T00:00:02.000Z' }),
      checkpointRow('C3', { gameId: 'G2' }),
    ])
    expect(await loadImportSnapshot(db, GAME)).toStrictEqual({
      gameId: GAME,
      currentYear: 1971,
      updatedAt: '2026-10-01T01:00:00.000Z',
      imports: records,
      checkpoints: [
        {
          id: 'C1',
          year: 1970,
          timing: { month: 5, week: 1 },
          createdAt: '2026-10-01T00:00:01.000Z',
        },
        { id: 'C2', year: 1971, createdAt: '2026-10-01T00:00:02.000Z' },
      ],
    })
  })

  it('遊戲局不存在時丟出錯誤', async () => {
    await expect(loadImportSnapshot(testDatabase(), 'missing')).rejects.toThrow(
      '找不到遊戲局：missing',
    )
  })
})
