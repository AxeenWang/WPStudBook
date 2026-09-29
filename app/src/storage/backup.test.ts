import { afterEach, describe, expect, it, vi } from 'vitest'
import { gunzipText, sampleBackup, signedBytes } from '../../tests/support/backup'
import { testDatabase } from '../../tests/support/database'
import { addSampleGame } from '../../tests/support/game-data'
import { GAME } from '../../tests/support/rows'
import {
  BACKUP_FORMAT,
  PRIMARY_KEYS,
  backupFileName,
  encodeBackup,
  exportBackup,
  readBackup,
  restoreBackup,
  sha256Hex,
  type BackupFile,
  type BackupReadStep,
  type ReadBackupOptions,
} from './backup'
import { SCHEMA_VERSION } from './database'
import { GAME_TABLES, countRows, readGameData } from './game-data'
import { currentGameId, listGames, loadGame, setCurrentGame } from './games'
import { APP_VERSION } from './version'

/** 匯出時間：2026-09-29 01:02:03（UTC） */
const NOW = new Date('2026-09-29T01:02:03.000Z')

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('exportBackup', () => {
  it('gzip 壓縮的 JSON：欄位依序為格式、版本、匯出時間、摘要、筆數、集合與雜湊（需求規格 12.2）', async () => {
    const db = testDatabase()
    const data = await addSampleGame(db, { name: '第一局', currentYear: 1990 })
    const exported = await exportBackup(db, GAME, NOW)
    expect([...exported.bytes.slice(0, 2)]).toEqual([0x1f, 0x8b])
    const file = JSON.parse(await gunzipText(exported.bytes))
    expect(Object.keys(file)).toEqual([
      'format',
      'schemaVersion',
      'appVersion',
      'exportedAt',
      'game',
      'counts',
      'collections',
      'sha256',
    ])
    expect(file).toStrictEqual({
      format: BACKUP_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      appVersion: APP_VERSION,
      exportedAt: '2026-09-29T01:02:03.000Z',
      game: { id: GAME, name: '第一局', startYear: 1968, currentYear: 1990 },
      counts: countRows(data),
      collections: data,
      sha256: file.sha256,
    })
    const { sha256, ...body } = file
    expect(sha256).toBe(await sha256Hex(JSON.stringify(body)))
  })

  it('回傳檔名、內容與摘要：檔名、局名、各集合筆數與總筆數、大小、版本、匯出時間（DATA-07）', async () => {
    const db = testDatabase()
    const data = await addSampleGame(db, { name: '第一局', currentYear: 1990 })
    const exported = await exportBackup(db, GAME, NOW)
    const fileName = backupFileName('第一局', 1990, NOW, true)
    expect(exported.fileName).toBe(fileName)
    expect(exported.summary).toStrictEqual({
      fileName,
      gameName: '第一局',
      counts: countRows(data),
      total: 15,
      size: exported.bytes.length,
      schemaVersion: SCHEMA_VERSION,
      appVersion: APP_VERSION,
      exportedAt: '2026-09-29T01:02:03.000Z',
      compressed: true,
    })
  })

  it('瀏覽器不支援 CompressionStream 時輸出未壓縮的 .json（DATA-06）', async () => {
    const db = testDatabase()
    await addSampleGame(db, { name: '第一局' })
    vi.stubGlobal('CompressionStream', undefined)
    const exported = await exportBackup(db, GAME, NOW)
    expect(exported.fileName).toBe(backupFileName('第一局', 1990, NOW, false))
    expect(exported.fileName.endsWith('.json')).toBe(true)
    expect(exported.summary.compressed).toBe(false)
    const file = JSON.parse(new TextDecoder().decode(exported.bytes))
    expect(file.format).toBe(BACKUP_FORMAT)
    expect(exported.summary.size).toBe(exported.bytes.length)
  })

  it('只讀：不改遊戲局，也不記錄最近備份時間；遊戲局不存在時丟出錯誤', async () => {
    const db = testDatabase()
    const data = await addSampleGame(db)
    await exportBackup(db, GAME, NOW)
    expect(await loadGame(db, GAME)).toStrictEqual(data.games[0])
    await expect(exportBackup(db, 'missing', NOW)).rejects.toThrow('找不到遊戲局：missing')
  })
})

describe('encodeBackup', () => {
  it('匯出的內容就是它的輸出；sha256 是檔案裡的雜湊', async () => {
    const db = testDatabase()
    const data = await addSampleGame(db)
    const exported = await exportBackup(db, GAME, NOW)
    const encoded = await encodeBackup(data, NOW.toISOString())
    expect(encoded.bytes).toEqual(exported.bytes)
    expect(encoded.compressed).toBe(true)
    expect(encoded.sha256).toBe(JSON.parse(await gunzipText(encoded.bytes)).sha256)
  })
})

describe('backupFileName', () => {
  it('WPStudBook_局名_目前遊戲年年_本機時間，壓縮時 .json.gz、否則 .json', () => {
    const at = new Date(2026, 8, 29, 1, 2, 3)
    expect(backupFileName('第一局', 1990, at, true)).toBe(
      'WPStudBook_第一局_1990年_20260929-010203.json.gz',
    )
    expect(backupFileName('第一局', 1990, at, false)).toBe(
      'WPStudBook_第一局_1990年_20260929-010203.json',
    )
  })

  it('局名裡 Windows 檔名不允許的字元與控制字元換成 _', () => {
    const at = new Date(2026, 11, 31, 23, 59, 58)
    const name = ['a', '/', 'b', ':', '*', '?', '"', '<', '>', '|', String.fromCharCode(92, 9), 'c']
    expect(backupFileName(name.join(''), 1970, at, true)).toBe(
      'WPStudBook_a_b_________c_1970年_20261231-235958.json.gz',
    )
  })

  it('局名超過 60 字時只取前 60 字，不拆開代理對', () => {
    const at = new Date(2026, 8, 29, 1, 2, 3)
    const name = '馬'.repeat(59) + '🐎🐎'
    expect(backupFileName(name, 1990, at, true)).toBe(
      `WPStudBook_${'馬'.repeat(59)}🐎_1990年_20260929-010203.json.gz`,
    )
  })
})

describe('sha256Hex', () => {
  it('UTF-8 位元組的 SHA-256，小寫十六進位', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })
})

describe('readBackup', () => {
  /** 測試用：讀取並回傳拒絕原因；通過時丟出錯誤 */
  async function rejection(bytes: Uint8Array<ArrayBuffer>) {
    const result = await readBackup(bytes)
    if (result.status !== 'rejected') throw new Error('應該被拒絕')
    return result.reason
  }

  it('匯出的備份通過：回傳內容與預覽，依序回報解壓、解析、驗證', async () => {
    const { bytes, file } = await sampleBackup({ name: '第一局' })
    const steps: BackupReadStep[] = []
    const result = await readBackup(bytes, { onProgress: (step) => steps.push(step) })
    if (result.status !== 'ok') throw new Error(result.status)
    expect(result.backup.file).toStrictEqual(file)
    expect(result.backup.preview).toStrictEqual({
      gameName: '第一局',
      startYear: 1968,
      currentYear: 1990,
      exportedAt: '2026-09-29T01:02:03.000Z',
      schemaVersion: SCHEMA_VERSION,
      appVersion: APP_VERSION,
      counts: file.counts,
      total: 15,
    })
    expect(steps).toEqual(['decompress', 'parse', 'verify'])
  })

  it('未壓縮的 JSON 也能讀，不經解壓（DATA-06）', async () => {
    const db = testDatabase()
    await addSampleGame(db)
    vi.stubGlobal('CompressionStream', undefined)
    const { bytes } = await exportBackup(db, GAME, NOW)
    const steps: BackupReadStep[] = []
    const result = await readBackup(bytes, { onProgress: (step) => steps.push(step) })
    expect(result.status).toBe('ok')
    expect(steps).toEqual(['parse', 'verify'])
  })

  it('錯誤或截斷的 gzip 拒絕（DATA-04）', async () => {
    const { bytes } = await sampleBackup()
    expect(await rejection(bytes.slice(0, Math.floor(bytes.length / 2)))).toEqual({ kind: 'gzip' })
    const broken = bytes.slice()
    for (let index = 10; index < broken.length - 8; index++) broken[index] = 0
    expect(await rejection(broken)).toEqual({ kind: 'gzip' })
  })

  it('檔案是 gzip 但瀏覽器不支援 DecompressionStream 時拒絕', async () => {
    const { bytes } = await sampleBackup()
    vi.stubGlobal('DecompressionStream', undefined)
    expect(await rejection(bytes)).toEqual({ kind: 'gzip-unsupported' })
  })

  it('截斷或不是 JSON、不是 UTF-8 時拒絕（DATA-04）', async () => {
    const { file } = await sampleBackup()
    const text = JSON.stringify(file)
    const encode = (value: string) => new TextEncoder().encode(value)
    expect(await rejection(encode(text.slice(0, text.length - 1)))).toEqual({ kind: 'not-json' })
    expect(await rejection(encode('WPStudBook'))).toEqual({ kind: 'not-json' })
    // 非法的 UTF-8 位元組在 JSON 字串裡：不嚴格解碼時會變成替代字元，成為合法的 JSON
    expect(await rejection(new Uint8Array([0x22, 0xff, 0x22]))).toEqual({ kind: 'not-json' })
  })

  it('格式識別不符，或結構版本不是 1 以上的整數時拒絕', async () => {
    const { file } = await sampleBackup()
    for (const changed of [
      { ...file, format: 'other' },
      { ...file, schemaVersion: 0 },
      { ...file, schemaVersion: 1.5 },
      { ...file, schemaVersion: '1' },
    ]) {
      expect(await rejection(await signedBytes(changed))).toEqual({ kind: 'not-backup' })
    }
    for (const value of ['[]', 'null', '1']) {
      expect(await rejection(new TextEncoder().encode(value))).toEqual({ kind: 'not-backup' })
    }
  })

  it('結構版本比目前新時拒絕並附版本（DATA-04）', async () => {
    const { file } = await sampleBackup()
    const future = { ...file, schemaVersion: SCHEMA_VERSION + 1 }
    expect(await rejection(await signedBytes(future))).toEqual({
      kind: 'future-version',
      version: SCHEMA_VERSION + 1,
    })
  })

  it('雜湊不符時拒絕：內容被改過，或沒有雜湊', async () => {
    const { file } = await sampleBackup()
    const encode = (value: object) => new TextEncoder().encode(JSON.stringify(value))
    const renamed = { ...file, game: { ...file.game, name: '改過的局名' } }
    expect(await rejection(encode(renamed))).toEqual({ kind: 'hash' })
    const unsigned: Record<string, unknown> = { ...file }
    delete unsigned.sha256
    expect(await rejection(encode(unsigned))).toEqual({ kind: 'hash' })
  })

  it('雜湊的重算失敗時也回傳雜湊不符，不丟例外：極深的巢狀', async () => {
    const depth = 100000
    const nested = '['.repeat(depth) + ']'.repeat(depth)
    const text = `{"format":"${BACKUP_FORMAT}","schemaVersion":1,"x":${nested}}`
    expect(await rejection(new TextEncoder().encode(text))).toEqual({ kind: 'hash' })
  })

  it('較舊的結構版本逐版遷移，預覽保留檔案原本的版本（DATA-05）', async () => {
    const { file } = await sampleBackup()
    const calls: number[] = []
    const migrations = {
      1: (from: BackupFile): BackupFile => {
        calls.push(1)
        return { ...from, schemaVersion: 2 }
      },
      2: (from: BackupFile): BackupFile => {
        calls.push(2)
        const [foal, ...others] = from.collections.horses
        const horses = [{ ...foal!, note: '由 2 版遷移' }, ...others]
        return { ...from, schemaVersion: 3, collections: { ...from.collections, horses } }
      },
    }
    const result = await readBackup(await signedBytes(file), { migrations, currentVersion: 3 })
    if (result.status !== 'ok') throw new Error(result.status)
    expect(calls).toEqual([1, 2])
    expect(result.backup.file.schemaVersion).toBe(3)
    expect(result.backup.file.collections.horses[0]!.note).toBe('由 2 版遷移')
    expect(result.backup.preview.schemaVersion).toBe(1)
  })

  it('缺少某一版的遷移時丟出錯誤', async () => {
    const { bytes } = await sampleBackup()
    await expect(readBackup(bytes, { migrations: {}, currentVersion: 2 })).rejects.toThrow(
      '缺少結構版本 1 的遷移',
    )
  })
})

describe('readBackup：集合的內容', () => {
  /** 測試用：改動樣本備份的內容（重新算雜湊），讀取後回傳拒絕原因；通過時回傳 undefined */
  async function rejectionOf(change: (file: BackupFile) => void) {
    const { file } = await sampleBackup()
    change(file)
    const result = await readBackup(await signedBytes(file))
    return result.status === 'rejected' ? result.reason : undefined
  }

  /** 測試用：當作任意物件修改 */
  const loose = (value: object) => value as Record<string, unknown>

  it('集合不是物件、多或少一個集合、集合不是陣列時拒絕，附位置（DATA-04）', async () => {
    expect(await rejectionOf((file) => (loose(file).collections = null))).toEqual({
      kind: 'field',
      path: 'collections',
    })
    expect(await rejectionOf((file) => (loose(file).collections = []))).toEqual({
      kind: 'field',
      path: 'collections.games',
    })
    expect(await rejectionOf((file) => (loose(file.collections).checkpoints = []))).toEqual({
      kind: 'field',
      path: 'collections.checkpoints',
    })
    expect(await rejectionOf((file) => delete loose(file.collections).events)).toEqual({
      kind: 'field',
      path: 'collections.events',
    })
    expect(await rejectionOf((file) => (loose(file.collections).horses = {}))).toEqual({
      kind: 'field',
      path: 'collections.horses',
    })
  })

  it('games 與 settings 不是剛好一列時拒絕', async () => {
    expect(
      await rejectionOf((file) => file.collections.games.push({ ...file.collections.games[0]! })),
    ).toEqual({ kind: 'field', path: 'collections.games' })
    expect(await rejectionOf((file) => (file.collections.settings = []))).toEqual({
      kind: 'field',
      path: 'collections.settings',
    })
  })

  it('資料列不是物件、主鍵欄位缺少或型別不對、不屬於這一局時拒絕', async () => {
    expect(await rejectionOf((file) => (loose(file.collections.horses)[1] = 'G-M'))).toEqual({
      kind: 'field',
      path: 'collections.horses[1]',
    })
    expect(await rejectionOf((file) => delete loose(file.collections.horses[0]!).id)).toEqual({
      kind: 'field',
      path: 'collections.horses[0].id',
    })
    expect(await rejectionOf((file) => (loose(file.collections.lines[0]!).line = '1'))).toEqual({
      kind: 'field',
      path: 'collections.lines[0].line',
    })
    expect(
      await rejectionOf((file) => (loose(file.collections.mareYears[0]!).year = '1989')),
    ).toEqual({ kind: 'field', path: 'collections.mareYears[0].year' })
    expect(
      await rejectionOf((file) => (loose(file.collections.settings[0]!).gameId = 123)),
    ).toEqual({ kind: 'field', path: 'collections.settings[0].gameId' })
    expect(await rejectionOf((file) => (file.collections.events[0]!.gameId = 'G2'))).toEqual({
      kind: 'field',
      path: 'collections.events[0].gameId',
    })
  })

  it('遊戲局摘要與 games 那一列不一致時拒絕', async () => {
    for (const change of [
      (file: BackupFile) => (file.game.name = '別的局'),
      (file: BackupFile) => (file.game.currentYear = 1991),
      (file: BackupFile) => delete loose(file).game,
    ]) {
      expect(await rejectionOf(change)).toEqual({ kind: 'field', path: 'game' })
    }
  })

  it('games 那一列儲存層會取用的欄位型別不對時拒絕：局名、建立與更新時間、起始年與目前遊戲年', async () => {
    const cases: [(file: BackupFile) => void, string][] = [
      [(file) => (loose(file.collections.games[0]!).name = 123), 'name'],
      [(file) => delete loose(file.collections.games[0]!).createdAt, 'createdAt'],
      [(file) => (loose(file.collections.games[0]!).updatedAt = null), 'updatedAt'],
      [(file) => (loose(file.collections.games[0]!).startYear = '1968'), 'startYear'],
      [(file) => (file.collections.games[0]!.currentYear = 1990.5), 'currentYear'],
    ]
    for (const [change, field] of cases) {
      expect(await rejectionOf(change)).toEqual({
        kind: 'field',
        path: `collections.games[0].${field}`,
      })
    }
  })

  it('同一集合的主鍵重複，或 id 跨集合重複時拒絕（DATA-04）', async () => {
    expect(
      await rejectionOf((file) => file.collections.horses.push({ ...file.collections.horses[0]! })),
    ).toEqual({ kind: 'duplicate-id', collection: 'horses', id: 'G-F' })
    expect(
      await rejectionOf((file) =>
        file.collections.mareYears.push({ ...file.collections.mareYears[0]!, plan: 'resting' }),
      ),
    ).toEqual({ kind: 'duplicate-id', collection: 'mareYears', id: 'G+G-M+1989' })
    expect(await rejectionOf((file) => (file.collections.events[0]!.id = 'G-B'))).toEqual({
      kind: 'duplicate-id',
      collection: 'events',
      id: 'G-B',
    })
  })

  it('資料列層級的引用找不到時拒絕，附位置與值（DATA-04）', async () => {
    const cases: [(file: BackupFile) => void, string][] = [
      [(file) => (file.collections.horses[0]!.sireId = 'X'), 'horses[0].sireId'],
      [(file) => (file.collections.horses[0]!.damId = 'X'), 'horses[0].damId'],
      [
        (file) => (file.collections.horses[0]!.birth = { breedingId: 'X' }),
        'horses[0].birth.breedingId',
      ],
      [(file) => (file.collections.mares[0]!.horseId = 'X'), 'mares[0].horseId'],
      [(file) => (file.collections.mareYears[0]!.horseId = 'X'), 'mareYears[0].horseId'],
      [(file) => (file.collections.stallions[0]!.horseId = 'X'), 'stallions[0].horseId'],
      [(file) => (file.collections.stallions[0]!.breedingId = 'X'), 'stallions[0].breedingId'],
      [
        (file) => (file.collections.stallions[0]!.restorationId = 'X'),
        'stallions[0].restorationId',
      ],
      [(file) => (file.collections.breedings[0]!.mareId = 'X'), 'breedings[0].mareId'],
      [(file) => (file.collections.breedings[0]!.sireId = 'X'), 'breedings[0].sireId'],
      [(file) => (file.collections.matingRatings[0]!.mareId = 'X'), 'matingRatings[0].mareId'],
      [(file) => (file.collections.matingRatings[0]!.sireId = 'X'), 'matingRatings[0].sireId'],
      [(file) => (file.collections.horseNumbers[0]!.horseId = 'X'), 'horseNumbers[0].horseId'],
      [(file) => (loose(file.collections.events[0]!).horseId = 'X'), 'events[0].horseId'],
    ]
    for (const [change, path] of cases) {
      expect(await rejectionOf(change)).toEqual({
        kind: 'missing-relation',
        path: `collections.${path}`,
        value: 'X',
      })
    }
  })

  it('母馬年度資料、配種與評價的母馬要在 mares：只有馬匹不夠', async () => {
    expect(await rejectionOf((file) => (file.collections.mareYears[0]!.horseId = 'G-F'))).toEqual({
      kind: 'missing-relation',
      path: 'collections.mareYears[0].horseId',
      value: 'G-F',
    })
    expect(await rejectionOf((file) => (file.collections.breedings[0]!.mareId = 'G-F'))).toEqual({
      kind: 'missing-relation',
      path: 'collections.breedings[0].mareId',
      value: 'G-F',
    })
    expect(
      await rejectionOf((file) => (file.collections.matingRatings[0]!.mareId = 'G-F')),
    ).toEqual({
      kind: 'missing-relation',
      path: 'collections.matingRatings[0].mareId',
      value: 'G-F',
    })
  })

  it('事件內容裡懸空的引用不拒絕：取消預定後繼會刪除任用列', async () => {
    const reason = await rejectionOf((file) => {
      file.collections.events.push({
        id: 'G-E2',
        gameId: GAME,
        year: 1990,
        recordedAt: '2026-09-24T00:00:00.000Z',
        source: { kind: 'manual' },
        kind: 'successor-cancelled',
        line: 1,
        stallionId: 'G-gone',
        generation: 1,
        breedingId: 'G-gone-B',
      })
      file.counts.events = 2
    })
    expect(reason).toBeUndefined()
  })

  it('筆數與集合對不上、少一個或多一個鍵時拒絕', async () => {
    expect(await rejectionOf((file) => (file.counts.horses = 2))).toEqual({
      kind: 'count',
      collection: 'horses',
    })
    expect(await rejectionOf((file) => delete loose(file.counts).horseNumbers)).toEqual({
      kind: 'count',
      collection: 'horseNumbers',
    })
    expect(await rejectionOf((file) => (loose(file.counts).checkpoints = 0))).toEqual({
      kind: 'count',
      collection: 'checkpoints',
    })
    expect(await rejectionOf((file) => (loose(file).counts = null))).toEqual({
      kind: 'count',
      collection: 'games',
    })
  })

  it('筆數多出的鍵是繼承的屬性名稱（例如 constructor）時也拒絕', async () => {
    for (const [key, value] of [
      ['constructor', 1],
      ['toString', 0],
    ] as const) {
      expect(await rejectionOf((file) => (loose(file.counts)[key] = value))).toEqual({
        kind: 'count',
        collection: key,
      })
    }
  })
})

describe('restoreBackup', () => {
  /** 還原的時間 */
  const RESTORED_AT = new Date('2026-09-30T04:05:06.000Z')

  /** 測試用：讀取備份，通過時回傳驗證過的備份 */
  async function verified(bytes: Uint8Array<ArrayBuffer>, options: ReadBackupOptions = {}) {
    const result = await readBackup(bytes, options)
    if (result.status !== 'ok') throw new Error(JSON.stringify(result.reason))
    return result.backup
  }

  it('還原成新遊戲局：原局還在也不相撞，識別全部重新產生，筆數相同（需求規格 12.2）', async () => {
    const { db, file } = await sampleBackup({ name: '第一局', appVersion: '0.0.0-old' })
    const original = await readGameData(db, GAME)
    // 檔頭的應用版本與遊戲局那一列、目前版本都不同，才分得出還原來源記的是檔頭的版本
    const exported = await signedBytes({ ...file, appVersion: '0.0.0-exported' })
    const game = await restoreBackup(db, await verified(exported), {
      fileName: 'WPStudBook_第一局.json.gz',
      now: RESTORED_AT,
    })
    expect(game).toStrictEqual({
      ...original.games[0]!,
      id: game.id,
      createdAt: '2026-09-30T04:05:06.000Z',
      appVersion: APP_VERSION,
      lastBackupAt: '2026-09-29T01:02:03.000Z',
      restoredFrom: {
        fileName: 'WPStudBook_第一局.json.gz',
        exportedAt: '2026-09-29T01:02:03.000Z',
        gameName: '第一局',
        appVersion: '0.0.0-exported',
        schemaVersion: SCHEMA_VERSION,
      },
    })
    expect(await loadGame(db, game.id)).toStrictEqual(game)
    const restored = await readGameData(db, game.id)
    expect(countRows(restored)).toEqual(countRows(original))
    const oldIds = new Set(original.horses.map((horse) => horse.id))
    expect(restored.horses.filter((horse) => oldIds.has(horse.id))).toEqual([])
    expect(await readGameData(db, GAME)).toStrictEqual(original)
  })

  it('引用跟著新識別：產駒的父母與出生紀錄指向新局的馬與配種', async () => {
    const { db, bytes } = await sampleBackup()
    const game = await restoreBackup(db, await verified(bytes), { fileName: 'b.json.gz' })
    const { horses, breedings } = await readGameData(db, game.id)
    const byName = (name: string) => horses.find((horse) => horse.baseName === name)!
    const foal = horses.find((horse) => horse.birthYear === 1990)!
    expect(foal).toMatchObject({
      gameId: game.id,
      sireId: byName('テストスタリオン').id,
      damId: byName('テストメア').id,
      birth: { breedingId: breedings[0]!.id },
    })
  })

  it('局名：傳入時去除前後空白後使用；空白時丟出 RangeError，什麼都不寫', async () => {
    const { db, bytes } = await sampleBackup({ name: '第一局' })
    const backup = await verified(bytes)
    const game = await restoreBackup(db, backup, { fileName: 'b.json.gz', name: '  還原的局  ' })
    expect(game.name).toBe('還原的局')
    expect(game.restoredFrom?.gameName).toBe('第一局')
    await expect(restoreBackup(db, backup, { fileName: 'b.json.gz', name: '  ' })).rejects.toThrow(
      new RangeError('局名不能空白'),
    )
    expect(await db.games.count()).toBe(2)
  })

  it('同一份備份可以還原兩次；局名可以重複；不切換目前遊戲局', async () => {
    const { db, bytes } = await sampleBackup({ name: '第一局' })
    await setCurrentGame(db, GAME)
    const backup = await verified(bytes)
    const first = await restoreBackup(db, backup, { fileName: 'b.json.gz' })
    const second = await restoreBackup(db, backup, { fileName: 'b.json.gz' })
    expect(first.id).not.toBe(second.id)
    expect((await listGames(db)).map((game) => game.name)).toEqual(['第一局', '第一局', '第一局'])
    expect(await currentGameId(db)).toBe(GAME)
  })

  it('經過遷移時，還原來源記檔案原本的結構版本（DATA-05）', async () => {
    const { db, file } = await sampleBackup()
    const migrations = { 1: (from: BackupFile): BackupFile => ({ ...from, schemaVersion: 2 }) }
    const backup = await verified(await signedBytes(file), { migrations, currentVersion: 2 })
    const game = await restoreBackup(db, backup, { fileName: 'old.json' })
    expect(game.restoredFrom?.schemaVersion).toBe(1)
  })

  it('依集合回報寫入進度（已寫筆數與總筆數）', async () => {
    const { db, bytes } = await sampleBackup()
    const progress: [number, number][] = []
    await restoreBackup(db, await verified(bytes), {
      fileName: 'b.json.gz',
      onProgress: (written, total) => progress.push([written, total]),
    })
    expect(progress).toHaveLength(13)
    expect(progress[12]).toEqual([15, 15])
  })

  it('寫入途中失敗時整筆回復，什麼都不寫', async () => {
    const { db, bytes } = await sampleBackup()
    const backup = await verified(bytes)
    const settings = backup.file.collections.settings
    const broken = {
      ...backup,
      file: {
        ...backup.file,
        collections: { ...backup.file.collections, settings: [...settings, ...settings] },
      },
    }
    await expect(restoreBackup(db, broken, { fileName: 'b.json.gz' })).rejects.toThrow()
    expect(await db.games.count()).toBe(1)
    expect(await db.settings.count()).toBe(1)
  })
})

describe('PRIMARY_KEYS', () => {
  it('與資料庫的主鍵相同（database.ts）：加表或改主鍵時要一起改', () => {
    const db = testDatabase()
    for (const name of GAME_TABLES) {
      const keyPath = db.table(name).schema.primKey.keyPath
      expect([keyPath].flat(), name).toEqual(PRIMARY_KEYS[name].map(([field]) => field))
    }
  })
})
