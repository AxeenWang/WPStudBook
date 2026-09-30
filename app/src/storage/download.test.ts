import { afterEach, describe, expect, it, vi } from 'vitest'
import { addTestGame, testDatabase } from '../../tests/support/database'
import { blobBytes, stubDownloads } from '../../tests/support/download'
import { GAME } from '../../tests/support/rows'
import { exportBackup, readBackup } from './backup'
import { createCheckpoint, readCheckpoint, rollbackToCheckpoint } from './checkpoints'
import { REVOKE_DELAY_MS, downloadBackup, downloadFile } from './download'
import { loadGame, setCurrentYear } from './games'

const BYTES = new Uint8Array([0x1f, 0x8b, 1, 2, 3])

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('downloadFile', () => {
  it('建立帶 download 屬性的連結並點擊；gzip 的內容型別是 application/gzip', async () => {
    const downloads = stubDownloads()
    downloadFile('測試.json.gz', BYTES, true)
    expect(downloads).toHaveLength(1)
    const [download] = downloads
    expect(download!.fileName).toBe('測試.json.gz')
    expect(download!.url).toMatch(/^blob:/)
    expect(download!.blob.type).toBe('application/gzip')
    expect(await blobBytes(download!.blob)).toStrictEqual(BYTES)
  })

  it('沒有壓縮時內容型別是 application/json', () => {
    const downloads = stubDownloads()
    downloadFile('測試.json', new TextEncoder().encode('{}'), false)
    expect(downloads[0]!.blob.type).toBe('application/json')
  })

  it('1 分鐘後才釋放網址', () => {
    vi.useFakeTimers()
    const downloads = stubDownloads()
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    downloadFile('測試.json.gz', BYTES, true)
    expect(REVOKE_DELAY_MS).toBe(60_000)
    vi.advanceTimersByTime(REVOKE_DELAY_MS - 1)
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(revoke).toHaveBeenCalledExactlyOnceWith(downloads[0]!.url)
  })

  it('環境沒有 document 時丟出例外', () => {
    vi.stubGlobal('document', undefined)
    expect(() => downloadFile('測試.json.gz', BYTES, true)).toThrow()
  })
})

describe('downloadBackup', () => {
  it('以備份的檔名下載匯出的位元組', async () => {
    const db = testDatabase()
    await addTestGame(db)
    const backup = await exportBackup(db, GAME, new Date('2026-09-30T01:02:03.000Z'))
    const downloads = stubDownloads()
    downloadBackup(backup)
    expect(downloads).toHaveLength(1)
    expect(downloads[0]!.fileName).toBe(backup.fileName)
    expect(downloads[0]!.blob.type).toBe('application/gzip')
    expect(await blobBytes(downloads[0]!.blob)).toStrictEqual(backup.bytes)
  })

  it('可以直接當回溯的交付函式：回溯前下載目前這一局，不記錄最近備份時間', async () => {
    const db = testDatabase()
    await addTestGame(db)
    const created = await createCheckpoint(db, GAME, {
      origin: 'manual',
      now: new Date('2026-09-30T01:00:00.000Z'),
    })
    await setCurrentYear(db, GAME, 1991, { now: new Date('2026-09-30T02:00:00.000Z') })
    const read = await readCheckpoint(db, GAME, created.checkpoint.id)
    if (read.status !== 'ok') throw new Error(read.status)
    const downloads = stubDownloads()
    const result = await rollbackToCheckpoint(db, read.verified, {
      deliverBackup: downloadBackup,
      now: new Date('2026-09-30T03:00:00.000Z'),
    })
    expect(result.status).toBe('done')
    expect(downloads).toHaveLength(1)
    const backup = await readBackup(await blobBytes(downloads[0]!.blob))
    if (backup.status !== 'ok') throw new Error(backup.status)
    expect(backup.backup.file.game.currentYear).toBe(1991)
    const game = await loadGame(db, GAME)
    expect(game.currentYear).toBe(1990)
    expect(game.lastBackupAt).toBeUndefined()
  })
})
