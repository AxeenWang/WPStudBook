import { describe, expect, it } from 'vitest'
import { readBackup, sha256Hex } from '../../src/storage/backup'
import {
  createCheckpoint,
  listCheckpoints,
  readCheckpoint,
  rollbackToCheckpoint,
  setCheckpointPinned,
  updateCheckpointNote,
  type VerifiedCheckpoint,
} from '../../src/storage/checkpoints'
import type { WPStudBookDatabase } from '../../src/storage/database'
import { readGameData, type GameData } from '../../src/storage/game-data'
import { loadGame, loadSettings, setCurrentYear, updateSettings } from '../../src/storage/games'
import { addSystem } from '../../src/storage/system-writes'
import { gunzipText } from '../support/backup'
import { addTestGame, testDatabase } from '../support/database'
import { addSampleGame } from '../support/game-data'
import { GAME } from '../support/rows'

// 需求規格第 15 章「檢查點（CKPT）」中由儲存層負責的部分；
// 年度匯入後自動建立與「回溯後再套用」由 CE 匯入計畫接上，預覽的顯示與確認由畫面計畫負責

/** 2026-09-29 00:00（UTC）起第 n 分鐘 */
function minute(n: number): Date {
  return new Date(Date.UTC(2026, 8, 29, 0, n))
}

/** 檢查點之後的操作：新增系統對照表的一筆（寫一筆事件，更新時間改變） */
const LATER_SYSTEM = { subsystem: 'ヘイルトゥリーズン', parentSystem: 'ターントゥ' }

/** 讀取並驗證檢查點；不通過時讓測試失敗 */
async function verifiedOf(
  db: WPStudBookDatabase,
  gameId: string,
  checkpointId: string,
): Promise<VerifiedCheckpoint> {
  const result = await readCheckpoint(db, gameId, checkpointId)
  if (result.status !== 'ok') throw new Error(result.status)
  return result.verified
}

describe('檢查點（CKPT）', () => {
  it('CKPT-01 年度匯入套用成功 → 自動建立檢查點，記錄年、時點、時間與雜湊', async () => {
    const db = testDatabase()
    await addSampleGame(db, { currentYear: 1970 })
    const { checkpoint } = await createCheckpoint(db, GAME, {
      origin: 'auto',
      timing: { month: 5, week: 1 },
      now: minute(1),
    })
    expect(checkpoint).toMatchObject({
      origin: 'auto',
      year: 1970,
      timing: { month: 5, week: 1 },
      createdAt: '2026-09-29T00:01:00.000Z',
    })
    // 雜湊是內容檔案 sha256 以外欄位的 SHA-256
    const content = await db.checkpointContents.get(checkpoint.id)
    const { sha256, ...body } = JSON.parse(await gunzipText(content!.bytes))
    expect(sha256).toBe(checkpoint.sha256)
    expect(await sha256Hex(JSON.stringify(body))).toBe(checkpoint.sha256)
    expect(await listCheckpoints(db, GAME)).toStrictEqual([checkpoint])
  })

  it('CKPT-02 手動建立 → 可加註說明；註記事後可以修改', async () => {
    const db = testDatabase()
    await addTestGame(db)
    const manual = await createCheckpoint(db, GAME, {
      origin: 'manual',
      note: '存檔 3：五月前',
      now: minute(1),
    })
    expect(manual.checkpoint).toMatchObject({ origin: 'manual', note: '存檔 3：五月前' })
    const auto = await createCheckpoint(db, GAME, {
      origin: 'auto',
      timing: { month: 7, week: 1 },
      now: minute(2),
    })
    await updateCheckpointNote(db, GAME, auto.checkpoint.id, '存檔 4')
    expect((await listCheckpoints(db, GAME)).map((row) => row.note)).toEqual([
      '存檔 4',
      '存檔 3：五月前',
    ])
  })

  it('CKPT-03 建立檢查點後，未釘選的超過保留個數（預設 12 個）→ 清除最舊的未釘選者；釘選的不計入也不清除', async () => {
    const db = testDatabase()
    await addTestGame(db)
    expect((await loadSettings(db, GAME)).checkpointLimit).toBe(12)
    const pinned = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(0) })
    await setCheckpointPinned(db, GAME, pinned.checkpoint.id, true)
    const first = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(1) })
    for (let n = 2; n <= 12; n++) {
      const { removed } = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(n) })
      expect(removed).toEqual([])
    }
    const thirteenth = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(13) })
    expect(thirteenth.removed).toStrictEqual([first.checkpoint])
    expect(await listCheckpoints(db, GAME)).toHaveLength(13)
    expect(await db.checkpoints.get(pinned.checkpoint.id)).toMatchObject({ pinned: true })

    // 調低保留個數：下一次建立檢查點時才清除
    await updateSettings(db, GAME, { checkpointLimit: 10 })
    expect(await listCheckpoints(db, GAME)).toHaveLength(13)
    const next = await createCheckpoint(db, GAME, { origin: 'manual', now: minute(14) })
    expect(next.removed.map((row) => row.createdAt)).toEqual([
      '2026-09-29T00:04:00.000Z',
      '2026-09-29T00:03:00.000Z',
      '2026-09-29T00:02:00.000Z',
    ])
    expect(await listCheckpoints(db, GAME)).toHaveLength(11)
  })

  it('CKPT-04 回溯 → 先驗證檢查點並預覽將捨棄的資料，確認後自動下載目前備份，再還原', async () => {
    const db = testDatabase()
    await addSampleGame(db)
    const target = await createCheckpoint(db, GAME, {
      origin: 'auto',
      timing: { month: 5, week: 1 },
      now: minute(1),
    })
    await setCurrentYear(db, GAME, 1991, { now: minute(2) })
    await addSystem(db, GAME, LATER_SYSTEM, { now: minute(3) })
    const later = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(4) })
    const before = await readGameData(db, GAME)

    // 驗證並預覽：資料不變
    const verified = await verifiedOf(db, GAME, target.checkpoint.id)
    const { preview } = verified
    expect(preview.currentYear).toEqual({ from: 1991, to: 1990 })
    expect(preview.counts.current.systems).toBe(2)
    expect(preview.counts.checkpoint.systems).toBe(1)
    expect(preview.discardedEvents).toHaveLength(1)
    expect(preview.discardedEvents[0]).toMatchObject({
      kind: 'system-added',
      system: 'ヘイルトゥリーズン',
    })
    expect(preview.removedCheckpoints).toStrictEqual([later.checkpoint])
    expect(await readGameData(db, GAME)).toStrictEqual(before)

    // 確認後：先交出目前的備份（這時資料還沒改），再還原
    const delivered: { bytes: Uint8Array<ArrayBuffer>; data: GameData }[] = []
    const result = await rollbackToCheckpoint(db, verified, {
      deliverBackup: async (backup) => {
        delivered.push({ bytes: backup.bytes, data: await readGameData(db, GAME) })
      },
      now: minute(9),
    })
    expect(result.status).toBe('done')
    expect(delivered).toHaveLength(1)
    expect(delivered[0]!.data).toStrictEqual(before)
    const backup = await readBackup(delivered[0]!.bytes)
    if (backup.status !== 'ok') throw new Error(backup.status)
    expect(backup.backup.file.collections).toStrictEqual(before)
  })

  it('CKPT-05 檢查點驗證失敗、目前備份下載失敗，或預覽後資料有變更 → 停止回溯，資料不變', async () => {
    const db = testDatabase()
    await addSampleGame(db)
    const target = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(1) })
    await setCurrentYear(db, GAME, 1991, { now: minute(2) })
    await createCheckpoint(db, GAME, { origin: 'auto', now: minute(3) })
    const snapshot = async () => ({
      data: await readGameData(db, GAME),
      checkpoints: await listCheckpoints(db, GAME),
    })
    const before = await snapshot()

    // 檢查點驗證失敗：內容損毀
    const content = (await db.checkpointContents.get(target.checkpoint.id))!
    await db.checkpointContents.update(target.checkpoint.id, { bytes: content.bytes.slice(0, 20) })
    expect((await readCheckpoint(db, GAME, target.checkpoint.id)).status).toBe('rejected')
    expect(await snapshot()).toStrictEqual(before)
    await db.checkpointContents.put(content)

    // 目前備份下載失敗
    const verified = await verifiedOf(db, GAME, target.checkpoint.id)
    const failing = () => {
      throw new Error('下載失敗')
    }
    await expect(
      rollbackToCheckpoint(db, verified, { deliverBackup: failing, now: minute(9) }),
    ).rejects.toThrow('下載失敗')
    expect(await snapshot()).toStrictEqual(before)

    // 預覽後資料有變更
    await setCurrentYear(db, GAME, 1992, { now: minute(4) })
    const changed = await snapshot()
    const result = await rollbackToCheckpoint(db, verified, {
      deliverBackup: () => undefined,
      now: minute(9),
    })
    expect(result).toStrictEqual({ status: 'blocked', blocks: [{ kind: 'changed-since-preview' }] })
    expect(await snapshot()).toStrictEqual(changed)
  })

  it('CKPT-06 回溯後 → 資料與遊戲年回到檢查點、設定沿用目前的值，較晚的檢查點（含釘選的）被移除', async () => {
    const db = testDatabase()
    const data = await addSampleGame(db)
    const target = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(1) })
    await setCurrentYear(db, GAME, 1991, { now: minute(2) })
    await addSystem(db, GAME, LATER_SYSTEM, { now: minute(3) })
    await updateSettings(db, GAME, { retirementAge: 24 }, { now: minute(4) })
    const pinned = await createCheckpoint(db, GAME, { origin: 'manual', now: minute(5) })
    await setCheckpointPinned(db, GAME, pinned.checkpoint.id, true)
    const verified = await verifiedOf(db, GAME, target.checkpoint.id)

    const result = await rollbackToCheckpoint(db, verified, {
      deliverBackup: () => undefined,
      now: minute(9),
    })
    if (result.status !== 'done') throw new Error(result.status)
    expect((await loadGame(db, GAME)).currentYear).toBe(1990)
    expect(await readGameData(db, GAME)).toStrictEqual({
      ...data,
      games: [{ ...data.games[0]!, updatedAt: '2026-09-29T00:09:00.000Z' }],
      settings: [{ ...data.settings[0]!, retirementAge: 24 }],
    })
    expect(result.value.removed.map((row) => row.id)).toEqual([pinned.checkpoint.id])
    expect(await listCheckpoints(db, GAME)).toStrictEqual([target.checkpoint])
  })

  it('CKPT-07 回溯 → 只影響目前遊戲局', async () => {
    const db = testDatabase()
    await addSampleGame(db)
    await addSampleGame(db, { id: 'G2' })
    const target = await createCheckpoint(db, GAME, { origin: 'auto', now: minute(1) })
    const other = await createCheckpoint(db, 'G2', { origin: 'auto', now: minute(2) })
    await setCurrentYear(db, GAME, 1991, { now: minute(3) })
    await setCurrentYear(db, 'G2', 1991, { now: minute(3) })
    await addSystem(db, 'G2', LATER_SYSTEM, { now: minute(4) })
    const otherLater = await createCheckpoint(db, 'G2', { origin: 'auto', now: minute(5) })
    const otherBefore = await readGameData(db, 'G2')
    const verified = await verifiedOf(db, GAME, target.checkpoint.id)

    const result = await rollbackToCheckpoint(db, verified, {
      deliverBackup: () => undefined,
      now: minute(9),
    })
    expect(result.status).toBe('done')
    expect((await loadGame(db, GAME)).currentYear).toBe(1990)
    expect(await readGameData(db, 'G2')).toStrictEqual(otherBefore)
    expect(await listCheckpoints(db, 'G2')).toStrictEqual([otherLater.checkpoint, other.checkpoint])
  })

  it('CKPT-08 直接補匯後 → 檢查點記為目前進度，並註明補匯的年與時點', async () => {
    const db = testDatabase()
    await addTestGame(db, { currentYear: 1971 })
    const { checkpoint } = await createCheckpoint(db, GAME, {
      origin: 'auto',
      timing: { month: 7, week: 1 },
      catchUp: { year: 1970, timing: { month: 4, week: 1 } },
      now: minute(1),
    })
    expect(checkpoint).toMatchObject({
      year: 1971,
      timing: { month: 7, week: 1 },
      catchUp: { year: 1970, timing: { month: 4, week: 1 } },
    })
    expect(await listCheckpoints(db, GAME)).toStrictEqual([checkpoint])
  })
})
