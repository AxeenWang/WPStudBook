import type { WPStudBookDatabase } from './database'
import { readRuleRows, ruleTables, type RuleRows } from './loaders'
import {
  assertBase,
  resolveAssignment,
  type AssignmentBlock,
  type MareAssignment,
} from './mare-assignment'
import type { Base, HorseRow, MareRow, WriteWarning } from './records'
import {
  confirmation,
  gate,
  prepareNewHorse,
  runWrite,
  type NewHorseBlock,
  type NewHorseInput,
  type WriteOptions,
  type WriteResult,
} from './writes'

// 市場母馬的寫入操作：新增與修改用途（需求規格 8.3、8.4；技術設計 4.3「寫入操作」）

/** 新增市場母馬的輸入 */
export interface MarketMareInput {
  horse: NewHorseInput
  assignment: MareAssignment
  /** 待指定用途時的來源：市場混血或其他，省略時為其他；從配對新增時由配對推出，不看這一欄 */
  sourceKind?: 'market-crossbreed' | 'other'
  /** 來源的備註；只有空白時不寫 */
  sourceNote?: string
  /** 據點；還不知道時留空 */
  location?: Base
  /** 例外補入的原因（需求規格 7.3）；不是例外補入時不保存 */
  exceptionReason?: string
}

/** 新增市場母馬的阻止原因：馬匹的輸入不符，或用途不符 */
export type AddMareBlock = NewHorseBlock | AssignmentBlock

/** 新增的母馬；parentSystemUnknown 為 true 時提示 8.3 無法判斷 */
export interface AddedMare {
  horse: HorseRow
  mare: MareRow
  parentSystemUnknown: boolean
}

/**
 * 新增市場母馬（需求規格 8.4、MARE-05、MARE-26、MARE-29、MARE-31）：馬匹照手動建立的馬，性別為牝；
 * 在圈，不使該代成立。用途與來源由 resolveAssignment 推出，待指定用途的來源由使用者選。
 * 已售出的母馬中，基本馬名相同、能力番号與出生年也不矛盾時，警告可能是買回（使用者確認不是買回才建立；
 * 是買回時畫面改用買回操作）。事件 mare-added。據點不是 32～35 時丟出錯誤。
 */
export async function addMarketMare(
  db: WPStudBookDatabase,
  gameId: string,
  input: MarketMareInput,
  options: WriteOptions = {},
): Promise<WriteResult<AddedMare, AddMareBlock>> {
  if (input.location !== undefined) assertBase(input.location)
  return runWrite(db, gameId, ruleTables(db), options, async (context) => {
    const rows = await readRuleRows(db, gameId, context.game)
    const prepared = await prepareNewHorse(context, input.horse, 'female')
    const resolved = resolveAssignment(
      rows,
      input.assignment,
      { sireSystem: prepared.ok ? prepared.value.sireSystem : undefined },
      input.exceptionReason,
    )
    if (!prepared.ok || !resolved.ok) {
      const blocks: AddMareBlock[] = [
        ...(prepared.ok ? [] : prepared.blocks),
        ...(resolved.ok ? [] : resolved.blocks),
      ]
      return { status: 'blocked', blocks }
    }
    const horse = prepared.value
    const { placement, sourceKind, exceptionReason, parentSystemUnknown } = resolved.value
    const buyback = buybackCandidates(rows, horse)
    const warnings: WriteWarning[] = [
      ...resolved.value.warnings,
      ...(buyback.length > 0 ? [{ kind: 'possible-buyback' as const, horseIds: buyback }] : []),
    ]
    const stop = gate([], warnings, context.confirmed)
    if (stop) return stop

    const note = input.sourceNote?.trim() ?? ''
    const mare: MareRow = {
      horseId: horse.id,
      gameId,
      ...placement,
      herd: 'in-herd',
      establishedGeneration: false,
      source: { kind: sourceKind ?? input.sourceKind ?? 'other', ...(note === '' ? {} : { note }) },
      ...(input.location === undefined ? {} : { location: input.location }),
      ...(exceptionReason === undefined ? {} : { exceptionReason }),
    }
    await db.horses.add(horse)
    await db.mares.add(mare)
    await context.addEvent({
      kind: 'mare-added',
      horseId: horse.id,
      placement,
      mareSource: mare.source,
      ...(exceptionReason === undefined ? {} : { exceptionReason }),
      ...confirmation(warnings),
    })
    return context.done({ horse, mare, parentSystemUnknown }, warnings)
  })
}

/**
 * 可能是買回的已售出母馬（需求規格 8.4、MARE-29）：基本馬名相同，
 * 能力番号與出生年也不矛盾（兩邊都有值而且不同才算矛盾）；依識別排序
 */
function buybackCandidates(rows: RuleRows, horse: HorseRow): string[] {
  const horses = new Map(rows.horses.map((row) => [row.id, row]))
  const differs = <T>(a: T | undefined, b: T | undefined) =>
    a !== undefined && b !== undefined && a !== b
  return rows.mares
    .filter((mare) => mare.herd === 'sold')
    .map((mare) => horses.get(mare.horseId))
    .filter(
      (sold): sold is HorseRow =>
        sold !== undefined &&
        sold.baseName === horse.baseName &&
        !differs(sold.abilityNumber, horse.abilityNumber) &&
        !differs(sold.birthYear, horse.birthYear),
    )
    .map((sold) => sold.id)
    .sort()
}
