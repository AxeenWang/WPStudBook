import { ageInYear } from '../core/mares'
import { entrySisterStatus, type SisterStatus } from '../core/sisters'
import type { WPStudBookDatabase } from './database'
import { loadSettings } from './games'
import { buildOwnMares } from './inputs'
import { loadSisters, readRuleRows, ruleTables, type RuleRows } from './loaders'
import {
  assertBase,
  placementOf,
  resolveAssignment,
  samePlacement,
  withPlacement,
  type AssignmentBlock,
  type MareAssignment,
} from './mare-assignment'
import type { Base, HerdStatus, MareRow } from './records'
import { ownSisterStatus } from './snapshot'
import {
  confirmation,
  gate,
  runWrite,
  type WriteContext,
  type WriteOptions,
  type WriteResult,
} from './writes'

// 母馬的在圈狀態與據點：賣出、更正離圈原因、買回與轉場（需求規格 8.5、8.6、8.9；技術設計 4.3「寫入操作」）

/** 賣出的阻止原因：已達定年（需求規格 4.6「無法再生產的母馬不能賣出」）；age 是今年的馬齡 */
export interface SellBlock {
  kind: 'retirement-age'
  age: number
}

/**
 * 賣出母馬（需求規格 8.5、MARE-08）：在圈狀態改為售出；自家母駒的接替狀態保留離圈前的值（技術設計 4.2）。
 * 已達定年時阻止，出生年不明時可以賣出。這條只適用於手動賣出，五月缺席的判定由 CE 匯入計畫接上。
 * 事件 mare-departed。母馬或她的馬匹找不到、屬於其他局，或母馬不在圈內時丟出錯誤。
 */
export async function sellMare(
  db: WPStudBookDatabase,
  gameId: string,
  horseId: string,
  options: WriteOptions = {},
): Promise<WriteResult<MareRow, SellBlock>> {
  return runWrite(db, gameId, [db.mares, db.horses, db.settings], options, async (context) => {
    const current = await loadMare(context, horseId)
    if (current.herd !== 'in-herd') throw new Error(`不在繁殖圈內的母馬不能賣出：${horseId}`)
    const horse = await db.horses.get(horseId)
    if (!horse) throw new Error(`找不到馬匹：${horseId}`)
    const { retirementAge } = await loadSettings(db, gameId)
    const blocks: SellBlock[] = []
    if (horse.birthYear !== undefined) {
      const age = ageInYear(horse.birthYear, context.game.currentYear)
      if (age >= retirementAge) blocks.push({ kind: 'retirement-age', age })
    }
    const stop = gate(blocks, [], context.confirmed)
    if (stop) return stop
    const mare: MareRow = { ...current, herd: 'sold' }
    await db.mares.put(mare)
    await context.addEvent({ kind: 'mare-departed', horseId, reason: 'sold' })
    return context.done(mare)
  })
}

/** 和目前相同時的阻止原因 */
export interface UnchangedBlock {
  kind: 'unchanged'
}

/**
 * 更正離圈原因（需求規格 8.5「可人工更正」、11.5、MARE-32）：已離圈的母馬改為售出、定年引退，
 * 或撤銷回到生產中（誤登記時用，不建立回歸事件）；和目前相同時阻止。
 * 撤銷時自家母駒回到保留的接替狀態（技術設計 4.2）；原本是正式保留、而圈內已有另一匹正式保留的姊妹時
 * 改為候選，維持同一父母組合只有一匹正式保留（8.9）。事件 mare-departure-corrected。
 * 母馬找不到、屬於其他局或還在圈內時丟出錯誤。
 */
export async function correctDeparture(
  db: WPStudBookDatabase,
  gameId: string,
  horseId: string,
  to: HerdStatus,
  options: WriteOptions = {},
): Promise<WriteResult<MareRow, UnchangedBlock>> {
  return runWrite(db, gameId, [db.mares, db.horses], options, async (context) => {
    const current = await loadMare(context, horseId)
    const from = current.herd
    if (from === 'in-herd') throw new Error(`母馬在繁殖圈內，沒有離圈可以更正：${horseId}`)
    const blocks: UnchangedBlock[] = to === from ? [{ kind: 'unchanged' }] : []
    const stop = gate(blocks, [], context.confirmed)
    if (stop) return stop
    const sisterStatus = to === 'in-herd' ? await revokedSisterStatus(context, current) : undefined
    const mare: MareRow = {
      ...current,
      herd: to,
      ...(sisterStatus === undefined ? {} : { sisterStatus: sisterStatus.to }),
    }
    await db.mares.put(mare)
    await context.addEvent({
      kind: 'mare-departure-corrected',
      horseId,
      from,
      to,
      ...(sisterStatus === undefined ? {} : { sisterStatus }),
    })
    return context.done(mare)
  })
}

/** 這一局的母馬；找不到或屬於其他局時丟出錯誤 */
async function loadMare(context: WriteContext, horseId: string): Promise<MareRow> {
  const mare = await context.db.mares.get(horseId)
  if (!mare || mare.gameId !== context.game.id) throw new Error(`找不到母馬：${horseId}`)
  return mare
}

/**
 * 撤銷離圈時自家母駒的接替狀態變化：原本是正式保留、而圈內已有另一匹正式保留的姊妹時改為候選；
 * 其他情況不變，回傳 undefined。她自己還在圈外，不會算到自己
 */
async function revokedSisterStatus(
  context: WriteContext,
  mare: MareRow,
): Promise<{ from: SisterStatus; to: SisterStatus } | undefined> {
  if (mare.usage !== 'own' || mare.sisterStatus !== 'kept') return undefined
  const horse = await context.db.horses.get(mare.horseId)
  const sisters = await loadSisters(context.db, context.game.id, horse?.sireId, horse?.damId)
  const keptInHerd = sisters.some((sister) => sister.inHerd && sister.status === 'kept')
  return keptInHerd ? { from: 'kept', to: 'candidate' } : undefined
}

/** 買回與回歸的輸入 */
export interface ReturnMareInput {
  /** 從任務買回時的新用途；只限市場母馬，省略時沿用原用途 */
  assignment?: MareAssignment
  /** 改成例外補入時的原因（需求規格 7.3）；不是例外補入時不保存 */
  exceptionReason?: string
  /** 回到的據點；省略時不變 */
  location?: Base
}

/** 買回後的母馬；parentSystemUnknown 為 true 時提示 8.3 無法判斷 */
export interface ReturnedMare {
  mare: MareRow
  parentSystemUnknown: boolean
}

/**
 * 已離圈（售出或定年引退）的母馬買回或回歸（需求規格 8.5、8.9、ID-04、MARE-29、MARE-30、CAND-07）：
 * 恢復生產中，沿用原識別與血緣。自家母駒沿用出生紀錄的系與代數，接替狀態以 entrySisterStatus 重新判定
 * （其他姊妹都不在圈 → 暫定保留；仍有姊妹在圈 → 候選），成為暫定保留時 establishedGeneration 設為 true；
 * 自由配種所生只恢復生產中。市場母馬沒有傳用途時沿用原用途，不重做 8.3 檢查；從任務買回時傳配對，
 * 照 resolveAssignment 處理。可以一併填據點。事件 mare-returned 記原離圈狀態，以及接替狀態、用途與據點的變化。
 * 母馬找不到、屬於其他局或還在圈內、自家母駒或自由配種所生傳了用途、據點不是 32～35 時丟出錯誤。
 */
export async function returnMare(
  db: WPStudBookDatabase,
  gameId: string,
  horseId: string,
  input: ReturnMareInput = {},
  options: WriteOptions = {},
): Promise<WriteResult<ReturnedMare, AssignmentBlock>> {
  if (input.location !== undefined) assertBase(input.location)
  return runWrite(db, gameId, ruleTables(db), options, async (context) => {
    const rows = await readRuleRows(db, gameId, context.game)
    const current = rows.mares.find((row) => row.horseId === horseId)
    if (!current) throw new Error(`找不到母馬：${horseId}`)
    const from = current.herd
    if (from === 'in-herd') throw new Error(`母馬在繁殖圈內，不能買回：${horseId}`)
    const own = current.usage === 'own' || current.usage === 'free'
    if (own && input.assignment !== undefined) {
      throw new Error(`自家母駒與自由配種所生的母馬沿用出生紀錄，不接受用途：${horseId}`)
    }
    const horse = rows.horses.find((row) => row.id === horseId)
    const resolved =
      input.assignment === undefined
        ? undefined
        : resolveAssignment(
            rows,
            input.assignment,
            { horseId, sireSystem: horse?.sireSystem },
            input.exceptionReason,
          )
    if (resolved && !resolved.ok) return { status: 'blocked', blocks: resolved.blocks }
    const assigned = resolved?.value
    const warnings = assigned?.warnings ?? []
    const stop = gate([], warnings, context.confirmed)
    if (stop) return stop

    const sisterStatus = current.usage === 'own' ? reenteredSisterStatus(rows, current) : undefined
    const location = locationChange(current.location, input.location)
    const placed = assigned
      ? withPlacement(current, assigned.placement, assigned.exceptionReason)
      : current
    const mare: MareRow = {
      ...placed,
      herd: 'in-herd',
      ...(sisterStatus === undefined ? {} : { sisterStatus: sisterStatus.to }),
      ...(sisterStatus?.to === 'provisional' ? { establishedGeneration: true } : {}),
      ...(location === undefined ? {} : { location: location.to }),
    }
    const previous = placementOf(current)
    const usage =
      assigned && !samePlacement(previous, assigned.placement)
        ? { from: previous, to: assigned.placement }
        : undefined
    await db.mares.put(mare)
    await context.addEvent({
      kind: 'mare-returned',
      horseId,
      from,
      ...(sisterStatus === undefined ? {} : { sisterStatus }),
      ...(usage === undefined ? {} : { usage }),
      ...(assigned?.exceptionReason === undefined
        ? {}
        : { exceptionReason: assigned.exceptionReason }),
      ...(location === undefined ? {} : { location }),
      ...confirmation(warnings),
    })
    return context.done(
      { mare, parentSystemUnknown: assigned?.parentSystemUnknown ?? false },
      warnings,
    )
  })
}

/**
 * 自家母駒回到繁殖圈時重新判定的接替狀態（需求規格 8.9）：
 * 其他姊妹都不在圈 → 暫定保留；仍有姊妹在圈 → 候選
 */
function reenteredSisterStatus(
  rows: RuleRows,
  mare: MareRow,
): { from: SisterStatus; to: SisterStatus } {
  const horse = rows.horses.find((row) => row.id === mare.horseId)
  const to = entrySisterStatus(
    { id: mare.horseId, sireId: horse?.sireId, damId: horse?.damId },
    buildOwnMares(rows.mares, rows.horses),
  )
  return { from: ownSisterStatus(mare), to }
}

/** 據點的變化：沒有填新據點或和目前相同時為 undefined；原本不知道據點時沒有 from */
export function locationChange(
  current: Base | undefined,
  next: Base | undefined,
): { from?: Base; to: Base } | undefined {
  if (next === undefined || next === current) return undefined
  return current === undefined ? { to: next } : { from: current, to: next }
}

/**
 * 轉場（需求規格 8.6、MARE-19）：在圈的母馬換據點；和目前相同時阻止。
 * 事件 mare-moved 記原據點（原本不知道時留空）與新據點；年份、時點與來源在事件的共用欄位，
 * 由呼叫端以 WriteOptions 帶入。母馬找不到、屬於其他局或不在圈內，或據點不是 32～35 時丟出錯誤。
 */
export async function moveMare(
  db: WPStudBookDatabase,
  gameId: string,
  horseId: string,
  location: Base,
  options: WriteOptions = {},
): Promise<WriteResult<MareRow, UnchangedBlock>> {
  assertBase(location)
  return runWrite(db, gameId, [db.mares], options, async (context) => {
    const current = await loadMare(context, horseId)
    if (current.herd !== 'in-herd') throw new Error(`不在繁殖圈內的母馬不能轉場：${horseId}`)
    const change = locationChange(current.location, location)
    if (!change) return { status: 'blocked', blocks: [{ kind: 'unchanged' }] }
    const mare: MareRow = { ...current, location }
    await db.mares.put(mare)
    await context.addEvent({ kind: 'mare-moved', horseId, ...change })
    return context.done(mare)
  })
}
