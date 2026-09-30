import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadBackupFolder } from '../../storage/backup-folder'
import { listGames } from '../../storage/games'
import { testDatabase } from '../../../tests/support/database'
import { stubDownloads } from '../../../tests/support/download'
import { fakeFolder, storeFakeFolder } from '../../../tests/support/folder'
import {
  SIMULATED_WORK_MS,
  checkGame,
  chooseFolderMessage,
  clearFolderMessage,
  delayedDownload,
  describeDelivery,
  simulateAutoBackup,
} from './storage-checks'

const FILE_NAME = /WPStudBook_驗證用_2026年_\d{8}-\d{6}\.json\.gz$/

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('checkGame', () => {
  it('第一次使用時建立驗證用的局，之後沿用', async () => {
    const db = testDatabase()
    const first = await checkGame(db)
    expect(first).toMatchObject({ name: '驗證用', startYear: 2026 })
    expect(await checkGame(db)).toStrictEqual(first)
    expect(await listGames(db)).toHaveLength(1)
  })
})

describe('chooseFolderMessage、clearFolderMessage', () => {
  it('選好、取消、不支援與清除各有訊息', async () => {
    const db = testDatabase()
    vi.stubGlobal('showDirectoryPicker', async () => ({ name: '備份' }))
    expect(await chooseFolderMessage(db)).toBe('已選擇資料夾「備份」')
    vi.stubGlobal('showDirectoryPicker', async () => {
      throw new DOMException('The user aborted a request.', 'AbortError')
    })
    expect(await chooseFolderMessage(db)).toBe('已取消選擇')
    vi.stubGlobal('showDirectoryPicker', undefined)
    expect(await chooseFolderMessage(db)).toBe('此瀏覽器不支援選擇資料夾')
    expect(await clearFolderMessage(db)).toBe('已清除資料夾設定')
    expect(await loadBackupFolder(db)).toBeUndefined()
  })
})

describe('simulateAutoBackup', () => {
  it('先申請權限，再等待模擬的耗時處理，最後寫入資料夾', async () => {
    const db = testDatabase()
    vi.stubGlobal('showDirectoryPicker', async () => ({}))
    const fake = fakeFolder('備份', { query: 'prompt', request: 'granted' })
    storeFakeFolder(db, fake.folder)
    const wait = vi.fn(async () => {})
    const message = await simulateAutoBackup(db, wait)
    // 等待要超過瀏覽器約 5 秒的使用者操作有效期
    expect(SIMULATED_WORK_MS).toBe(6000)
    expect(wait).toHaveBeenCalledExactlyOnceWith(SIMULATED_WORK_MS)
    expect(fake.requestPermission.mock.invocationCallOrder[0]!).toBeLessThan(
      wait.mock.invocationCallOrder[0]!,
    )
    expect(message).toMatch(/^已寫入資料夾「備份」：/)
    expect(message).toMatch(FILE_NAME)
    expect(fake.files.size).toBe(1)
  })

  it('沒有選資料夾時改為下載，訊息附上原因', async () => {
    const db = testDatabase()
    vi.stubGlobal('showDirectoryPicker', async () => ({}))
    const downloads = stubDownloads()
    const message = await simulateAutoBackup(db, async () => {})
    expect(message).toMatch(/^已改為下載（原因：not-set）：/)
    expect(downloads).toHaveLength(1)
    expect(downloads[0]!.fileName).toMatch(FILE_NAME)
  })
})

describe('delayedDownload', () => {
  it('等待之後才下載驗證用的局的備份', async () => {
    const db = testDatabase()
    const downloads = stubDownloads()
    const wait = vi.fn(async () => {
      expect(downloads).toHaveLength(0)
    })
    const message = await delayedDownload(db, wait)
    expect(wait).toHaveBeenCalledExactlyOnceWith(SIMULATED_WORK_MS)
    expect(downloads).toHaveLength(1)
    expect(message).toBe(`已下載：${downloads[0]!.fileName}`)
    expect(downloads[0]!.fileName).toMatch(FILE_NAME)
  })
})

describe('describeDelivery', () => {
  it('寫入資料夾、改為下載（附原因與錯誤訊息）、自己選擇的下載', () => {
    expect(describeDelivery({ kind: 'folder', folderName: '備份' }, 'a.json.gz')).toBe(
      '已寫入資料夾「備份」：a.json.gz',
    )
    expect(
      describeDelivery(
        { kind: 'download', reason: 'denied', error: 'SecurityError: x' },
        'a.json.gz',
      ),
    ).toBe('已改為下載（原因：denied，SecurityError: x）：a.json.gz')
    expect(describeDelivery({ kind: 'download', reason: 'not-set' }, 'a.json.gz')).toBe(
      '已改為下載（原因：not-set）：a.json.gz',
    )
    expect(describeDelivery({ kind: 'download' }, 'a.json.gz')).toBe('已下載：a.json.gz')
  })
})
