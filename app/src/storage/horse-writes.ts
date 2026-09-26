import type { WPStudBookDatabase } from './database'
import { buildRuleSnapshot, readRuleRows, ruleTables } from './loaders'
import { substituteWarnings, type SubstituteWarnings } from './mare-assignment'
import type { HorseFieldValues, HorseRow } from './records'
import { damRoleOf } from './snapshot'
import {
  checkHorseInput,
  confirmation,
  gate,
  manualHorseRow,
  runWrite,
  type NewHorseBlock,
  type NewHorseInput,
  type WriteOptions,
  type WriteResult,
} from './writes'

// 手動資料的更正（需求規格 6.4、ID-08、ID-13；技術設計 4.3「寫入操作」）

/** 手動資料更正的輸入：省略的欄位不變，null 表示清除；完整馬名不能清除 */
export interface HorseCorrectionInput {
  fullName?: string
  abilityNumber?: string | null
  birthYear?: number | null
  sireName?: string | null
  damName?: string | null
  sireSystem?: string | null
}

/** 手動資料更正的阻止原因：輸入不符（同手動建立的馬），或什麼都沒改 */
export type HorseCorrectionBlock = NewHorseBlock | { kind: 'unchanged' }

/** 更正後的馬匹；parentSystemUnknown 為 true 時提示 8.3 無法判斷 */
export interface CorrectedHorse {
  horse: HorseRow
  parentSystemUnknown: boolean
}

/** 可以更正、事件會記下的欄位 */
const FIELDS = [
  'fullName',
  'abilityNumber',
  'birthYear',
  'sireName',
  'damName',
  'sireSystem',
] as const

/**
 * 更正手動輸入、尚未經匯入確認的馬匹資料（需求規格 6.4、ID-08、ID-13）：只限這一局沒有出生紀錄、
 * 馬名還是手動輸入的市場馬（市場母馬與零代市場種牡馬）。檢查同手動建立的馬（checkHorseInput），
 * 同一匹馬的比對排除自己；什麼都沒改時阻止。基本馬名跟著完整馬名重算；父母名或父系還有值時來源維持手動。
 * 替代母馬的自身父系改了時重做 8.3 檢查；零代市場種牡馬改了父系時不重做 7.7 的比對
 * （只在補入或替換當下比對，要改系的名稱用系統名稱變更）。
 * 事件 horse-corrected 只記有改的欄位的原值與新值，沒有值記 null。
 * 馬匹找不到、屬於其他局、有出生紀錄或經匯入確認時丟出錯誤。
 */
export async function correctHorse(
  db: WPStudBookDatabase,
  gameId: string,
  horseId: string,
  input: HorseCorrectionInput,
  options: WriteOptions = {},
): Promise<WriteResult<CorrectedHorse, HorseCorrectionBlock>> {
  return runWrite(db, gameId, ruleTables(db), options, async (context) => {
    const current = await db.horses.get(horseId)
    if (!current || current.gameId !== gameId) throw new Error(`找不到馬匹：${horseId}`)
    if (current.birth !== undefined || current.nameSource !== 'manual') {
      throw new Error(`只有手動輸入、尚未經匯入確認的市場馬可以更正：${horseId}`)
    }
    const checked = await checkHorseInput(context, mergedInput(current, input), horseId)
    const blocks: HorseCorrectionBlock[] = checked.ok ? [] : [...checked.blocks]
    const next = checked.ok ? corrected(current, checked.value) : current
    const changed = FIELDS.filter((field) => current[field] !== next[field])
    if (checked.ok && changed.length === 0) blocks.push({ kind: 'unchanged' })
    if (blocks.length > 0) return { status: 'blocked', blocks }

    const check = changed.includes('sireSystem')
      ? await recheckSubstitute(context.db, gameId, next)
      : { warnings: [], parentSystemUnknown: false }
    const stop = gate([], check.warnings, context.confirmed)
    if (stop) return stop
    await db.horses.put(next)
    const values = (row: HorseRow) =>
      Object.fromEntries(changed.map((field) => [field, row[field] ?? null])) as HorseFieldValues
    await context.addEvent({
      kind: 'horse-corrected',
      horseId,
      from: values(current),
      to: values(next),
      ...confirmation(check.warnings),
    })
    return context.done(
      { horse: next, parentSystemUnknown: check.parentSystemUnknown },
      check.warnings,
    )
  })
}

/** 更正後的完整輸入：省略的欄位用目前的值，null 表示清除 */
function mergedInput(current: HorseRow, input: HorseCorrectionInput): NewHorseInput {
  const pick = <T>(change: T | null | undefined, value: T | undefined) =>
    change === undefined ? value : (change ?? undefined)
  return {
    fullName: input.fullName ?? current.fullName ?? '',
    abilityNumber: pick(input.abilityNumber, current.abilityNumber),
    birthYear: pick(input.birthYear, current.birthYear),
    sireName: pick(input.sireName, current.sireName),
    damName: pick(input.damName, current.damName),
    sireSystem: pick(input.sireSystem, current.sireSystem),
  }
}

/** 換上更正後欄位的資料列：手動欄位與它們的來源重新組出，其他欄位（性別、父母的連結等）不變 */
function corrected(current: HorseRow, fields: Parameters<typeof manualHorseRow>[2]): HorseRow {
  const rest: HorseRow = { ...current }
  delete rest.abilityNumber
  delete rest.birthYear
  delete rest.sireName
  delete rest.damName
  delete rest.sireSystem
  delete rest.pedigreeSource
  return { ...rest, ...manualHorseRow(current.gameId, current.id, fields, current.sex) }
}

/** 替代母馬的自身父系改了時重做 8.3 親系統檢查；不是替代母馬時沒有警告 */
async function recheckSubstitute(
  db: WPStudBookDatabase,
  gameId: string,
  horse: HorseRow,
): Promise<SubstituteWarnings> {
  const rows = await readRuleRows(db, gameId)
  const mare = rows.mares.find((row) => row.horseId === horse.id)
  const role = mare ? damRoleOf(mare) : null
  if (role?.kind !== 'substitute') return { warnings: [], parentSystemUnknown: false }
  return substituteWarnings(rows, buildRuleSnapshot(rows), role.forLine, role.forGeneration, {
    horseId: horse.id,
    sireSystem: horse.sireSystem,
  })
}
