import type { WPStudBookDatabase } from './database'
import type { MarePlan, MareRow, MareYearRow, Vigor, VigorMonth } from './records'
import { runWrite, type WriteContext, type WriteOptions, type WriteResult } from './writes'

// 母馬年度資料的寫入操作：今年計畫與活力的人工更正（需求規格 8.7；技術設計 4.3「寫入操作」）

/** 和目前相同時的阻止原因 */
export interface UnchangedYearBlock {
  kind: 'unchanged'
}

/**
 * 設定今年計畫（需求規格 8.7、MARE-22）：年份為目前遊戲年，那一年的資料列不存在時新增；
 * 沒有值視為待定，和目前相同時阻止。不限用途。事件 mare-plan-changed 記原計畫與新計畫。
 * 母馬找不到、屬於其他局或不在圈內時丟出錯誤。
 */
export async function setMarePlan(
  db: WPStudBookDatabase,
  gameId: string,
  horseId: string,
  plan: MarePlan,
  options: WriteOptions = {},
): Promise<WriteResult<MareYearRow, UnchangedYearBlock>> {
  return runWrite(db, gameId, [db.mares, db.mareYears], options, async (context) => {
    const mare = await loadMare(context, horseId)
    if (mare.herd !== 'in-herd') throw new Error(`不在繁殖圈內的母馬沒有今年計畫：${horseId}`)
    const current = await loadYear(context, horseId, context.game.currentYear)
    if ((current.plan ?? 'pending') === plan) {
      return { status: 'blocked', blocks: [{ kind: 'unchanged' }] }
    }
    const next: MareYearRow = { ...current, plan }
    await db.mareYears.put(next)
    await context.addEvent({
      kind: 'mare-plan-changed',
      horseId,
      ...(current.plan === undefined ? {} : { from: current.plan }),
      to: plan,
    })
    return context.done(next)
  })
}

/** 活力的人工更正：哪一年、五月或七月的快照，以及新的值 */
export interface VigorCorrection {
  year: number
  month: VigorMonth
  vigor: Vigor
}

/**
 * 活力更正的阻止原因：
 * - vigor-range：數值不是 0～100 的整數
 * - year：年份不是整數，或晚於目前遊戲年
 * - unchanged：和目前相同
 */
export type VigorBlock = { kind: 'vigor-range' } | { kind: 'year' } | { kind: 'unchanged' }

/**
 * 活力快照的人工更正（需求規格 8.7、MARE-13、MARE-14）：數值是 0～100 的整數，是否増強另外指定
 * （100 也可以不増強）；年份不能晚於目前遊戲年。快照原本沒有值時也可以填入，不提供清除；和目前相同時阻止。
 * 事件 vigor-corrected 記快照的年份、月份、原值與新值。
 * 月份不是五月或七月（畫面只提供這兩個），或母馬找不到、屬於其他局時丟出錯誤。
 */
export async function correctVigor(
  db: WPStudBookDatabase,
  gameId: string,
  horseId: string,
  correction: VigorCorrection,
  options: WriteOptions = {},
): Promise<WriteResult<MareYearRow, VigorBlock>> {
  if (correction.month !== 5 && correction.month !== 7) {
    throw new Error(`活力快照的月份不符：${correction.month}`)
  }
  return runWrite(db, gameId, [db.mares, db.mareYears], options, async (context) => {
    await loadMare(context, horseId)
    const { year, month, vigor } = correction
    const blocks: VigorBlock[] = []
    if (!(Number.isInteger(vigor.value) && vigor.value >= 0 && vigor.value <= 100)) {
      blocks.push({ kind: 'vigor-range' })
    }
    const yearValid = Number.isInteger(year) && year <= context.game.currentYear
    if (!yearValid) blocks.push({ kind: 'year' })
    if (blocks.length > 0) return { status: 'blocked', blocks }
    const current = await loadYear(context, horseId, year)
    const field = month === 5 ? 'mayVigor' : 'julyVigor'
    const from = current[field]
    if (from?.value === vigor.value && from.boosted === vigor.boosted) {
      return { status: 'blocked', blocks: [{ kind: 'unchanged' }] }
    }
    const to: Vigor = { value: vigor.value, boosted: vigor.boosted }
    const next: MareYearRow = { ...current, [field]: to }
    await db.mareYears.put(next)
    await context.addEvent({
      kind: 'vigor-corrected',
      horseId,
      snapshotYear: year,
      month,
      ...(from === undefined ? {} : { from }),
      to,
    })
    return context.done(next)
  })
}

/** 這一局的母馬；找不到或屬於其他局時丟出錯誤 */
async function loadMare(context: WriteContext, horseId: string): Promise<MareRow> {
  const mare = await context.db.mares.get(horseId)
  if (!mare || mare.gameId !== context.game.id) throw new Error(`找不到母馬：${horseId}`)
  return mare
}

/** 母馬某一年的資料列；還沒有時是只有鍵的新列 */
async function loadYear(
  context: WriteContext,
  horseId: string,
  year: number,
): Promise<MareYearRow> {
  const gameId = context.game.id
  return (await context.db.mareYears.get([gameId, horseId, year])) ?? { gameId, horseId, year }
}
