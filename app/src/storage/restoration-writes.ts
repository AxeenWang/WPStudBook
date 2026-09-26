import { checkRestoration, type RestorationBlock } from '../core/board'
import type { LinePosition } from '../core/lines'
import type { WPStudBookDatabase } from './database'
import { buildRuleSnapshot, readRuleRows, ruleTables } from './loaders'
import type { RestorationRow } from './records'
import { gate, runWrite, type WriteOptions, type WriteResult } from './writes'

// 斷血補系的寫入操作：宣告與撤銷（需求規格 7.6；技術設計 4.3「寫入操作」）

/** 宣告斷血補系的輸入 */
export interface RestorationInput {
  line: LinePosition
  /** 斷血的代數 */
  generation: number
  /** 斷掉的一方：公系或母系 */
  side: RestorationRow['side']
  /** 原因；必填 */
  reason: string
}

/**
 * 宣告斷血補系的阻止原因：
 * - rule：與八系現況矛盾，rule 是 core 的 checkRestoration 回傳的原因（技術設計 4.2「宣告補系的檢查」）
 * - blank-reason：原因空白
 */
export type DeclareRestorationBlock =
  { kind: 'rule'; rule: RestorationBlock } | { kind: 'blank-reason' }

/**
 * 宣告斷血補系（需求規格 7.6）：在交易內組出八系快照，以 core 的 checkRestoration 檢查；
 * 原因必填，年度為目前遊戲年。寫入宣告與事件 restoration-declared。
 * 補公系補入的零代市場種牡馬另外以 assignZeroStallion 選定。
 * 斷血代數不是 0 以上的整數時，core 丟出的 RangeError 照原樣往上丟。
 */
export async function declareRestoration(
  db: WPStudBookDatabase,
  gameId: string,
  input: RestorationInput,
  options: WriteOptions = {},
): Promise<WriteResult<RestorationRow, DeclareRestorationBlock>> {
  return runWrite(db, gameId, ruleTables(db), options, async (context) => {
    const { eightLines } = buildRuleSnapshot(await readRuleRows(db, gameId, context.game))
    const declaration = { line: input.line, generation: input.generation, side: input.side }
    const blocks = checkRestoration(eightLines, declaration).map(
      (rule): DeclareRestorationBlock => ({ kind: 'rule', rule }),
    )
    const reason = input.reason.trim()
    if (reason === '') blocks.push({ kind: 'blank-reason' })
    const stop = gate(blocks, [], context.confirmed)
    if (stop) return stop
    const row: RestorationRow = {
      id: crypto.randomUUID(),
      gameId,
      ...declaration,
      reason,
      year: context.game.currentYear,
      revoked: false,
    }
    await db.restorations.add(row)
    await context.addEvent({
      kind: 'restoration-declared',
      line: row.line,
      restorationId: row.id,
      generation: row.generation,
      side: row.side,
      reason,
    })
    return context.done(row)
  })
}

/**
 * 撤銷斷血補系宣告（使用者更正，需求規格 7.6）：設為已撤銷並寫事件 restoration-revoked，宣告的紀錄保留（5.3）。
 * 不因已有補系的配種或產駒而阻止：配種紀錄的規則快照自帶補公系標記，補入的任用留著，
 * 八系快照略過已撤銷宣告底下的任用。撤銷後可以重新宣告同一系同一代同一方。
 * 宣告找不到、屬於其他局或已經撤銷時丟出錯誤（畫面只列出未撤銷的宣告）。
 */
export async function revokeRestoration(
  db: WPStudBookDatabase,
  gameId: string,
  restorationId: string,
  options: WriteOptions = {},
): Promise<WriteResult<RestorationRow, never>> {
  return runWrite(db, gameId, [db.restorations], options, async (context) => {
    const current = await db.restorations.get(restorationId)
    if (!current || current.gameId !== gameId) {
      throw new Error(`找不到補系宣告：${restorationId}`)
    }
    if (current.revoked) throw new Error(`補系宣告已經撤銷：${restorationId}`)
    const next = { ...current, revoked: true }
    await db.restorations.put(next)
    await context.addEvent({ kind: 'restoration-revoked', line: current.line, restorationId })
    return context.done(next)
  })
}
