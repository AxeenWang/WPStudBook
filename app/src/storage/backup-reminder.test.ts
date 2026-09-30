import { describe, expect, it } from 'vitest'
import { GAME } from '../../tests/support/rows'
import { backupReminder } from './backup-reminder'
import { DEFAULT_SETTINGS } from './games'
import type { GameRow, SettingsRow } from './records'

const CREATED = '2026-09-01T00:00:00.000Z'
const BACKED_UP = '2026-09-10T00:00:00.000Z'
const settings: SettingsRow = { gameId: GAME, ...DEFAULT_SETTINGS }

function game(fields: Partial<GameRow> = {}): GameRow {
  return {
    id: GAME,
    name: '測試局',
    startYear: 1968,
    currentYear: 1990,
    createdAt: CREATED,
    updatedAt: CREATED,
    appVersion: '0.0.0-old',
    ...fields,
  }
}

/** 基準時間之後經過 days 天又 ms 毫秒 */
function after(baseline: string, days: number, ms = 0): Date {
  return new Date(Date.parse(baseline) + days * 24 * 60 * 60 * 1000 + ms)
}

describe('backupReminder', () => {
  it('上次備份後沒有變更時不提醒：更新時間等於最近備份時間，過再久也不醒目', () => {
    const row = game({ updatedAt: BACKED_UP, lastBackupAt: BACKED_UP })
    expect(backupReminder(row, settings, true, after(BACKED_UP, 30))).toStrictEqual({
      neverBackedUp: false,
      unbacked: false,
      days: 30,
      overdue: false,
      notPersisted: false,
    })
  })

  it('更新時間晚於最近備份時間就是有未備份的變更，天數從上次備份算，只算完整的 24 小時', () => {
    const row = game({ updatedAt: '2026-09-10T00:00:00.001Z', lastBackupAt: BACKED_UP })
    const hours20 = 20 * 60 * 60 * 1000
    expect(backupReminder(row, settings, true, after(BACKED_UP, 3, hours20))).toStrictEqual({
      neverBackedUp: false,
      unbacked: true,
      days: 3,
      overdue: false,
      notPersisted: false,
    })
  })

  it('經過時間超過設定天數才醒目：剛好 7 天不算，多 1 毫秒就算（DATA-16）', () => {
    const row = game({ updatedAt: '2026-09-11T00:00:00.000Z', lastBackupAt: BACKED_UP })
    expect(backupReminder(row, settings, true, after(BACKED_UP, 7))).toMatchObject({
      days: 7,
      overdue: false,
    })
    expect(backupReminder(row, settings, true, after(BACKED_UP, 7, 1))).toMatchObject({
      days: 7,
      overdue: true,
    })
  })

  it('醒目的天數依這一局的設定', () => {
    const row = game({ updatedAt: '2026-09-11T00:00:00.000Z', lastBackupAt: BACKED_UP })
    const three = { ...settings, backupReminderDays: 3 }
    expect(backupReminder(row, three, true, after(BACKED_UP, 3, 1)).overdue).toBe(true)
    expect(backupReminder(row, settings, true, after(BACKED_UP, 3, 1)).overdue).toBe(false)
  })

  it('從未備份過時以建立時間當基準：剛建立的局不提醒，寫入後才提醒（DATA-18）', () => {
    expect(backupReminder(game(), settings, true, after(CREATED, 10))).toStrictEqual({
      neverBackedUp: true,
      unbacked: false,
      days: 10,
      overdue: false,
      notPersisted: false,
    })
    const written = game({ updatedAt: '2026-09-02T00:00:00.000Z' })
    expect(backupReminder(written, settings, true, after(CREATED, 10))).toStrictEqual({
      neverBackedUp: true,
      unbacked: true,
      days: 10,
      overdue: true,
      notPersisted: false,
    })
  })

  it('系統時鐘往回調到基準時間之前時天數為 0，不醒目', () => {
    const row = game({ updatedAt: '2026-09-11T00:00:00.000Z', lastBackupAt: BACKED_UP })
    expect(backupReminder(row, settings, true, after(BACKED_UP, -2))).toMatchObject({
      unbacked: true,
      days: 0,
      overdue: false,
    })
  })

  it('未取得持久保存時另外回報，不改變天數的規則（DATA-14）', () => {
    const row = game({ updatedAt: BACKED_UP, lastBackupAt: BACKED_UP })
    expect(backupReminder(row, settings, false, after(BACKED_UP, 1))).toStrictEqual({
      neverBackedUp: false,
      unbacked: false,
      days: 1,
      overdue: false,
      notPersisted: true,
    })
  })
})
