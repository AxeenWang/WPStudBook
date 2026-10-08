import { normalizeAbilityNumber } from '../core/identity'
import type { WPStudBookDatabase } from './database'
import type { HorseNumberRow, HorseStage } from './records'
import {
  runWrite,
  type UnchangedBlock,
  type WriteContext,
  type WriteOptions,
  type WriteResult,
} from './writes'

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

/**
 * 匯入的階段馬番号（需求規格 6.4、MAY-06；技術設計 4.3「繁殖牝馬馬番号」）：五月配到的母馬記繁殖牝馬階段，
 * 由 applyImport 在匯入的交易內呼叫。以 recordHorseNumber 記一筆；同一階段已記過相同的馬番号時阻止
 * （預覽只為還沒記過的產生項目）。不寫事件，horseNumbers 本身就是歷程。
 * 馬匹找不到或屬於其他局時丟出錯誤；馬番号沒有統一寫法時丟出 RangeError
 */
export async function importHorseNumber(
  db: WPStudBookDatabase,
  gameId: string,
  horseId: string,
  stage: HorseStage,
  number: string,
  options: WriteOptions = {},
): Promise<WriteResult<HorseNumberRow, UnchangedBlock>> {
  return runWrite(db, gameId, [db.horses, db.horseNumbers], options, async (context) => {
    const horse = await db.horses.get(horseId)
    if (!horse || horse.gameId !== gameId) throw new Error(`找不到馬匹：${horseId}`)
    const row = await recordHorseNumber(context, horseId, stage, number)
    if (row === undefined) return { status: 'blocked', blocks: [{ kind: 'unchanged' }] }
    return context.done(row)
  })
}
