import type { WPStudBookDatabase } from './database'
import type { MatingGrade, MatingRatingRow, MatingRatingValue } from './records'
import {
  loadMare,
  resolveSire,
  runWrite,
  sameSire,
  type SireInput,
  type SireNameBlock,
  type UnchangedBlock,
  type WriteOptions,
  type WriteResult,
} from './writes'

// 總合評價與爆發力的寫入操作（需求規格 9.2；技術設計 4.3「寫入操作」）

/** 評價的輸入：種牡馬，以及總合評價與爆發力（至少一項） */
export interface MatingRatingInput {
  sire: SireInput
  grade?: MatingGrade
  /** 爆發力：0 以上的整數 */
  burst?: number
}

/**
 * 評價的阻止原因：
 * - empty：總合評價與爆發力都沒有填
 * - burst：爆發力不是 0 以上的整數（BRD-23）
 * - sire-name：種牡馬的外部名稱空白或只有前綴
 * - unchanged：和目前相同
 */
export type RatingBlock = { kind: 'empty' } | { kind: 'burst' } | SireNameBlock | UnchangedBlock

/** 總合評價的五個等級 */
const GRADES: readonly MatingGrade[] = ['S', 'A', 'B', 'C', 'D']

/**
 * 登記或編輯一組種牡馬＋繁殖牝馬今年的總合評價與爆發力（需求規格 9.2、BRD-17、BRD-18、BRD-23）：
 * 記在目前遊戲年；母馬要是這一局的母馬，不限在圈；種牡馬是內部馬匹或外部名稱（去掉前綴存基本馬名），
 * 同一匹種牡馬以內部識別與外部名稱登記時算不同的組合。同一組同一年已有時整組取代，和目前相同時阻止；
 * 跨年另起一列，舊值保留。事件 mating-rated 記原值與新值。
 * 母馬找不到或屬於其他局、種牡馬是找不到或屬於其他局的馬匹或牝馬、總合評價不是 S～D 時丟出錯誤。
 */
export async function rateMating(
  db: WPStudBookDatabase,
  gameId: string,
  mareId: string,
  input: MatingRatingInput,
  options: WriteOptions = {},
): Promise<WriteResult<MatingRatingRow, RatingBlock>> {
  if (input.grade !== undefined && !GRADES.includes(input.grade)) {
    throw new Error(`總合評價不符：${input.grade}`)
  }
  return runWrite(db, gameId, [db.mares, db.horses, db.matingRatings], options, async (context) => {
    await loadMare(context, mareId)
    const { grade, burst } = input
    const sire = await resolveSire(context, input.sire)
    const blocks: RatingBlock[] = []
    if (grade === undefined && burst === undefined) blocks.push({ kind: 'empty' })
    if (burst !== undefined && !(Number.isInteger(burst) && burst >= 0)) {
      blocks.push({ kind: 'burst' })
    }
    if (!sire.ok) blocks.push(...sire.blocks)
    if (!sire.ok || blocks.length > 0) return { status: 'blocked', blocks }
    const year = context.game.currentYear
    const current = await db.matingRatings
      .where('[gameId+mareId]')
      .equals([gameId, mareId])
      .filter((row) => row.year === year && sameSire(row, sire.value))
      .first()
    if (current && current.grade === grade && current.burst === burst) {
      blocks.push({ kind: 'unchanged' })
      return { status: 'blocked', blocks }
    }
    const to: MatingRatingValue = {
      ...(grade === undefined ? {} : { grade }),
      ...(burst === undefined ? {} : { burst }),
    }
    const rating: MatingRatingRow = {
      id: current?.id ?? crypto.randomUUID(),
      gameId,
      mareId,
      ...sire.value,
      year,
      ...to,
    }
    await db.matingRatings.put(rating)
    await context.addEvent({
      kind: 'mating-rated',
      horseId: mareId,
      ratingId: rating.id,
      ...(current ? { from: ratingValue(current) } : {}),
      to,
    })
    return context.done(rating)
  })
}

/** 評價的內容：總合評價與爆發力，沒有值的不列 */
function ratingValue(row: MatingRatingRow): MatingRatingValue {
  return {
    ...(row.grade === undefined ? {} : { grade: row.grade }),
    ...(row.burst === undefined ? {} : { burst: row.burst }),
  }
}
