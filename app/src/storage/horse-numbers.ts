import { normalizeAbilityNumber } from '../core/identity'
import type { HorseNumberRow, HorseStage } from './records'
import type { WriteContext } from './writes'

// 階段馬番号（需求規格 6.4；技術設計 4.3「資料表」）

/**
 * 記一筆階段馬番号（需求規格 6.4）：年份為目前遊戲年，來源與時點取自這次操作。
 * 同一匹馬同一階段已有相同馬番号時不再記，回傳 undefined（MAY-06）。
 * number 要是已統一寫法的馬番号（normalizeAbilityNumber 的結果），不是時丟出 RangeError。
 * 在 runWrite 的交易內呼叫，交易要包含 horseNumbers
 */
export async function recordHorseNumber(
  context: WriteContext,
  horseId: string,
  stage: HorseStage,
  number: string,
): Promise<HorseNumberRow | undefined> {
  if (normalizeAbilityNumber(number) !== number) {
    throw new RangeError(`馬番号沒有統一寫法：${number}`)
  }
  const { db, game } = context
  const existing = await db.horseNumbers
    .where('[gameId+horseId]')
    .equals([game.id, horseId])
    .filter((row) => row.stage === stage && row.number === number)
    .first()
  if (existing) return undefined
  const row: HorseNumberRow = {
    id: crypto.randomUUID(),
    gameId: game.id,
    horseId,
    stage,
    number,
    year: game.currentYear,
    source: context.source,
    ...(context.timing === undefined ? {} : { timing: context.timing }),
  }
  await db.horseNumbers.add(row)
  return row
}
