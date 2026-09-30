import type { GameRow, SettingsRow } from './records'

/** 一天的毫秒數：天數以經過時間計，不以日曆日計 */
const DAY_MS = 24 * 60 * 60 * 1000

/** 一局的備份提醒（需求規格 12.2、DATA-14、DATA-16、DATA-18） */
export interface BackupReminder {
  /** 從未備份過：沒有最近備份時間 */
  neverBackedUp: boolean
  /** 有未備份的變更：更新時間晚於基準時間（最近備份時間，沒有時用建立時間） */
  unbacked: boolean
  /** 基準時間到現在經過的完整天數（24 小時為一天）；系統時鐘往回調時為 0 */
  days: number
  /** 醒目提示：有未備份的變更，且經過時間超過設定的備份提醒天數 */
  overdue: boolean
  /** 未取得持久保存：提醒區常駐顯示說明，不影響天數的判斷 */
  notPersisted: boolean
}

/**
 * 算出一局的備份提醒（技術設計 4.3「瀏覽器整合」）。基準時間是最近備份時間，從未備份時用建立時間，
 * 所以剛建立、還沒寫入的局不提醒。時間都是 toISOString() 的字串，直接比較先後；
 * 天數以經過時間計，不受時區影響。persisted 是 requestPersistence 的結果
 */
export function backupReminder(
  game: GameRow,
  settings: SettingsRow,
  persisted: boolean,
  now: Date = new Date(),
): BackupReminder {
  const baseline = game.lastBackupAt ?? game.createdAt
  const unbacked = game.updatedAt > baseline
  const elapsed = now.getTime() - Date.parse(baseline)
  return {
    neverBackedUp: game.lastBackupAt === undefined,
    unbacked,
    days: Math.max(0, Math.floor(elapsed / DAY_MS)),
    overdue: unbacked && elapsed > settings.backupReminderDays * DAY_MS,
    notPersisted: !persisted,
  }
}
