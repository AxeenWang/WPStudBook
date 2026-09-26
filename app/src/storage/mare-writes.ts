import type { WPStudBookDatabase } from './database'
import { readRuleRows, ruleTables, type RuleRows } from './loaders'
import {
  assertBase,
  placementOf,
  resolveAssignment,
  samePlacement,
  withPlacement,
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

/** 修改用途的輸入 */
export interface MareUsageInput {
  assignment: MareAssignment
  /** 改成例外補入時的原因（需求規格 7.3）；不是例外補入時不保存 */
  exceptionReason?: string
}

/** 修改用途的阻止原因：用途不符，或和目前相同 */
export type MareUsageBlock = AssignmentBlock | { kind: 'unchanged' }

/** 修改用途後的母馬；parentSystemUnknown 為 true 時提示 8.3 無法判斷 */
export interface ChangedMare {
  mare: MareRow
  parentSystemUnknown: boolean
}

/**
 * 修改市場母馬的用途（需求規格 8.4、MARE-28）：改掛到另一條配對，或改為待指定用途；
 * 用途的解析、例外補入與 8.3 檢查同新增，8.3 不和她自己比較。和目前相同時阻止。
 * 來源記的是購入時的目的（8.1），不隨用途改變；已有的配種紀錄保留自己的規則快照，新用途從下一次配種生效。
 * 事件 mare-usage-changed 記原用途與新用途。
 * 母馬找不到、屬於其他局、不是市場母馬（自家母駒、自由配種所生）或不在圈內時丟出錯誤。
 */
export async function changeMareUsage(
  db: WPStudBookDatabase,
  gameId: string,
  horseId: string,
  input: MareUsageInput,
  options: WriteOptions = {},
): Promise<WriteResult<ChangedMare, MareUsageBlock>> {
  return runWrite(db, gameId, ruleTables(db), options, async (context) => {
    const rows = await readRuleRows(db, gameId, context.game)
    const current = marketMareInHerd(rows, horseId)
    const horse = rows.horses.find((row) => row.id === horseId)
    const resolved = resolveAssignment(
      rows,
      input.assignment,
      { horseId, sireSystem: horse?.sireSystem },
      input.exceptionReason,
    )
    const from = placementOf(current)
    const blocks: MareUsageBlock[] = []
    if (!resolved.ok) blocks.push(...resolved.blocks)
    else if (samePlacement(from, resolved.value.placement)) blocks.push({ kind: 'unchanged' })
    if (!resolved.ok || blocks.length > 0) return { status: 'blocked', blocks }
    const { placement, exceptionReason, warnings, parentSystemUnknown } = resolved.value
    const stop = gate([], warnings, context.confirmed)
    if (stop) return stop
    const mare = withPlacement(current, placement, exceptionReason)
    await db.mares.put(mare)
    await context.addEvent({
      kind: 'mare-usage-changed',
      horseId,
      from,
      to: placement,
      ...(exceptionReason === undefined ? {} : { exceptionReason }),
      ...confirmation(warnings),
    })
    return context.done({ mare, parentSystemUnknown }, warnings)
  })
}

/** 在圈的市場母馬；找不到、屬於其他局、不是市場母馬或不在圈內時丟出錯誤 */
function marketMareInHerd(rows: RuleRows, horseId: string): MareRow {
  const mare = rows.mares.find((row) => row.horseId === horseId)
  if (!mare) throw new Error(`找不到母馬：${horseId}`)
  if (mare.usage === 'own' || mare.usage === 'free') {
    throw new Error(`自家母駒的系與代數由出生紀錄決定，不能修改用途：${horseId}`)
  }
  if (mare.herd !== 'in-herd') throw new Error(`不在繁殖圈內的母馬不能修改用途：${horseId}`)
  return mare
}
