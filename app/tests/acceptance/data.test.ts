import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  archiveGame,
  listArchives,
  prepareArchive,
  readArchive,
  removeArchive,
} from '../../src/storage/archives'
import { exportBackup, readBackup, restoreBackup, type BackupFile } from '../../src/storage/backup'
import {
  chooseBackupFolder,
  loadBackupFolder,
  prepareBackupTarget,
} from '../../src/storage/backup-folder'
import { backupReminder } from '../../src/storage/backup-reminder'
import { SCHEMA_VERSION, type WPStudBookDatabase } from '../../src/storage/database'
import { downloadBackup } from '../../src/storage/download'
import { countRows, readGameData, type GameData } from '../../src/storage/game-data'
import {
  createGame,
  currentGameId,
  deleteAllGames,
  deleteGame,
  loadGame,
  loadSettings,
  setCurrentGame,
  setCurrentYear,
} from '../../src/storage/games'
import { loadRuleSnapshot } from '../../src/storage/loaders'
import { requestPersistence } from '../../src/storage/persistence'
import type { HorseRow } from '../../src/storage/records'
import { saveBackup } from '../../src/storage/save-backup'
import { APP_VERSION } from '../../src/storage/version'
import { sampleBackup, signedBytes } from '../support/backup'
import { addTestGame, testDatabase } from '../support/database'
import { blobBytes, stubDownloads } from '../support/download'
import { fakeFolder, storeFakeFolder } from '../support/folder'
import { addSampleGame } from '../support/game-data'
import { GAME, lineRow, ownFoalRow, ownMareRow } from '../support/rows'

// 需求規格第 15 章「資料保存（DATA）」中由儲存層負責的部分；
// 畫面的顯示與封存時「確認已下載」的勾選由畫面計畫負責

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('資料保存（DATA）', () => {
  it('DATA-08 兩個遊戲局有相同馬名、年份與父母 → 完全隔離，只影響目前局', async () => {
    const db = testDatabase()
    for (const gameId of ['G1', 'G2']) {
      await addTestGame(db, { id: gameId })
      await db.lines.add(lineRow(1, 'マンノウォー', { gameId }))
      await db.horses.add(
        ownFoalRow(`${gameId}-M`, 1, 1, {
          gameId,
          baseName: '同名の馬',
          birthYear: 1985,
          sireName: '同じ父',
          damName: '同じ母',
        }),
      )
      await db.mares.add(ownMareRow(`${gameId}-M`, 1, 1, { gameId }))
    }
    await db.mares.update('G1-M', { herd: 'sold', sisterStatus: 'sold' })

    const groupsOf = async (gameId: string) =>
      (await loadRuleSnapshot(db, gameId)).eightLines.lines[0]!.mareGroups
    expect(await groupsOf('G1')).toEqual([
      { generation: 1, established: true, activeMares: 0, ownMares: 0 },
    ])
    expect(await groupsOf('G2')).toEqual([
      { generation: 1, established: true, activeMares: 1, ownMares: 1 },
    ])
  })

  it('DATA-13 新局選擇只複製設定 → 沒有八系位置、馬匹或歷程', async () => {
    const db = testDatabase()
    const source = await createGame(db, { name: '第一局', startYear: 1968 })
    await db.settings.update(source.id, { retirementAge: 24 })
    await db.systems.add({
      gameId: source.id,
      subsystem: 'マンノウォー',
      parentSystem: 'マッチェム',
    })
    await db.lines.add({
      gameId: source.id,
      line: 1,
      subsystem: 'マンノウォー',
      color: '#1f77b4',
      openedYear: 1968,
    })
    await db.horses.add({ id: 'H1', gameId: source.id, baseName: 'テストホース' })

    const copy = await createGame(db, { name: '第二局', startYear: 1980, copyFrom: source.id })
    expect((await loadSettings(db, copy.id)).retirementAge).toBe(24)
    expect(await db.systems.where('gameId').equals(copy.id).count()).toBe(1)
    expect(await db.lines.where('gameId').equals(copy.id).count()).toBe(0)
    expect(await db.horses.where('gameId').equals(copy.id).count()).toBe(0)
    for (const table of [db.mares, db.stallions, db.restorations, db.breedings, db.events]) {
      expect(await table.where('gameId').equals(copy.id).count()).toBe(0)
    }
  })

  it('DATA-11 目前遊戲年 → 只由使用者更新，不依電腦日期', async () => {
    const db = testDatabase()
    const game = await createGame(
      db,
      { name: '第一局', startYear: 1968 },
      new Date('2030-01-01T00:00:00.000Z'),
    )
    expect(game.currentYear).toBe(1968)
    expect((await setCurrentYear(db, game.id, 1969)).status).toBe('done')
    expect((await loadGame(db, game.id)).currentYear).toBe(1969)
  })

  it('DATA-17 手動把目前遊戲年往回改 → 不能早於起始年，也不能早於最後一筆紀錄的年份；推進後還沒留下新紀錄時可以改回', async () => {
    const db = testDatabase()
    await addTestGame(db)
    expect((await setCurrentYear(db, GAME, 1991)).status).toBe('done')
    expect((await setCurrentYear(db, GAME, 1990)).status).toBe('done')

    expect((await setCurrentYear(db, GAME, 1991)).status).toBe('done')
    await db.events.add({
      id: 'E1',
      gameId: GAME,
      year: 1991,
      recordedAt: '2026-09-26T00:00:00.000Z',
      source: { kind: 'manual' },
      kind: 'restoration-revoked',
      line: 1,
      restorationId: 'R1',
    })
    expect(await setCurrentYear(db, GAME, 1990)).toEqual({
      status: 'blocked',
      blocks: [{ kind: 'before-records', earliest: 1991 }],
    })
    expect((await loadGame(db, GAME)).currentYear).toBe(1991)
  })

  it('DATA-02 備份為 JSON.GZ 並還原為新遊戲局 → 集合筆數、識別、父母關聯、狀態與年度紀錄一致', async () => {
    // 別名由 CE 匯入計畫加入後補進這條測試（技術設計第 10 節）
    const db = testDatabase()
    const original = await addSampleGame(db, { name: '第一局' })
    const exported = await exportBackup(db, GAME)
    expect(exported.fileName.endsWith('.json.gz')).toBe(true)
    const result = await readBackup(exported.bytes)
    if (result.status !== 'ok') throw new Error(result.status)
    const game = await restoreBackup(db, result.backup, { fileName: exported.fileName })
    const restored = await readGameData(db, game.id)

    // 新舊識別的對照：馬依馬名（沒有馬名的依出生年），其他表各一列；
    // 期望值以 JSON.parse 的 reviver 換掉識別，不經過受測的 remapIds
    const ids = new Map([[GAME, game.id]])
    const key = (horse: HorseRow) => horse.baseName ?? String(horse.birthYear)
    for (const horse of original.horses) {
      ids.set(horse.id, restored.horses.find((row) => key(row) === key(horse))!.id)
    }
    const single = [
      'stallions',
      'restorations',
      'breedings',
      'matingRatings',
      'events',
      'horseNumbers',
      'imports',
    ] as const
    for (const name of single) ids.set(original[name][0]!.id, restored[name][0]!.id)
    const expected: GameData = JSON.parse(JSON.stringify(original), (_key, value) =>
      typeof value === 'string' ? (ids.get(value) ?? value) : value,
    )
    const byId = (a: HorseRow, b: HorseRow) => a.id.localeCompare(b.id)
    expect(restored).toStrictEqual({
      ...expected,
      games: [game],
      horses: [...expected.horses].sort(byId),
    })
    expect(countRows(restored)).toEqual(countRows(original))
    expect(await readGameData(db, GAME)).toStrictEqual(original)
  })

  it('DATA-03 日文馬名、中文備註、特殊字元、0、空白、未知值往返 → 語意不變', async () => {
    const db = testDatabase()
    await addSampleGame(db)
    const special: HorseRow = {
      id: 'G-X',
      gameId: GAME,
      fullName: '(外)[地]ディープ・インパクト',
      baseName: 'ディープ・インパクト',
      nameSource: 'import',
      abilityNumber: '0x0000',
      birthYear: 1968,
      note: ['中文備註「引號」', `"'<&>`, String.fromCharCode(92, 9), '🐎'].join(
        String.fromCharCode(10),
      ),
      ability: { speed: 0, stamina: 0, subTotal: 0, offspringQuality: 0, distance: '' },
      femaleLine: '',
    }
    await db.horses.add(special)
    await db.mareYears.add({
      gameId: GAME,
      horseId: 'G-M',
      year: 1990,
      julyVigor: { value: 100, boosted: false },
      offspringQuality: 0,
      breedingYears: 0,
      foalCount: 0,
    })
    const exported = await exportBackup(db, GAME)
    const result = await readBackup(exported.bytes)
    if (result.status !== 'ok') throw new Error(result.status)
    const game = await restoreBackup(db, result.backup, { fileName: exported.fileName })
    const restored = await readGameData(db, game.id)
    const horse = restored.horses.find((row) => row.fullName === special.fullName)!
    expect(horse).toStrictEqual({ ...special, id: horse.id, gameId: game.id })
    const mare = restored.horses.find((row) => row.baseName === 'テストメア')!
    const year = restored.mareYears.find((row) => row.year === 1990)!
    expect(year).toStrictEqual({
      gameId: game.id,
      horseId: mare.id,
      year: 1990,
      julyVigor: { value: 100, boosted: false },
      offspringQuality: 0,
      breedingYears: 0,
      foalCount: 0,
    })
    expect(restored.mares[0]!.establishedGeneration).toBe(false)
  })

  it('DATA-04 截斷檔案、錯誤 gzip、重複識別、缺少關聯或未來版本 → 拒絕，資料不變', async () => {
    const { db, bytes, file } = await sampleBackup()
    const before = await readGameData(db, GAME)
    const broken = bytes.slice()
    for (let index = 10; index < broken.length - 8; index++) broken[index] = 0
    const text = new TextEncoder().encode(JSON.stringify(file))
    const duplicated = structuredClone(file)
    duplicated.collections.horses.push({ ...duplicated.collections.horses[0]! })
    const missing = structuredClone(file)
    missing.collections.horses[0]!.damId = 'X'
    const cases: [Uint8Array<ArrayBuffer>, string][] = [
      [bytes.slice(0, Math.floor(bytes.length / 2)), 'gzip'],
      [text.slice(0, text.length - 1), 'not-json'],
      [broken, 'gzip'],
      [await signedBytes(duplicated), 'duplicate-id'],
      [await signedBytes(missing), 'missing-relation'],
      [await signedBytes({ ...file, schemaVersion: SCHEMA_VERSION + 1 }), 'future-version'],
    ]
    for (const [input, kind] of cases) {
      const result = await readBackup(input)
      expect(result.status === 'rejected' && result.reason.kind).toBe(kind)
    }
    expect(await db.games.count()).toBe(1)
    expect(await readGameData(db, GAME)).toStrictEqual(before)
  })

  it('DATA-05 較舊結構版本 → 遷移後匯入並留下紀錄', async () => {
    const { db, file } = await sampleBackup()
    const migrations = {
      1: (from: BackupFile): BackupFile => {
        const [foal, ...others] = from.collections.horses
        const horses = [{ ...foal!, note: '由 1 版遷移' }, ...others]
        return { ...from, schemaVersion: 2, collections: { ...from.collections, horses } }
      },
    }
    const result = await readBackup(await signedBytes(file), { migrations, currentVersion: 2 })
    if (result.status !== 'ok') throw new Error(result.status)
    const game = await restoreBackup(db, result.backup, { fileName: 'old.json' })
    expect(game.restoredFrom).toMatchObject({ fileName: 'old.json', schemaVersion: 1 })
    const restored = await readGameData(db, game.id)
    expect(restored.horses.some((horse) => horse.note === '由 1 版遷移')).toBe(true)
  })

  it('DATA-06 瀏覽器不支援原生壓縮 → 改輸出 JSON 並完成', async () => {
    const db = testDatabase()
    const original = await addSampleGame(db)
    vi.stubGlobal('CompressionStream', undefined)
    const exported = await exportBackup(db, GAME)
    expect(exported.fileName.endsWith('.json')).toBe(true)
    expect(exported.summary.compressed).toBe(false)
    const result = await readBackup(exported.bytes)
    if (result.status !== 'ok') throw new Error(result.status)
    const game = await restoreBackup(db, result.backup, { fileName: exported.fileName })
    expect(countRows(await readGameData(db, game.id))).toEqual(countRows(original))
  })

  it('DATA-07 匯出完成 → 顯示檔名、局、筆數、大小、版本與時間', async () => {
    const db = testDatabase()
    const original = await addSampleGame(db, { name: '第一局' })
    const exported = await exportBackup(db, GAME, new Date('2026-09-29T01:02:03.000Z'))
    expect(exported.summary).toMatchObject({
      fileName: exported.fileName,
      gameName: '第一局',
      counts: countRows(original),
      total: 16,
      size: exported.bytes.length,
      schemaVersion: SCHEMA_VERSION,
      appVersion: APP_VERSION,
      exportedAt: '2026-09-29T01:02:03.000Z',
    })
  })

  it('DATA-10 永久刪除此局、刪除全部存檔 → 刪除此局要輸入局名確認，刪除全部要輸入「刪除全部存檔」', async () => {
    // 「位於危險區」與刪除全部的第二道確認由畫面計畫負責
    const db = testDatabase()
    await addSampleGame(db, { name: '第一局' })
    await addSampleGame(db, { id: 'G2', name: '第二局' })
    expect((await deleteGame(db, GAME, '第二局')).status).toBe('blocked')
    expect(await db.games.count()).toBe(2)
    expect((await deleteGame(db, GAME, '第一局')).status).toBe('done')
    expect(await db.games.count()).toBe(1)
    expect((await deleteAllGames(db, '第二局')).status).toBe('blocked')
    expect(await db.games.count()).toBe(1)
    expect((await deleteAllGames(db, '刪除全部存檔')).status).toBe('done')
    expect(await db.games.count()).toBe(0)
    expect(await db.horses.count()).toBe(0)
  })

  it('DATA-14 開啟管理器 → 申請持久保存並顯示結果；未取得時提醒區常駐顯示未取得的說明，加強備份提醒', async () => {
    const db = testDatabase()
    const game = await addTestGame(db)
    const settings = await loadSettings(db, GAME)
    const now = new Date('2026-09-25T00:00:00.000Z')
    vi.stubGlobal('navigator', {
      storage: { persisted: async () => false, persist: async () => false },
    })
    const denied = await requestPersistence()
    expect(denied).toStrictEqual({ supported: true, persisted: false })
    expect(backupReminder(game, settings, denied.persisted, now)).toMatchObject({
      notPersisted: true,
      unbacked: false,
      overdue: false,
    })
    vi.stubGlobal('navigator', {
      storage: { persisted: async () => false, persist: async () => true },
    })
    const granted = await requestPersistence()
    expect(granted).toStrictEqual({ supported: true, persisted: true })
    expect(backupReminder(game, settings, granted.persisted, now).notPersisted).toBe(false)
  })

  it('DATA-15 已指定備份資料夾並授權，年度匯入套用成功 → 自動在該資料夾寫入完整備份；未指定、不支援、未授權或寫入失敗 → 自動下載備份檔', async () => {
    // 年度匯入以「按下套用時先取得交付目標 → 寫入資料 → saveBackup」代表，實際的串接由 CE 匯入計畫接上
    const now = new Date('2026-09-30T09:00:00.000Z')
    async function applyImport(db: WPStudBookDatabase) {
      const target = await prepareBackupTarget(db)
      await setCurrentYear(db, GAME, 1991, { now })
      return saveBackup(db, GAME, target, now)
    }

    const authorized = testDatabase()
    await addTestGame(authorized)
    vi.stubGlobal('showDirectoryPicker', async () => ({}))
    const folder = fakeFolder('備份')
    storeFakeFolder(authorized, folder.folder)
    const none = stubDownloads()
    const saved = await applyImport(authorized)
    expect(saved.delivery).toStrictEqual({ kind: 'folder', folderName: '備份' })
    expect(none).toHaveLength(0)
    const written = await readBackup(folder.files.get(saved.summary.fileName)!)
    if (written.status !== 'ok') throw new Error(written.status)
    expect(written.backup.file.game.currentYear).toBe(1991)
    expect((await loadGame(authorized, GAME)).lastBackupAt).toBe(now.toISOString())

    const fallbacks = [
      { reason: 'not-set', supported: true, folder: undefined },
      { reason: 'unsupported', supported: false, folder: fakeFolder() },
      {
        reason: 'denied',
        supported: true,
        folder: fakeFolder('備份', { query: 'prompt', request: 'denied' }),
      },
      {
        reason: 'write-failed',
        supported: true,
        folder: fakeFolder('備份', { writeError: new Error('磁碟已滿') }),
      },
    ]
    for (const fallback of fallbacks) {
      vi.restoreAllMocks()
      const db = testDatabase()
      await addTestGame(db)
      vi.stubGlobal('showDirectoryPicker', fallback.supported ? async () => ({}) : undefined)
      if (fallback.folder) storeFakeFolder(db, fallback.folder.folder)
      const downloads = stubDownloads()
      const result = await applyImport(db)
      expect(result.delivery).toMatchObject({ kind: 'download', reason: fallback.reason })
      expect(downloads.map((download) => download.fileName)).toStrictEqual([
        result.summary.fileName,
      ])
      expect(fallback.folder?.files.size ?? 0).toBe(0)
      expect((await loadGame(db, GAME)).lastBackupAt).toBe(now.toISOString())
    }
  })

  it('DATA-16 上次備份後有變更且超過 7 天 → 提醒區醒目顯示距上次備份的天數', async () => {
    const db = testDatabase()
    await addTestGame(db)
    stubDownloads()
    await saveBackup(db, GAME, { kind: 'download' }, new Date('2026-09-24T12:00:00.000Z'))
    await setCurrentYear(db, GAME, 1991, { now: new Date('2026-09-25T00:00:00.000Z') })
    const game = await loadGame(db, GAME)
    const settings = await loadSettings(db, GAME)
    expect(
      backupReminder(game, settings, true, new Date('2026-10-01T12:00:00.000Z')),
    ).toMatchObject({
      unbacked: true,
      days: 7,
      overdue: false,
    })
    expect(
      backupReminder(game, settings, true, new Date('2026-10-02T00:00:00.000Z')),
    ).toMatchObject({
      unbacked: true,
      days: 7,
      overdue: true,
    })
  })

  it('DATA-18 從未備份過的局 → 剛建立時不提醒；第一次寫入後提醒「尚未備份」，天數從建立時間算，超過設定天數時醒目提示', async () => {
    const db = testDatabase()
    const created = await createGame(
      db,
      { name: '新局', startYear: 1968 },
      new Date('2026-09-01T00:00:00.000Z'),
    )
    const settings = await loadSettings(db, created.id)
    expect(
      backupReminder(created, settings, true, new Date('2026-09-20T00:00:00.000Z')),
    ).toMatchObject({
      neverBackedUp: true,
      unbacked: false,
      overdue: false,
    })
    await setCurrentYear(db, created.id, 1969, { now: new Date('2026-09-02T00:00:00.000Z') })
    const written = await loadGame(db, created.id)
    expect(
      backupReminder(written, settings, true, new Date('2026-09-05T00:00:00.000Z')),
    ).toStrictEqual({
      neverBackedUp: true,
      unbacked: true,
      days: 4,
      overdue: false,
      notPersisted: false,
    })
    expect(
      backupReminder(written, settings, true, new Date('2026-09-20T00:00:00.000Z')),
    ).toMatchObject({
      days: 19,
      overdue: true,
    })
  })

  it('DATA-19 刪除全部存檔 → 備份資料夾的設定保留，之後的自動備份仍寫入同一個資料夾', async () => {
    // 之後的自動備份沿用讀出的資料夾（DATA-15）；fake-indexeddb 存不了方法，這裡只確認資料夾還在
    const db = testDatabase()
    await addTestGame(db)
    await setCurrentGame(db, GAME)
    vi.stubGlobal('showDirectoryPicker', async () => ({ name: '備份' }))
    expect(await chooseBackupFolder(db)).toStrictEqual({ status: 'chosen', folderName: '備份' })
    expect((await deleteAllGames(db, '刪除全部存檔')).status).toBe('done')
    expect(await loadBackupFolder(db)).toStrictEqual({ name: '備份' })
    expect(await currentGameId(db)).toBeUndefined()
    expect(await db.games.count()).toBe(0)
  })

  it('DATA-09 封存檔未驗證或未確認下載 → 不移除本機資料；封存後保留輕量索引並可還原', async () => {
    // 儲存層保證沒通過驗證就拿不到準備好的封存，局名不符就刪不掉；「確認已下載」的勾選由畫面負責
    const db = testDatabase()
    const original = await addSampleGame(db, { name: '第一局' })
    vi.stubGlobal('DecompressionStream', undefined)
    const unverified = await prepareArchive(db, GAME)
    expect(unverified.status === 'rejected' && unverified.reason.kind).toBe('gzip-unsupported')
    vi.unstubAllGlobals()

    const downloads = stubDownloads()
    const prepared = await prepareArchive(db, GAME)
    if (prepared.status !== 'ok') throw new Error(prepared.status)
    const { archive } = prepared
    downloadBackup(archive.backup)
    expect(downloads.map((download) => download.fileName)).toEqual([archive.index.fileName])
    expect((await archiveGame(db, archive, '')).status).toBe('blocked')
    expect(await readGameData(db, GAME)).toStrictEqual(original)

    expect((await archiveGame(db, archive, '第一局')).status).toBe('done')
    expect(await db.games.count()).toBe(0)
    expect(await listArchives(db)).toStrictEqual([archive.index])
    expect(archive.index).toMatchObject({ name: '第一局', startYear: 1968, currentYear: 1990 })
    const read = await readArchive(db, GAME, await blobBytes(downloads[0]!.blob))
    if (read.status !== 'ok') throw new Error(read.status)
    const game = await restoreBackup(db, read.backup, { fileName: archive.index.fileName })
    expect(countRows(await readGameData(db, game.id))).toEqual(countRows(original))
  })

  it('DATA-20 封存檔產生後這一局有異動 → 不移除本機資料，須重新產生封存檔', async () => {
    const db = testDatabase()
    await addSampleGame(db, { name: '第一局' })
    const first = await prepareArchive(db, GAME)
    if (first.status !== 'ok') throw new Error(first.status)
    expect((await setCurrentYear(db, GAME, 1991)).status).toBe('done')
    const changed = await readGameData(db, GAME)
    expect(await archiveGame(db, first.archive, '第一局')).toStrictEqual({
      status: 'blocked',
      blocks: [{ kind: 'changed-since-archive' }],
    })
    expect(await readGameData(db, GAME)).toStrictEqual(changed)
    expect(await listArchives(db)).toStrictEqual([])

    const second = await prepareArchive(db, GAME)
    if (second.status !== 'ok') throw new Error(second.status)
    expect((await archiveGame(db, second.archive, '第一局')).status).toBe('done')
    expect((await listArchives(db)).map((row) => row.currentYear)).toEqual([1991])
  })

  it('DATA-21 從封存還原，選擇的檔案與索引的驗證摘要不符 → 拒絕，資料不變；還原成新遊戲局後索引保留，可以手動移除', async () => {
    const db = testDatabase()
    await addSampleGame(db, { name: '第一局' })
    await addSampleGame(db, { id: 'G2', name: '第二局' })
    const wrong = await exportBackup(db, 'G2')
    const prepared = await prepareArchive(db, GAME)
    if (prepared.status !== 'ok') throw new Error(prepared.status)
    const { archive } = prepared
    expect((await archiveGame(db, archive, '第一局')).status).toBe('done')

    expect(await readArchive(db, GAME, wrong.bytes)).toStrictEqual({
      status: 'rejected',
      reason: { kind: 'archive-mismatch' },
    })
    expect(await db.games.count()).toBe(1)
    const read = await readArchive(db, GAME, archive.backup.bytes)
    if (read.status !== 'ok') throw new Error(read.status)
    await restoreBackup(db, read.backup, { fileName: archive.index.fileName })
    expect(await db.games.count()).toBe(2)
    expect(await listArchives(db)).toStrictEqual([archive.index])

    await removeArchive(db, GAME)
    expect(await listArchives(db)).toStrictEqual([])
    expect(await db.games.count()).toBe(2)
  })

  it('DATA-22 瀏覽器不支援壓縮 → 不能封存，本機資料不變', async () => {
    const db = testDatabase()
    const original = await addSampleGame(db)
    vi.stubGlobal('CompressionStream', undefined)
    expect(await prepareArchive(db, GAME)).toStrictEqual({
      status: 'rejected',
      reason: { kind: 'compression-unsupported' },
    })
    expect(await readGameData(db, GAME)).toStrictEqual(original)
    expect(await listArchives(db)).toStrictEqual([])
  })

  it('DATA-23 刪除全部存檔 → 封存索引一併清除', async () => {
    // 封存檔在外部，之後仍可用匯入備份還原
    const db = testDatabase()
    await addSampleGame(db, { name: '第一局' })
    await addSampleGame(db, { id: 'G2', name: '第二局' })
    const prepared = await prepareArchive(db, GAME)
    if (prepared.status !== 'ok') throw new Error(prepared.status)
    const { archive } = prepared
    expect((await archiveGame(db, archive, '第一局')).status).toBe('done')
    expect(await listArchives(db)).toHaveLength(1)

    expect((await deleteAllGames(db, '刪除全部存檔')).status).toBe('done')
    expect(await listArchives(db)).toStrictEqual([])
    const read = await readBackup(archive.backup.bytes)
    if (read.status !== 'ok') throw new Error(read.status)
    const game = await restoreBackup(db, read.backup, { fileName: archive.index.fileName })
    expect(game.name).toBe('第一局')
  })
})
