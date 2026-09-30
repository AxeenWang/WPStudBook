import { afterEach, describe, expect, it, vi } from 'vitest'
import { addTestGame, testDatabase } from '../../tests/support/database'
import { fakeFolder, storeFakeFolder } from '../../tests/support/folder'
import { GAME } from '../../tests/support/rows'
import {
  chooseBackupFolder,
  clearBackupFolder,
  loadBackupFolder,
  prepareBackupTarget,
  supportsBackupFolder,
  writeBackupFile,
} from './backup-folder'
import { currentGameId, setCurrentGame } from './games'
import type { BackupFolderHandle } from './records'

const BYTES = new Uint8Array([0x1f, 0x8b, 1, 2, 3])
const FILE_NAME = 'WPStudBook_測試局_1990年_20260930-090000.json.gz'

/** 存得進 fake-indexeddb 的資料夾：只有名稱，沒有方法 */
function storableFolder(name: string): BackupFolderHandle {
  return { name } as BackupFolderHandle
}

/** 以 vi.stubGlobal 模擬瀏覽器的 showDirectoryPicker */
function stubPicker(pick: () => Promise<BackupFolderHandle>) {
  const picker = vi.fn(pick)
  vi.stubGlobal('showDirectoryPicker', picker)
  return picker
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('supportsBackupFolder', () => {
  it('瀏覽器有 showDirectoryPicker 才支援', () => {
    vi.stubGlobal('showDirectoryPicker', undefined)
    expect(supportsBackupFolder()).toBe(false)
    stubPicker(async () => storableFolder('備份'))
    expect(supportsBackupFolder()).toBe(true)
  })
})

describe('chooseBackupFolder', () => {
  it('以讀寫模式選擇，選好後存進 meta，取代原本的資料夾', async () => {
    const db = testDatabase()
    const picker = stubPicker(async () => storableFolder('舊的'))
    expect(await chooseBackupFolder(db)).toStrictEqual({ status: 'chosen', folderName: '舊的' })
    expect(picker).toHaveBeenCalledExactlyOnceWith({ mode: 'readwrite' })
    stubPicker(async () => storableFolder('新的'))
    expect(await chooseBackupFolder(db)).toStrictEqual({ status: 'chosen', folderName: '新的' })
    expect(await loadBackupFolder(db)).toStrictEqual(storableFolder('新的'))
  })

  it('使用者取消時什麼都不改', async () => {
    const db = testDatabase()
    stubPicker(async () => storableFolder('備份'))
    await chooseBackupFolder(db)
    stubPicker(async () => {
      throw new DOMException('The user aborted a request.', 'AbortError')
    })
    expect(await chooseBackupFolder(db)).toStrictEqual({ status: 'cancelled' })
    expect(await loadBackupFolder(db)).toStrictEqual(storableFolder('備份'))
  })

  it('取消以外的錯誤照常丟出，不存入', async () => {
    const db = testDatabase()
    stubPicker(async () => {
      throw new DOMException('Must be handling a user gesture.', 'SecurityError')
    })
    await expect(chooseBackupFolder(db)).rejects.toThrow('Must be handling a user gesture.')
    expect(await loadBackupFolder(db)).toBeUndefined()
  })

  it('瀏覽器不支援時回傳不支援', async () => {
    const db = testDatabase()
    vi.stubGlobal('showDirectoryPicker', undefined)
    expect(await chooseBackupFolder(db)).toStrictEqual({ status: 'unsupported' })
    expect(await loadBackupFolder(db)).toBeUndefined()
  })
})

describe('loadBackupFolder、clearBackupFolder', () => {
  it('沒選過時為 undefined；清除後為 undefined，meta 的目前遊戲局不受影響', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await setCurrentGame(db, GAME)
    expect(await loadBackupFolder(db)).toBeUndefined()
    stubPicker(async () => storableFolder('備份'))
    await chooseBackupFolder(db)
    await clearBackupFolder(db)
    expect(await loadBackupFolder(db)).toBeUndefined()
    expect(await currentGameId(db)).toBe(GAME)
  })
})

describe('prepareBackupTarget', () => {
  it('瀏覽器不支援時改為下載（unsupported），不查權限', async () => {
    const db = testDatabase()
    vi.stubGlobal('showDirectoryPicker', undefined)
    const fake = fakeFolder()
    storeFakeFolder(db, fake.folder)
    expect(await prepareBackupTarget(db)).toStrictEqual({ kind: 'download', reason: 'unsupported' })
    expect(fake.queryPermission).not.toHaveBeenCalled()
  })

  it('沒有選資料夾時改為下載（not-set）', async () => {
    const db = testDatabase()
    stubPicker(async () => storableFolder('備份'))
    expect(await prepareBackupTarget(db)).toStrictEqual({ kind: 'download', reason: 'not-set' })
  })

  it('已授權時寫入資料夾，不再申請', async () => {
    const db = testDatabase()
    stubPicker(async () => storableFolder('備份'))
    const fake = fakeFolder()
    storeFakeFolder(db, fake.folder)
    expect(await prepareBackupTarget(db)).toStrictEqual({ kind: 'folder', folder: fake.folder })
    expect(fake.queryPermission).toHaveBeenCalledExactlyOnceWith({ mode: 'readwrite' })
    expect(fake.requestPermission).not.toHaveBeenCalled()
  })

  it('還沒授權時申請，允許後寫入資料夾', async () => {
    const db = testDatabase()
    stubPicker(async () => storableFolder('備份'))
    const fake = fakeFolder('備份', { query: 'prompt', request: 'granted' })
    storeFakeFolder(db, fake.folder)
    expect(await prepareBackupTarget(db)).toStrictEqual({ kind: 'folder', folder: fake.folder })
    expect(fake.requestPermission).toHaveBeenCalledExactlyOnceWith({ mode: 'readwrite' })
  })

  it('申請被拒絕時改為下載（denied）', async () => {
    const db = testDatabase()
    stubPicker(async () => storableFolder('備份'))
    storeFakeFolder(db, fakeFolder('備份', { query: 'prompt', request: 'denied' }).folder)
    expect(await prepareBackupTarget(db)).toStrictEqual({ kind: 'download', reason: 'denied' })
  })

  it('申請或查詢權限丟出例外時改為下載（denied），附上錯誤訊息，不丟出', async () => {
    const db = testDatabase()
    stubPicker(async () => storableFolder('備份'))
    const activation = new DOMException(
      'User activation is required to request permissions.',
      'SecurityError',
    )
    storeFakeFolder(db, fakeFolder('備份', { query: 'prompt', request: activation }).folder)
    expect(await prepareBackupTarget(db)).toStrictEqual({
      kind: 'download',
      reason: 'denied',
      error: 'SecurityError: User activation is required to request permissions.',
    })

    vi.restoreAllMocks()
    const fake = fakeFolder('備份', { query: new Error('查詢失敗') })
    storeFakeFolder(db, fake.folder)
    expect(await prepareBackupTarget(db)).toStrictEqual({
      kind: 'download',
      reason: 'denied',
      error: 'Error: 查詢失敗',
    })
    expect(fake.requestPermission).not.toHaveBeenCalled()
  })
})

describe('writeBackupFile', () => {
  it('以檔名建立檔案，寫入位元組後關閉', async () => {
    const fake = fakeFolder()
    await writeBackupFile(fake.folder, FILE_NAME, BYTES)
    expect([...fake.files]).toStrictEqual([[FILE_NAME, BYTES]])
    expect(fake.aborted).toStrictEqual([])
  })

  it('寫入失敗時 abort，不留下檔案，再把錯誤丟出', async () => {
    const fake = fakeFolder('備份', { writeError: new Error('磁碟已滿') })
    await expect(writeBackupFile(fake.folder, FILE_NAME, BYTES)).rejects.toThrow('磁碟已滿')
    expect(fake.aborted).toStrictEqual([FILE_NAME])
    expect(fake.files.size).toBe(0)
  })

  it('abort 也失敗時，丟出的仍是原本的錯誤', async () => {
    const fake = fakeFolder('備份', {
      writeError: new Error('磁碟已滿'),
      abortError: new Error('串流已關閉'),
    })
    await expect(writeBackupFile(fake.folder, FILE_NAME, BYTES)).rejects.toThrow('磁碟已滿')
  })

  it('資料夾不見時丟出錯誤', async () => {
    const fake = fakeFolder()
    const missing: BackupFolderHandle = {
      ...fake.folder,
      getFileHandle: async () => {
        throw new DOMException('A requested file or directory could not be found.', 'NotFoundError')
      },
    }
    await expect(writeBackupFile(missing, FILE_NAME, BYTES)).rejects.toThrow('could not be found')
  })
})
