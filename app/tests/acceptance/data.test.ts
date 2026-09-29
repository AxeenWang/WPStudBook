import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportBackup, readBackup, restoreBackup, type BackupFile } from '../../src/storage/backup'
import { SCHEMA_VERSION } from '../../src/storage/database'
import { countRows, readGameData, type GameData } from '../../src/storage/game-data'
import {
  createGame,
  deleteAllGames,
  deleteGame,
  loadGame,
  loadSettings,
  setCurrentYear,
} from '../../src/storage/games'
import { loadRuleSnapshot } from '../../src/storage/loaders'
import type { HorseRow } from '../../src/storage/records'
import { APP_VERSION } from '../../src/storage/version'
import { sampleBackup, signedBytes } from '../support/backup'
import { addTestGame, testDatabase } from '../support/database'
import { addSampleGame } from '../support/game-data'
import { GAME, lineRow, ownFoalRow, ownMareRow } from '../support/rows'

// 需求規格第 15 章「資料保存（DATA）」中由儲存層負責的部分；
// 封存、持久保存、自動備份與備份提醒由儲存子計畫 3-3 補上

afterEach(() => {
  vi.unstubAllGlobals()
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
      total: 15,
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
})
