import { describe, expect, it } from 'vitest'
import { gunzipText } from '../../tests/support/backup'
import { addTestGame, testDatabase } from '../../tests/support/database'
import { addSampleGame } from '../../tests/support/game-data'
import { GAME, horseRow } from '../../tests/support/rows'
import { readBackup, type ExportedBackup } from './backup'
import {
  createCheckpoint,
  listCheckpoints,
  readCheckpoint,
  rollbackToCheckpoint,
  setCheckpointPinned,
  updateCheckpointNote,
  type NewCheckpoint,
  type VerifiedCheckpoint,
} from './checkpoints'
import type { WPStudBookDatabase } from './database'
import { readGameData, type GameData, type RowCounts } from './game-data'
import { loadGame, setCurrentYear } from './games'
import type { EventRow } from './records'
import { addSystem } from './system-writes'
import { APP_VERSION } from './version'

/** 2026-09-29 00:0n（UTC）：建立時間依 n 遞增 */
function minute(n: number): Date {
  return new Date(Date.UTC(2026, 8, 29, 0, n))
}

/** addSampleGame 一局的各表筆數：horses 3 列，其他每張表 1 列 */
const SAMPLE_COUNTS: RowCounts = {
  games: 1,
  settings: 1,
  horses: 3,
  lines: 1,
  systems: 1,
  mares: 1,
  mareYears: 1,
  stallions: 1,
  restorations: 1,
  breedings: 1,
  matingRatings: 1,
  events: 1,
  horseNumbers: 1,
  imports: 1,
}

/** 讀取並驗證這一局的檢查點；不通過時讓測試失敗 */
async function verifiedOf(
  db: WPStudBookDatabase,
  checkpointId: string,
): Promise<VerifiedCheckpoint> {
  const result = await readCheckpoint(db, GAME, checkpointId)
  if (result.status !== 'ok') throw new Error(result.status)
  return result.verified
}

/** 回溯的交付函式：收下備份，不下載 */
function collector() {
  const delivered: ExportedBackup[] = []
  const deliverBackup = (backup: ExportedBackup) => {
    delivered.push(backup)
  }
  return { delivered, deliverBackup }
}

/** 檢查點之後寫入的事件：識別與寫入時間由參數決定 */
function laterEvent(id: string, recordedAt: string): EventRow {
  return {
    id,
    gameId: GAME,
    year: 1991,
    recordedAt,
    source: { kind: 'manual' },
    kind: 'foal-added',
    horseId: 'G-X',
    breedingId: 'G-B',
    disposition: 'for-sale',
  }
}

describe('createCheckpoint', () => {
  it('記下建立方式、年、時點、建立時間與雜湊；內容是這一局的備份檔（CKPT-01）', async () => {
    const db = testDatabase()
    const data = await addSampleGame(db, { currentYear: 1991 })
    const { checkpoint, removed } = await createCheckpoint(db, GAME, {
      origin: 'auto',
      timing: { month: 5, week: 1 },
      now: minute(1),
    })
    expect(checkpoint).toStrictEqual({
      id: checkpoint.id,
      gameId: GAME,
      origin: 'auto',
      year: 1991,
      timing: { month: 5, week: 1 },
      createdAt: '2026-09-29T00:01:00.000Z',
      sha256: checkpoint.sha256,
      pinned: false,
    })
    expect(removed).toEqual([])
    expect(await db.checkpoints.get(checkpoint.id)).toStrictEqual(checkpoint)
    const content = await db.checkpointContents.get(checkpoint.id)
    expect(content?.gameId).toBe(GAME)
    const file = JSON.parse(await gunzipText(content!.bytes))
    expect(file.sha256).toBe(checkpoint.sha256)
    expect(file.exportedAt).toBe('2026-09-29T00:01:00.000Z')
    expect(file.collections).toStrictEqual(data)
    expect((await readBackup(content!.bytes)).status).toBe('ok')
  })

  it('手動建立可以加註，去除前後空白；空白的註記不存（CKPT-02）', async () => {
    const db = testDatabase()
    await addTestGame(db)
    const { checkpoint } = await createCheckpoint(db, GAME, {
      origin: 'manual',
      note: '  存檔 3  ',
      now: minute(1),
    })
    expect(checkpoint.origin).toBe('manual')
    expect(checkpoint.note).toBe('存檔 3')
    expect(checkpoint).not.toHaveProperty('timing')
    const blank = await createCheckpoint(db, GAME, {
      origin: 'manual',
      note: '   ',
      now: minute(2),
    })
    expect(blank.checkpoint).not.toHaveProperty('note')
    expect(await db.checkpoints.get(blank.checkpoint.id)).not.toHaveProperty('note')
  })

  it('直接補匯：時點是目前進度，另記補匯的年與時點（CKPT-08）', async () => {
    const db = testDatabase()
    await addTestGame(db)
    const { checkpoint } = await createCheckpoint(db, GAME, {
      origin: 'auto',
      timing: { month: 7, week: 1 },
      catchUp: { year: 1989, timing: { month: 4, week: 1 } },
      now: minute(1),
    })
    expect(checkpoint.timing).toStrictEqual({ month: 7, week: 1 })
    expect(checkpoint.catchUp).toStrictEqual({ year: 1989, timing: { month: 4, week: 1 } })
    expect(await db.checkpoints.get(checkpoint.id)).toStrictEqual(checkpoint)
  })

  it('時點或補匯的年不合法時丟出 RangeError，什麼都不寫', async () => {
    const db = testDatabase()
    await addTestGame(db)
    const inputs: NewCheckpoint[] = [
      { origin: 'auto', timing: { month: 13, week: 1 } },
      { origin: 'auto', timing: { month: 5, week: 0 } },
      { origin: 'auto', catchUp: { year: 1989.5, timing: { month: 4, week: 1 } } },
      { origin: 'auto', catchUp: { year: 1989, timing: { month: 4, week: 5 } } },
    ]
    for (const input of inputs) {
      await expect(createCheckpoint(db, GAME, input)).rejects.toThrow(RangeError)
    }
    expect(await db.checkpoints.count()).toBe(0)
    expect(await db.checkpointContents.count()).toBe(0)
  })

  it('不改遊戲局的更新時間與應用版本；遊戲局不存在時丟出錯誤', async () => {
    const db = testDatabase()
    const game = await addTestGame(db, { appVersion: '0.0.0-old' })
    await createCheckpoint(db, GAME, { origin: 'manual', now: minute(1) })
    expect(await loadGame(db, GAME)).toStrictEqual(game)
    await expect(createCheckpoint(db, 'missing', { origin: 'manual' })).rejects.toThrow(
      '找不到遊戲局：missing',
    )
  })
})

describe('createCheckpoint：保留個數（需求規格 12.4）', () => {
  it('未釘選的超過保留個數時，連同內容清除最舊的，回傳被清除的（CKPT-03）', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.settings.update(GAME, { checkpointLimit: 2 })
    const first = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(1) })
    const second = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(2) })
    expect(second.removed).toEqual([])
    const third = await createCheckpoint(db, GAME, { origin: 'manual', now: minute(3) })
    expect(third.removed).toStrictEqual([first.checkpoint])
    expect((await listCheckpoints(db, GAME)).map((row) => row.id)).toEqual([
      third.checkpoint.id,
      second.checkpoint.id,
    ])
    expect(await db.checkpointContents.get(first.checkpoint.id)).toBeUndefined()
    expect(await db.checkpointContents.count()).toBe(2)
  })

  it('釘選的不計入保留個數，也不清除', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.settings.update(GAME, { checkpointLimit: 1 })
    const pinned = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(1) })
    await db.checkpoints.update(pinned.checkpoint.id, { pinned: true })
    const second = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(2) })
    expect(second.removed).toEqual([])
    const third = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(3) })
    expect(third.removed.map((row) => row.id)).toEqual([second.checkpoint.id])
    expect((await listCheckpoints(db, GAME)).map((row) => row.id)).toEqual([
      third.checkpoint.id,
      pinned.checkpoint.id,
    ])
  })

  it('只清這一局的檢查點', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await addTestGame(db, { id: 'G2' })
    await db.settings.update(GAME, { checkpointLimit: 1 })
    const other = await createCheckpoint(db, 'G2', { origin: 'auto', now: minute(1) })
    await createCheckpoint(db, GAME, { origin: 'auto', now: minute(2) })
    await createCheckpoint(db, GAME, { origin: 'auto', now: minute(3) })
    expect(await db.checkpoints.get(other.checkpoint.id)).toStrictEqual(other.checkpoint)
    expect(await db.checkpointContents.get(other.checkpoint.id)).toBeDefined()
  })

  it('剛建立的一定留著：系統時鐘往回調時也不會被自己清掉', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await db.settings.update(GAME, { checkpointLimit: 2 })
    const first = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(5) })
    const second = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(6) })
    // 時鐘往回調：新的建立時間比既有的都早
    const third = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(1) })
    expect(third.removed).toStrictEqual([first.checkpoint])
    expect((await listCheckpoints(db, GAME)).map((row) => row.id)).toEqual([
      second.checkpoint.id,
      third.checkpoint.id,
    ])
    expect(await db.checkpointContents.get(third.checkpoint.id)).toBeDefined()
  })
})

describe('listCheckpoints', () => {
  it('只列這一局，依建立時間由新到舊；遊戲局不存在時丟出錯誤', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await addTestGame(db, { id: 'G2' })
    const middle = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(2) })
    const oldest = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(1) })
    const newest = await createCheckpoint(db, GAME, { origin: 'manual', now: minute(3) })
    await createCheckpoint(db, 'G2', { origin: 'auto', now: minute(4) })
    expect(await listCheckpoints(db, GAME)).toStrictEqual([
      newest.checkpoint,
      middle.checkpoint,
      oldest.checkpoint,
    ])
    await expect(listCheckpoints(db, 'missing')).rejects.toThrow('找不到遊戲局：missing')
  })
})

describe('setCheckpointPinned', () => {
  it('釘選與取消釘選；不觸發清除，也不改遊戲局', async () => {
    const db = testDatabase()
    const game = await addTestGame(db, { appVersion: '0.0.0-old' })
    await db.settings.update(GAME, { checkpointLimit: 1 })
    const first = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(1) })
    const pinned = await setCheckpointPinned(db, GAME, first.checkpoint.id, true)
    expect(pinned).toStrictEqual({ ...first.checkpoint, pinned: true })
    expect(await db.checkpoints.get(first.checkpoint.id)).toStrictEqual(pinned)
    const second = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(2) })
    expect(second.removed).toEqual([])
    const unpinned = await setCheckpointPinned(db, GAME, first.checkpoint.id, false)
    expect(unpinned).toStrictEqual(first.checkpoint)
    expect(await db.checkpoints.get(first.checkpoint.id)).toStrictEqual(first.checkpoint)
    expect(await listCheckpoints(db, GAME)).toHaveLength(2)
    expect(await loadGame(db, GAME)).toStrictEqual(game)
  })
})

describe('updateCheckpointNote', () => {
  it('去除前後空白後取代註記，空白時移除；不改遊戲局', async () => {
    const db = testDatabase()
    const game = await addTestGame(db, { appVersion: '0.0.0-old' })
    const { checkpoint } = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(1) })
    const first = await updateCheckpointNote(db, GAME, checkpoint.id, '存檔 1')
    expect(first).toStrictEqual({ ...checkpoint, note: '存檔 1' })
    const noted = await updateCheckpointNote(db, GAME, checkpoint.id, '  存檔 5  ')
    expect(noted).toStrictEqual({ ...checkpoint, note: '存檔 5' })
    expect(await db.checkpoints.get(checkpoint.id)).toStrictEqual(noted)
    const cleared = await updateCheckpointNote(db, GAME, checkpoint.id, '  ')
    expect(cleared).toStrictEqual(checkpoint)
    expect(await db.checkpoints.get(checkpoint.id)).toStrictEqual(checkpoint)
    expect(await loadGame(db, GAME)).toStrictEqual(game)
  })
})

describe('檢查點的管理：找不到時', () => {
  it('找不到遊戲局、檢查點，或檢查點屬於其他局時丟出錯誤，什麼都不改', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await addTestGame(db, { id: 'G2' })
    const { checkpoint } = await createCheckpoint(db, 'G2', { origin: 'auto', now: minute(1) })
    const message = `找不到這一局的檢查點：${checkpoint.id}`
    await expect(setCheckpointPinned(db, GAME, checkpoint.id, true)).rejects.toThrow(message)
    await expect(updateCheckpointNote(db, GAME, checkpoint.id, '註記')).rejects.toThrow(message)
    await expect(setCheckpointPinned(db, GAME, 'missing', true)).rejects.toThrow(
      '找不到這一局的檢查點：missing',
    )
    await expect(setCheckpointPinned(db, 'missing', checkpoint.id, true)).rejects.toThrow(
      '找不到遊戲局：missing',
    )
    expect(await db.checkpoints.get(checkpoint.id)).toStrictEqual(checkpoint)
  })
})

describe('readCheckpoint', () => {
  it('通過時回傳檢查點的資料與預覽：遊戲年、筆數對照、捨棄的事件與較晚的檢查點（CKPT-04）', async () => {
    const db = testDatabase()
    const data = await addSampleGame(db)
    await createCheckpoint(db, GAME, { origin: 'auto', now: minute(0) })
    const target = await createCheckpoint(db, GAME, {
      origin: 'auto',
      timing: { month: 5, week: 1 },
      now: minute(1),
    })
    await db.games.update(GAME, { currentYear: 1991, updatedAt: '2026-09-29T00:02:00.000Z' })
    await db.horses.add(horseRow('G-X', { birthYear: 1991 }))
    const e1 = laterEvent('E1', '2026-09-29T00:03:00.000Z')
    const e2 = laterEvent('E2', '2026-09-29T00:02:00.000Z')
    await db.events.bulkAdd([e1, e2])
    const pinned = await createCheckpoint(db, GAME, { origin: 'manual', now: minute(4) })
    await setCheckpointPinned(db, GAME, pinned.checkpoint.id, true)
    const latest = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(5) })
    const before = await readGameData(db, GAME)

    const result = await readCheckpoint(db, GAME, target.checkpoint.id)
    if (result.status !== 'ok') throw new Error(result.status)
    expect(result.verified.data).toStrictEqual(data)
    expect(result.verified.preview).toStrictEqual({
      checkpoint: target.checkpoint,
      currentYear: { from: 1991, to: 1990 },
      counts: {
        current: { ...SAMPLE_COUNTS, horses: 4, events: 3 },
        checkpoint: SAMPLE_COUNTS,
      },
      discardedEvents: [e2, e1],
      removedCheckpoints: [latest.checkpoint, { ...pinned.checkpoint, pinned: true }],
      updatedAt: '2026-09-29T00:02:00.000Z',
    })
    expect(await readGameData(db, GAME)).toStrictEqual(before)
    expect(await listCheckpoints(db, GAME)).toHaveLength(4)
  })

  it('內容不見、內容對不上或檔案不通過時回傳拒絕原因，資料不變（CKPT-05）', async () => {
    const db = testDatabase()
    await addSampleGame(db)
    await addSampleGame(db, { id: 'G2' })
    const a = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(1) })
    await db.games.update(GAME, { currentYear: 1991 })
    const b = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(2) })
    const other = await createCheckpoint(db, 'G2', { origin: 'auto', now: minute(3) })
    const before = await readGameData(db, GAME)
    const reasonOf = async (id: string) => {
      const result = await readCheckpoint(db, GAME, id)
      return result.status === 'rejected' ? result.reason : undefined
    }
    const bytesOf = async (id: string) => (await db.checkpointContents.get(id))!.bytes

    // 內容換成同一局另一個檢查點的：sha256 不符
    await db.checkpointContents.update(a.checkpoint.id, { bytes: await bytesOf(b.checkpoint.id) })
    expect(await reasonOf(a.checkpoint.id)).toEqual({ kind: 'content-mismatch' })
    // 內容換成其他局的，列上的 sha256 也跟著換：遊戲局識別不符
    await db.checkpointContents.update(b.checkpoint.id, {
      bytes: await bytesOf(other.checkpoint.id),
    })
    await db.checkpoints.update(b.checkpoint.id, { sha256: other.checkpoint.sha256 })
    expect(await reasonOf(b.checkpoint.id)).toEqual({ kind: 'content-mismatch' })
    // 檔案截斷：備份的拒絕原因
    await db.checkpointContents.update(a.checkpoint.id, {
      bytes: (await bytesOf(other.checkpoint.id)).slice(0, 20),
    })
    expect(await reasonOf(a.checkpoint.id)).toEqual({ kind: 'gzip' })
    // 內容不見
    await db.checkpointContents.delete(a.checkpoint.id)
    expect(await reasonOf(a.checkpoint.id)).toEqual({ kind: 'content-missing' })

    expect(await readGameData(db, GAME)).toStrictEqual(before)
  })

  it('找不到遊戲局、檢查點，或檢查點屬於其他局時丟出錯誤', async () => {
    const db = testDatabase()
    await addTestGame(db)
    await addTestGame(db, { id: 'G2' })
    const { checkpoint } = await createCheckpoint(db, 'G2', { origin: 'auto', now: minute(1) })
    await expect(readCheckpoint(db, GAME, checkpoint.id)).rejects.toThrow(
      `找不到這一局的檢查點：${checkpoint.id}`,
    )
    await expect(readCheckpoint(db, GAME, 'missing')).rejects.toThrow(
      '找不到這一局的檢查點：missing',
    )
    await expect(readCheckpoint(db, 'missing', checkpoint.id)).rejects.toThrow(
      '找不到遊戲局：missing',
    )
  })
})

describe('rollbackToCheckpoint', () => {
  it('整局回到檢查點，識別不變；目前遊戲年取檢查點，games 其他欄位與設定沿用目前的值（CKPT-06）', async () => {
    const db = testDatabase()
    const data = await addSampleGame(db)
    const { checkpoint } = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(1) })
    await setCurrentYear(db, GAME, 1991, { now: minute(2) })
    const system = { subsystem: 'ヘイルトゥリーズン', parentSystem: 'ターントゥ' }
    await addSystem(db, GAME, system, { now: minute(3) })
    await db.settings.update(GAME, { retirementAge: 24 })
    // 目前的列：舊版本寫的，局名、建立時間、最近備份時間與還原來源都和檢查點不同
    const restoredFrom = {
      fileName: 'WPStudBook_原局_1990年_20260920-000000.json.gz',
      exportedAt: '2026-09-20T00:00:00.000Z',
      gameName: '原局',
      appVersion: '0.0.1',
      schemaVersion: 1,
    }
    await db.games.update(GAME, {
      name: '改名的局',
      createdAt: '2026-09-25T00:00:00.000Z',
      appVersion: '0.0.0-old',
      lastBackupAt: '2026-09-29T00:03:30.000Z',
      restoredFrom,
    })
    const verified = await verifiedOf(db, checkpoint.id)
    const { deliverBackup } = collector()

    const result = await rollbackToCheckpoint(db, verified, { deliverBackup, now: minute(9) })
    const game = {
      ...data.games[0]!,
      name: '改名的局',
      createdAt: '2026-09-25T00:00:00.000Z',
      updatedAt: '2026-09-29T00:09:00.000Z',
      appVersion: APP_VERSION,
      lastBackupAt: '2026-09-29T00:03:30.000Z',
      restoredFrom,
    }
    expect(result).toStrictEqual({ status: 'done', value: { game, removed: [] }, warnings: [] })
    expect(await readGameData(db, GAME)).toStrictEqual({
      ...data,
      games: [game],
      settings: [{ ...data.settings[0]!, retirementAge: 24 }],
    })
  })

  it('先交出目前這一局的備份，內容是回溯前的資料；不記錄最近備份時間（CKPT-04）', async () => {
    const db = testDatabase()
    await addSampleGame(db)
    const { checkpoint } = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(1) })
    await setCurrentYear(db, GAME, 1991, { now: minute(2) })
    const before = await readGameData(db, GAME)
    const verified = await verifiedOf(db, checkpoint.id)
    const delivered: { backup: ExportedBackup; data: GameData }[] = []
    await rollbackToCheckpoint(db, verified, {
      deliverBackup: async (backup) => {
        delivered.push({ backup, data: await readGameData(db, GAME) })
      },
      now: minute(9),
    })
    expect(delivered).toHaveLength(1)
    const { backup, data } = delivered[0]!
    expect(data).toStrictEqual(before)
    expect(backup.summary.exportedAt).toBe('2026-09-29T00:09:00.000Z')
    const read = await readBackup(backup.bytes)
    if (read.status !== 'ok') throw new Error(read.status)
    expect(read.backup.file.collections).toStrictEqual(before)
    expect(await loadGame(db, GAME)).not.toHaveProperty('lastBackupAt')
  })

  it('交付失敗時回溯停止，資料與檢查點都不變（CKPT-05）', async () => {
    const db = testDatabase()
    await addSampleGame(db)
    const { checkpoint } = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(1) })
    await setCurrentYear(db, GAME, 1991, { now: minute(2) })
    await createCheckpoint(db, GAME, { origin: 'auto', now: minute(3) })
    const verified = await verifiedOf(db, checkpoint.id)
    const before = await readGameData(db, GAME)
    const checkpoints = await listCheckpoints(db, GAME)
    const deliverBackup = () => {
      throw new Error('下載失敗')
    }
    await expect(
      rollbackToCheckpoint(db, verified, { deliverBackup, now: minute(9) }),
    ).rejects.toThrow('下載失敗')
    expect(await readGameData(db, GAME)).toStrictEqual(before)
    expect(await listCheckpoints(db, GAME)).toStrictEqual(checkpoints)
  })

  it('預覽之後有變更時阻止，資料與檢查點都不變（CKPT-05）', async () => {
    const db = testDatabase()
    await addSampleGame(db)
    const { checkpoint } = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(1) })
    await setCurrentYear(db, GAME, 1991, { now: minute(2) })
    await createCheckpoint(db, GAME, { origin: 'auto', now: minute(3) })
    const verified = await verifiedOf(db, checkpoint.id)
    const system = { subsystem: 'ヘイルトゥリーズン', parentSystem: 'ターントゥ' }
    await addSystem(db, GAME, system, { now: minute(4) })
    const before = await readGameData(db, GAME)
    const checkpoints = await listCheckpoints(db, GAME)
    const { delivered, deliverBackup } = collector()
    expect(
      await rollbackToCheckpoint(db, verified, { deliverBackup, now: minute(9) }),
    ).toStrictEqual({ status: 'blocked', blocks: [{ kind: 'changed-since-preview' }] })
    expect(await readGameData(db, GAME)).toStrictEqual(before)
    expect(await listCheckpoints(db, GAME)).toStrictEqual(checkpoints)
    expect(delivered).toHaveLength(1)
  })

  it('移除較晚的檢查點與內容，含釘選的；較早的與其他局的不動（CKPT-06、CKPT-07）', async () => {
    const db = testDatabase()
    await addSampleGame(db)
    const other = await addSampleGame(db, { id: 'G2' })
    const early = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(0) })
    const target = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(1) })
    const pinned = await createCheckpoint(db, GAME, { origin: 'manual', now: minute(3) })
    const pinnedRow = await setCheckpointPinned(db, GAME, pinned.checkpoint.id, true)
    const latest = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(4) })
    const otherCheckpoint = await createCheckpoint(db, 'G2', { origin: 'auto', now: minute(5) })
    const verified = await verifiedOf(db, target.checkpoint.id)
    const { deliverBackup } = collector()

    const result = await rollbackToCheckpoint(db, verified, { deliverBackup, now: minute(9) })
    if (result.status !== 'done') throw new Error(result.status)
    expect(result.value.removed).toStrictEqual([latest.checkpoint, pinnedRow])
    expect(await listCheckpoints(db, GAME)).toStrictEqual([target.checkpoint, early.checkpoint])
    expect(await db.checkpointContents.get(latest.checkpoint.id)).toBeUndefined()
    expect(await db.checkpointContents.get(pinned.checkpoint.id)).toBeUndefined()
    expect(await db.checkpointContents.get(target.checkpoint.id)).toBeDefined()
    expect(await listCheckpoints(db, 'G2')).toStrictEqual([otherCheckpoint.checkpoint])
    expect(await readGameData(db, 'G2')).toStrictEqual(other)
  })

  it('檢查點在預覽之後不見時丟出錯誤，資料不變', async () => {
    const db = testDatabase()
    await addSampleGame(db)
    const { checkpoint } = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(1) })
    await setCurrentYear(db, GAME, 1991, { now: minute(2) })
    const verified = await verifiedOf(db, checkpoint.id)
    await db.checkpoints.delete(checkpoint.id)
    const before = await readGameData(db, GAME)
    const { deliverBackup } = collector()
    await expect(
      rollbackToCheckpoint(db, verified, { deliverBackup, now: minute(9) }),
    ).rejects.toThrow(`找不到這一局的檢查點：${checkpoint.id}`)
    expect(await readGameData(db, GAME)).toStrictEqual(before)
  })
})
