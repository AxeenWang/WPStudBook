import { afterEach, describe, expect, it, vi } from 'vitest'
import { gunzipText } from '../../tests/support/backup'
import { addTestGame, testDatabase } from '../../tests/support/database'
import { blobBytes, stubDownloads } from '../../tests/support/download'
import { fakeFolder } from '../../tests/support/folder'
import { GAME } from '../../tests/support/rows'
import { loadGame } from './games'
import { saveBackup } from './save-backup'

const NOW = new Date('2026-09-30T09:00:00.000Z')
const UPDATED = '2026-09-29T00:00:00.000Z'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** 測試局：舊版本寫的列，更新時間早於匯出時間，還沒備份過 */
async function setup() {
  const db = testDatabase()
  await addTestGame(db, { updatedAt: UPDATED, appVersion: '0.0.0-old' })
  return db
}

/** 備份檔的匯出時間與遊戲局識別 */
async function exportedOf(bytes: Uint8Array<ArrayBuffer>) {
  const file = JSON.parse(await gunzipText(bytes))
  return { exportedAt: file.exportedAt, gameId: file.game.id }
}

describe('saveBackup', () => {
  it('資料夾：以備份檔名寫入匯出的內容，交出後記錄最近備份時間；更新時間與應用版本不變', async () => {
    const db = await setup()
    const downloads = stubDownloads()
    const fake = fakeFolder('備份')
    const saved = await saveBackup(db, GAME, { kind: 'folder', folder: fake.folder }, NOW)
    expect(saved.delivery).toStrictEqual({ kind: 'folder', folderName: '備份' })
    expect(saved.summary.exportedAt).toBe(NOW.toISOString())
    expect([...fake.files.keys()]).toStrictEqual([saved.summary.fileName])
    expect(await exportedOf(fake.files.get(saved.summary.fileName)!)).toStrictEqual({
      exportedAt: NOW.toISOString(),
      gameId: GAME,
    })
    expect(downloads).toHaveLength(0)
    const game = await loadGame(db, GAME)
    expect(game).toMatchObject({
      lastBackupAt: NOW.toISOString(),
      updatedAt: UPDATED,
      appVersion: '0.0.0-old',
    })
    expect(saved.game).toStrictEqual(game)
  })

  it('寫入資料夾失敗時改為下載，回傳 write-failed 與錯誤訊息，仍記錄最近備份時間', async () => {
    const db = await setup()
    const downloads = stubDownloads()
    const fake = fakeFolder('備份', { writeError: new Error('磁碟已滿') })
    const saved = await saveBackup(db, GAME, { kind: 'folder', folder: fake.folder }, NOW)
    expect(saved.delivery).toStrictEqual({
      kind: 'download',
      reason: 'write-failed',
      error: 'Error: 磁碟已滿',
    })
    expect(fake.aborted).toStrictEqual([saved.summary.fileName])
    expect(downloads.map((download) => download.fileName)).toStrictEqual([saved.summary.fileName])
    expect((await loadGame(db, GAME)).lastBackupAt).toBe(NOW.toISOString())
  })

  it('目標是下載時直接下載，交付方式沿用目標的原因', async () => {
    const db = await setup()
    const downloads = stubDownloads()
    const target = { kind: 'download', reason: 'denied', error: 'SecurityError: 拒絕' } as const
    const saved = await saveBackup(db, GAME, target, NOW)
    expect(saved.delivery).toStrictEqual(target)
    expect(downloads).toHaveLength(1)
    expect(downloads[0]!.fileName).toBe(saved.summary.fileName)
    expect(await exportedOf(await blobBytes(downloads[0]!.blob))).toStrictEqual({
      exportedAt: NOW.toISOString(),
      gameId: GAME,
    })
    expect((await loadGame(db, GAME)).lastBackupAt).toBe(NOW.toISOString())
  })

  it('呼叫端自己選擇下載時，交付方式沒有原因', async () => {
    const db = await setup()
    stubDownloads()
    const saved = await saveBackup(db, GAME, { kind: 'download' }, NOW)
    expect(saved.delivery).toStrictEqual({ kind: 'download' })
  })

  it('下載丟出例外時照常丟出，不記錄最近備份時間', async () => {
    const db = await setup()
    vi.stubGlobal('document', undefined)
    await expect(saveBackup(db, GAME, { kind: 'download' }, NOW)).rejects.toThrow()
    expect((await loadGame(db, GAME)).lastBackupAt).toBeUndefined()
  })

  it('遊戲局不存在時丟出錯誤，什麼都不交出', async () => {
    const db = testDatabase()
    const downloads = stubDownloads()
    const fake = fakeFolder()
    const target = { kind: 'folder', folder: fake.folder } as const
    await expect(saveBackup(db, 'missing', target, NOW)).rejects.toThrow('找不到遊戲局：missing')
    expect(fake.files.size).toBe(0)
    expect(downloads).toHaveLength(0)
  })
})
