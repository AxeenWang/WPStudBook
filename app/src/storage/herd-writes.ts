import { ageInYear } from '../core/mares'
import type { SisterStatus } from '../core/sisters'
import type { WPStudBookDatabase } from './database'
import { loadSettings } from './games'
import { loadSisters } from './loaders'
import type { HerdStatus, MareRow } from './records'
import { gate, runWrite, type WriteContext, type WriteOptions, type WriteResult } from './writes'

// 母馬的在圈狀態：賣出與更正離圈原因（需求規格 8.5、8.9；技術設計 4.3「寫入操作」）

/** 賣出的阻止原因：已達定年（需求規格 4.6「無法再生產的母馬不能賣出」）；age 是今年的馬齡 */
export interface SellBlock {
  kind: 'retirement-age'
  age: number
}

/**
 * 賣出母馬（需求規格 8.5、MARE-08）：在圈狀態改為售出；自家母駒的接替狀態保留離圈前的值（技術設計 4.2）。
 * 已達定年時阻止，出生年不明時可以賣出。這條只適用於手動賣出，五月缺席的判定由 CE 匯入計畫接上。
 * 事件 mare-departed。母馬找不到、屬於其他局或不在圈內時丟出錯誤。
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
    const { retirementAge } = await loadSettings(db, gameId)
    const blocks: SellBlock[] = []
    if (horse?.birthYear !== undefined) {
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
