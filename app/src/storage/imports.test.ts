import { afterEach, describe, expect, it, vi } from 'vitest'
import { addTestGame, testDatabase } from '../../tests/support/database'
import { stubDownloads } from '../../tests/support/download'
import { fakeFolder, storeFakeFolder } from '../../tests/support/folder'
import { importRecord } from '../../tests/support/imports'
import { GAME, checkpointRow } from '../../tests/support/rows'
import type { ImportPlan } from '../core/imports'
import { listCheckpoints } from './checkpoints'
import { loadGame } from './games'
import { applyImport, loadImportSnapshot } from './imports'
import { APP_VERSION } from './version'

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

describe('applyImport', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const NOW = new Date('2026-10-01T03:00:00.000Z')

  /** 1990 年五月繁殖圈名單的計畫；預覽時的更新時間是 addTestGame 的預設值 */
  function plan(fields: Partial<ImportPlan> = {}): ImportPlan {
    return {
      gameId: GAME,
      expectedUpdatedAt: '2026-09-24T00:00:00.000Z',
      type: 'may-herd',
      year: 1990,
      timing: { month: 5, week: 1 },
      fileName: '1990年 5月1週_繁殖牝馬.txt',
      sha256: 'abc',
      mode: 'normal',
      summary: { total: 2, applied: 0, skipped: 2 },
      items: [],
      ...fields,
    }
  }

  it('寫入匯入紀錄，遊戲局的更新時間與應用版本跟著更新；選用匯入不申請權限、不建檢查點、不備份', async () => {
    const db = testDatabase()
    await addTestGame(db, { appVersion: '0.0.0-old' })
    vi.stubGlobal('showDirectoryPicker', async () => ({}))
    const folder = fakeFolder()
    storeFakeFolder(db, folder.folder)
    const downloads = stubDownloads()
    const october = plan({
      type: 'october-mares',
      timing: { month: 10, week: 1 },
      fileName: '1990年10月1週_繁殖牝馬.txt',
    })
    const result = await applyImport(db, october, { now: NOW })
    if (result.status !== 'done') throw new Error(result.status)
    const { record } = result.value
    expect(result.value).toStrictEqual({ record })
    expect(record).toStrictEqual({
      id: record.id,
      gameId: GAME,
      type: 'october-mares',
      year: 1990,
      timing: { month: 10, week: 1 },
      fileName: '1990年10月1週_繁殖牝馬.txt',
      sha256: 'abc',
      appliedAt: NOW.toISOString(),
      mode: 'normal',
      summary: { total: 2, applied: 0, skipped: 2 },
    })
    expect(await db.imports.toArray()).toStrictEqual([record])
    expect(await loadGame(db, GAME)).toMatchObject({
      currentYear: 1990,
      updatedAt: NOW.toISOString(),
      appVersion: APP_VERSION,
    })
    expect(folder.queryPermission).not.toHaveBeenCalled()
    expect(await listCheckpoints(db, GAME)).toEqual([])
    expect(downloads).toHaveLength(0)
    expect(folder.files.size).toBe(0)
  })

  it('年度匯入：先申請備份權限再開交易；提交後先建立檢查點（時點是目前進度），再自動備份', async () => {
    const db = testDatabase()
    await addTestGame(db)
    vi.stubGlobal('showDirectoryPicker', async () => ({}))
    const folder = fakeFolder('備份', { query: 'prompt' })
    storeFakeFolder(db, folder.folder)
    const read = vi.spyOn(db.games, 'get')
    const addCheckpoint = vi.spyOn(db.checkpoints, 'add')
    const writeFile = vi.spyOn(folder.folder, 'getFileHandle')
    const result = await applyImport(db, plan(), { now: NOW })
    if (result.status !== 'done') throw new Error(result.status)
    const { record, checkpoint, backup } = result.value
    expect(record).toMatchObject({ type: 'may-herd', mode: 'normal' })
    if (checkpoint?.status !== 'done' || backup?.status !== 'done') throw new Error('沒有完成')
    expect(checkpoint.value.checkpoint).toMatchObject({
      origin: 'auto',
      year: 1990,
      timing: { month: 5, week: 1 },
      createdAt: NOW.toISOString(),
    })
    expect(checkpoint.value.checkpoint).not.toHaveProperty('catchUp')
    expect(backup.value.delivery).toStrictEqual({ kind: 'folder', folderName: '備份' })
    expect(folder.files.has(backup.value.summary.fileName)).toBe(true)
    expect((await loadGame(db, GAME)).lastBackupAt).toBe(NOW.toISOString())
    // 點擊後的第一個 await 就申請權限（技術設計第 7 節）；檢查點在備份之前
    const order = (spy: { mock: { invocationCallOrder: number[] } }) =>
      spy.mock.invocationCallOrder[0]!
    expect(order(folder.requestPermission)).toBeLessThan(order(read))
    expect(order(addCheckpoint)).toBeLessThan(order(writeFile))
  })

  it('CKPT-08 直接補匯：檢查點記目前進度，另記補匯的年與時點；資料更正記被更正的那一筆，進度不變', async () => {
    const db = testDatabase()
    await addTestGame(db)
    stubDownloads()
    await db.imports.bulkAdd([
      importRecord('J90', 'january-two-year-olds', 1990),
      importRecord('M90', 'may-herd', 1990),
      // 別局的進度較晚，不影響這一局
      importRecord('L91', 'july-conception', 1991, { gameId: 'G2' }),
    ])
    const april = plan({
      type: 'april-foals',
      timing: { month: 4, week: 1 },
      fileName: '1990年 4月1週_幼駒誕生.txt',
      mode: 'catch-up',
    })
    const caughtUp = await applyImport(db, april, { now: NOW })
    if (caughtUp.status !== 'done' || caughtUp.value.checkpoint?.status !== 'done') {
      throw new Error('沒有完成')
    }
    expect(caughtUp.value.record.mode).toBe('catch-up')
    expect(caughtUp.value.checkpoint.value.checkpoint).toMatchObject({
      timing: { month: 5, week: 1 },
      catchUp: { year: 1990, timing: { month: 4, week: 1 } },
    })

    const later = new Date('2026-10-01T04:00:00.000Z')
    const january = plan({
      type: 'january-two-year-olds',
      expectedUpdatedAt: NOW.toISOString(),
      timing: { month: 1, week: 1 },
      mode: 'correction',
      corrects: 'J90',
    })
    const corrected = await applyImport(db, january, { now: later })
    if (corrected.status !== 'done' || corrected.value.checkpoint?.status !== 'done') {
      throw new Error('沒有完成')
    }
    expect(corrected.value.record).toMatchObject({ mode: 'correction', corrects: 'J90' })
    const { checkpoint } = corrected.value.checkpoint.value
    expect(checkpoint.timing).toStrictEqual({ month: 5, week: 1 })
    expect(checkpoint).not.toHaveProperty('catchUp')
  })

  it('推進年份與寫入紀錄在同一個交易：確認的警告記在紀錄上；寫入紀錄失敗時推進的年份也回復', async () => {
    const db = testDatabase()
    await addTestGame(db)
    stubDownloads()
    const warnings = [{ kind: 'year-far-ahead' as const, from: 1990, to: 1992 }]
    const ahead = plan({ year: 1992, advanceYear: 1992, confirmedWarnings: warnings })
    const result = await applyImport(db, ahead, { now: NOW })
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value.record.confirmedWarnings).toStrictEqual(warnings)
    expect((await loadGame(db, GAME)).currentYear).toBe(1992)

    const failing = testDatabase()
    const game = await addTestGame(failing)
    vi.spyOn(failing.imports, 'add').mockRejectedValue(new Error('寫入失敗'))
    await expect(applyImport(failing, ahead, { now: NOW })).rejects.toThrow('寫入失敗')
    expect(await loadGame(failing, GAME)).toStrictEqual(game)
    expect(await listCheckpoints(failing, GAME)).toEqual([])
  })

  it('預覽之後遊戲局有變更時回傳 changed-since-preview，什麼都不寫，也不建檢查點、不備份', async () => {
    const db = testDatabase()
    const game = await addTestGame(db, { updatedAt: '2026-09-30T00:00:00.000Z' })
    const downloads = stubDownloads()
    expect(await applyImport(db, plan({ advanceYear: 1991 }), { now: NOW })).toStrictEqual({
      status: 'blocked',
      blocks: [{ kind: 'changed-since-preview' }],
    })
    expect(await loadGame(db, GAME)).toStrictEqual(game)
    expect(await db.imports.count()).toBe(0)
    expect(await listCheckpoints(db, GAME)).toEqual([])
    expect(downloads).toHaveLength(0)
  })

  it('檢查點或自動備份失敗時不撤銷匯入，結果附上錯誤訊息；檢查點失敗也照樣備份', async () => {
    const db = testDatabase()
    await addTestGame(db)
    const downloads = stubDownloads()
    vi.spyOn(db.checkpoints, 'add').mockRejectedValue(new Error('空間不足'))
    const result = await applyImport(db, plan(), { now: NOW })
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value.checkpoint).toStrictEqual({
      status: 'failed',
      error: expect.stringContaining('空間不足'),
    })
    expect(result.value.backup?.status).toBe('done')
    expect(downloads).toHaveLength(1)
    expect(await db.imports.count()).toBe(1)

    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    const offline = testDatabase()
    await addTestGame(offline)
    // 沒有 document 時下載丟出例外
    const failed = await applyImport(offline, plan(), { now: NOW })
    if (failed.status !== 'done') throw new Error(failed.status)
    expect(failed.value.checkpoint?.status).toBe('done')
    expect(failed.value.backup).toStrictEqual({
      status: 'failed',
      error: expect.stringContaining('document'),
    })
    expect(await offline.imports.count()).toBe(1)
    expect((await loadGame(offline, GAME)).lastBackupAt).toBeUndefined()
  })

  it('遊戲局不存在時丟出錯誤', async () => {
    await expect(applyImport(testDatabase(), plan())).rejects.toThrow('找不到遊戲局：G')
  })
})
