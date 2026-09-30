import { afterEach, describe, expect, it, vi } from 'vitest'
import { testDatabase } from '../../tests/support/database'
import { addSampleGame } from '../../tests/support/game-data'
import { GAME, checkpointRow } from '../../tests/support/rows'
import { archiveGame, prepareArchive, type PreparedArchive } from './archives'
import { readBackup } from './backup'
import { createCheckpoint } from './checkpoints'
import { SCHEMA_VERSION, type WPStudBookDatabase } from './database'
import { countRows, readGameData } from './game-data'
import { currentGameId, recordBackup, setCurrentGame, setCurrentYear } from './games'
import { APP_VERSION } from './version'

/** 準備封存的時間：2026-09-30 01:02:03（UTC） */
const NOW = new Date('2026-09-30T01:02:03.000Z')

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 測試用：準備封存；拒絕時丟出錯誤 */
async function prepared(db: WPStudBookDatabase): Promise<PreparedArchive> {
  const result = await prepareArchive(db, GAME, NOW)
  if (result.status !== 'ok') throw new Error(result.reason.kind)
  return result.archive
}

/** 只輸出 gzip 開頭兩個位元組的假 CompressionStream：封存檔是截斷的 gzip，讀回時解壓失敗 */
class TruncatedGzipStream extends TransformStream<Uint8Array, Uint8Array> {
  constructor() {
    super({
      transform() {},
      flush(controller) {
        controller.enqueue(new Uint8Array([0x1f, 0x8b]))
      },
    })
  }
}

describe('prepareArchive', () => {
  it('匯出並在記憶體讀回驗證：回傳封存檔、索引與快照當下的更新時間（需求規格 12.3）', async () => {
    const db = testDatabase()
    const data = await addSampleGame(db, {
      name: '第一局',
      currentYear: 1995,
      updatedAt: '2026-09-29T00:00:00.000Z',
      appVersion: '0.0.0-old',
    })
    const archive = await prepared(db)
    expect(archive.backup.summary.compressed).toBe(true)
    const read = await readBackup(archive.backup.bytes)
    if (read.status !== 'ok') throw new Error(read.status)
    expect(read.backup.file.collections).toStrictEqual(data)
    expect(archive.index).toStrictEqual({
      id: GAME,
      name: '第一局',
      appVersion: APP_VERSION,
      schemaVersion: SCHEMA_VERSION,
      startYear: 1968,
      currentYear: 1995,
      exportedAt: '2026-09-30T01:02:03.000Z',
      fileName: archive.backup.fileName,
      counts: countRows(data),
      sha256: read.backup.file.sha256,
    })
    expect(archive.index.fileName.endsWith('.json.gz')).toBe(true)
    expect(archive.updatedAt).toBe('2026-09-29T00:00:00.000Z')
  })

  it('只讀：不改資料、不寫索引；遊戲局不存在時丟出錯誤', async () => {
    const db = testDatabase()
    const data = await addSampleGame(db)
    await prepared(db)
    expect(await readGameData(db, GAME)).toStrictEqual(data)
    expect(await db.archives.count()).toBe(0)
    await expect(prepareArchive(db, 'missing', NOW)).rejects.toThrow('找不到遊戲局：missing')
  })

  it('瀏覽器不支援 CompressionStream 時拒絕，什麼都不讀（DATA-22）', async () => {
    const db = testDatabase()
    await addSampleGame(db)
    vi.stubGlobal('CompressionStream', undefined)
    const rejected = { status: 'rejected', reason: { kind: 'compression-unsupported' } }
    expect(await prepareArchive(db, GAME, NOW)).toStrictEqual(rejected)
    expect(await prepareArchive(db, 'missing', NOW)).toStrictEqual(rejected)
  })

  it('讀回驗證不通過時原樣回傳拒絕原因，拿不到準備好的封存（DATA-09）', async () => {
    const db = testDatabase()
    await addSampleGame(db)
    vi.stubGlobal('CompressionStream', TruncatedGzipStream)
    expect(await prepareArchive(db, GAME, NOW)).toStrictEqual({
      status: 'rejected',
      reason: { kind: 'gzip' },
    })
  })
})

describe('archiveGame', () => {
  it('刪除整局、這一局的檢查點與目前遊戲局的指向，寫入索引；其他局不受影響（需求規格 12.3）', async () => {
    const db = testDatabase()
    await addSampleGame(db, { name: '第一局' })
    const other = await addSampleGame(db, { id: 'G2', name: '第二局' })
    await setCurrentGame(db, GAME)
    await db.checkpoints.bulkAdd([checkpointRow('C1'), checkpointRow('C2', { gameId: 'G2' })])
    await db.checkpointContents.bulkAdd([
      { checkpointId: 'C1', gameId: GAME, bytes: new Uint8Array([1]) },
      { checkpointId: 'C2', gameId: 'G2', bytes: new Uint8Array([2]) },
    ])
    const archive = await prepared(db)
    expect(await archiveGame(db, archive, ' 第一局 ')).toStrictEqual({
      status: 'done',
      value: { archive: archive.index, counts: archive.index.counts },
      warnings: [],
    })
    expect(await db.archives.toArray()).toStrictEqual([archive.index])
    expect(await db.games.get(GAME)).toBeUndefined()
    expect(await db.horses.where('gameId').equals(GAME).count()).toBe(0)
    expect(await db.checkpoints.toArray()).toStrictEqual([checkpointRow('C2', { gameId: 'G2' })])
    expect(await db.checkpointContents.count()).toBe(1)
    expect(await currentGameId(db)).toBeUndefined()
    expect(await readGameData(db, 'G2')).toStrictEqual(other)
  })

  it('局名不符時阻止，什麼都不刪（DATA-09）', async () => {
    const db = testDatabase()
    const data = await addSampleGame(db, { name: '第一局' })
    await db.checkpoints.add(checkpointRow('C1'))
    const archive = await prepared(db)
    expect(await archiveGame(db, archive, '第二局')).toStrictEqual({
      status: 'blocked',
      blocks: [{ kind: 'name-mismatch' }],
    })
    expect(await readGameData(db, GAME)).toStrictEqual(data)
    expect(await db.checkpoints.count()).toBe(1)
    expect(await db.archives.count()).toBe(0)
  })

  it('準備之後有寫入操作時阻止，什麼都不刪；重新產生後才能封存（DATA-20）', async () => {
    const db = testDatabase()
    await addSampleGame(db, { name: '第一局' })
    const archive = await prepared(db)
    const later = new Date('2026-09-30T02:00:00.000Z')
    expect((await setCurrentYear(db, GAME, 1991, { now: later })).status).toBe('done')
    const data = await readGameData(db, GAME)
    expect(await archiveGame(db, archive, '第一局')).toStrictEqual({
      status: 'blocked',
      blocks: [{ kind: 'changed-since-archive' }],
    })
    expect(await readGameData(db, GAME)).toStrictEqual(data)
    expect(await db.archives.count()).toBe(0)
    const again = await prepared(db)
    expect((await archiveGame(db, again, '第一局')).status).toBe('done')
    expect((await db.archives.get(GAME))?.currentYear).toBe(1991)
  })

  it('記錄最近備份時間與建立檢查點不改更新時間，不會擋下封存；建立的檢查點隨這一局刪除', async () => {
    const db = testDatabase()
    await addSampleGame(db, { name: '第一局' })
    const archive = await prepared(db)
    await recordBackup(db, GAME, '2026-09-30T03:00:00.000Z')
    await createCheckpoint(db, GAME, {
      origin: 'manual',
      now: new Date('2026-09-30T03:00:00.000Z'),
    })
    expect((await archiveGame(db, archive, '第一局')).status).toBe('done')
    expect(await db.checkpoints.count()).toBe(0)
    expect(await db.checkpointContents.count()).toBe(0)
  })

  it('同一份封存送出兩次時丟出錯誤：遊戲局已不存在', async () => {
    const db = testDatabase()
    await addSampleGame(db, { name: '第一局' })
    const archive = await prepared(db)
    expect((await archiveGame(db, archive, '第一局')).status).toBe('done')
    await expect(archiveGame(db, archive, '第一局')).rejects.toThrow('找不到遊戲局：G')
    expect(await db.archives.count()).toBe(1)
  })
})
