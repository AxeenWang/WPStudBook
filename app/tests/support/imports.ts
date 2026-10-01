import { ANNUAL_TIMINGS, isAnnualImport } from '../../src/core/imports'
import type { ImportRecord, ImportType } from '../../src/core/imports'
import { GAME } from './rows'

/**
 * 一筆匯入紀錄：年度匯入的時點取類型固定的時點，其他類型沒有時點；雜湊是 `sha-` 加識別。
 * 套用時間都相同，要分先後的測試另外指定；其他欄位依需要覆寫
 */
export function importRecord(
  id: string,
  type: ImportType,
  year: number,
  fields: Partial<ImportRecord> = {},
): ImportRecord {
  return {
    id,
    gameId: GAME,
    type,
    year,
    ...(isAnnualImport(type) ? { timing: ANNUAL_TIMINGS[type] } : {}),
    fileName: `${year}_${type}.txt`,
    sha256: `sha-${id}`,
    appliedAt: '2026-10-01T00:00:00.000Z',
    mode: 'normal',
    summary: { total: 0, applied: 0, skipped: 0 },
    ...fields,
  }
}
