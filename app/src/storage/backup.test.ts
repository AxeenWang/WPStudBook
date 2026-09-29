import { afterEach, describe, expect, it, vi } from 'vitest'
import { gunzipText, sampleBackup, signedBytes } from '../../tests/support/backup'
import { testDatabase } from '../../tests/support/database'
import { addSampleGame } from '../../tests/support/game-data'
import { GAME } from '../../tests/support/rows'
import {
  BACKUP_FORMAT,
  backupFileName,
  exportBackup,
  readBackup,
  sha256Hex,
  type BackupFile,
  type BackupReadStep,
} from './backup'
import { SCHEMA_VERSION } from './database'
import { countRows } from './game-data'
import { loadGame } from './games'
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
