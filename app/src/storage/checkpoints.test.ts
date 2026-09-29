import { describe, expect, it } from 'vitest'
import { gunzipText } from '../../tests/support/backup'
import { addTestGame, testDatabase } from '../../tests/support/database'
import { addSampleGame } from '../../tests/support/game-data'
import { GAME } from '../../tests/support/rows'
import { readBackup } from './backup'
import {
  createCheckpoint,
  listCheckpoints,
  setCheckpointPinned,
  updateCheckpointNote,
  type NewCheckpoint,
} from './checkpoints'
import { loadGame } from './games'

/** 2026-09-29 00:0n（UTC）：建立時間依 n 遞增 */
function minute(n: number): Date {
  return new Date(Date.UTC(2026, 8, 29, 0, n))
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
