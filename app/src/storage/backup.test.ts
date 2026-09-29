import { afterEach, describe, expect, it, vi } from 'vitest'
import { gunzipText } from '../../tests/support/backup'
import { testDatabase } from '../../tests/support/database'
import { addSampleGame } from '../../tests/support/game-data'
import { GAME } from '../../tests/support/rows'
import { BACKUP_FORMAT, backupFileName, exportBackup, sha256Hex } from './backup'
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
