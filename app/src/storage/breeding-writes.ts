import type { WPStudBookDatabase } from './database'
import { ruleTables } from './loaders'
import type { BreedingRow, BreedingValue, HorseRow, MareRow, WriteWarning } from './records'
import {
  confirmation,
  gate,
  loadMare,
  resolveSire,
  runWrite,
  type Prepared,
  type SireInput,
  type SireNameBlock,
  type UnchangedBlock,
  type WriteContext,
  type WriteOptions,
  type WriteResult,
} from './writes'

// 配種紀錄的寫入操作：登記、更正與受胎狀態（需求規格 7.4、9.1、10.2、10.3；技術設計 4.3「寫入操作」）

/** 配種的輸入：自由配種傳實際種牡馬（內部馬匹或外部名稱） */
export type BreedingInput = { kind: 'free'; sire: SireInput }

/** 配種內容的阻止原因，登記與更正共用 */
export type BreedingCheckBlock = SireNameBlock

/** 已有產駒的出生紀錄連到這筆配種紀錄（需求規格 9.1、BRD-25）；horseId 是那匹產駒 */
export interface FoalExistsBlock {
  kind: 'foal-exists'
  horseId: string
}

/** 登記配種的阻止原因：內容不符，或這匹母馬今年已有配種紀錄（改用更正），breedingId 是那一筆 */
export type RegisterBreedingBlock =
  BreedingCheckBlock | { kind: 'already-registered'; breedingId: string }

/**
 * 更正配種的阻止原因：內容不符；past-year 是往年的紀錄，只能更正今年的；已有產駒；和目前相同
 */
export type CorrectBreedingBlock =
  BreedingCheckBlock | { kind: 'past-year' } | FoalExistsBlock | UnchangedBlock

/** 登記或更正後的配種紀錄；parentSystemUnknown 為 true 時提示 8.3 無法判斷 */
export interface SavedBreeding {
  breeding: BreedingRow
  parentSystemUnknown: boolean
}

/** 驗證過、還沒寫入的配種內容 */
interface CheckedBreeding {
  fields: Pick<BreedingRow, 'kind' | 'sireId' | 'sireName' | 'rule' | 'exceptionReason'>
  warnings: WriteWarning[]
  parentSystemUnknown: boolean
}

/** 配種的寫入操作要讀寫的資料表：規則輸入快照的資料表與配種紀錄 */
function breedingTables(db: WPStudBookDatabase) {
  return [...ruleTables(db), db.breedings]
}

/**
 * 登記目前遊戲年的配種（需求規格 9.1）：一匹母馬一年一筆，已有時阻止並指出那一筆（改用更正）。
 * 自由配種（7.8）：種牡馬是內部馬匹或外部名稱，不做規則與血統檢查，母馬只要在圈，不看用途與馬齡。
 * 登記不改今年計畫。事件 breeding-registered。
 * 母馬找不到、屬於其他局或不在圈內，或種牡馬找不到、屬於其他局或是牝馬時丟出錯誤。
 */
export async function registerBreeding(
  db: WPStudBookDatabase,
  gameId: string,
  mareId: string,
  input: BreedingInput,
  options: WriteOptions = {},
): Promise<WriteResult<SavedBreeding, RegisterBreedingBlock>> {
  return runWrite(db, gameId, breedingTables(db), options, async (context) => {
    await mareInHerd(context, mareId)
    const year = context.game.currentYear
    const existing = await db.breedings
      .where('[gameId+mareId+year]')
      .equals([gameId, mareId, year])
      .first()
    const checked = await checkBreeding(context, input)
    const blocks: RegisterBreedingBlock[] = [
      ...(existing ? [{ kind: 'already-registered' as const, breedingId: existing.id }] : []),
      ...(checked.ok ? [] : checked.blocks),
    ]
    if (!checked.ok || blocks.length > 0) return { status: 'blocked', blocks }
    const { fields, warnings, parentSystemUnknown } = checked.value
    const stop = gate([], warnings, context.confirmed)
    if (stop) return stop
    const breeding: BreedingRow = {
      id: crypto.randomUUID(),
      gameId,
      mareId,
      year,
      ...fields,
      ...confirmation(warnings),
    }
    await db.breedings.add(breeding)
    await context.addEvent({
      kind: 'breeding-registered',
      horseId: mareId,
      breedingId: breeding.id,
      breeding: breedingValue(breeding),
      ...confirmation(warnings),
    })
    return context.done({ breeding, parentSystemUnknown }, warnings)
  })
}

/**
 * 更正目前遊戲年的配種（需求規格 9.1、BRD-25）：類型與種牡馬可以換，檢查照登記重做；受胎狀態不變。
 * 往年的紀錄只回傳 past-year；已有產駒的出生紀錄連到這一筆、內容和目前相同時阻止。
 * 事件 breeding-corrected 記原內容與新內容。
 * 配種紀錄找不到或屬於其他局，或母馬、種牡馬的狀況同登記時丟出錯誤。
 */
export async function correctBreeding(
  db: WPStudBookDatabase,
  gameId: string,
  breedingId: string,
  input: BreedingInput,
  options: WriteOptions = {},
): Promise<WriteResult<SavedBreeding, CorrectBreedingBlock>> {
  return runWrite(db, gameId, breedingTables(db), options, async (context) => {
    const current = await loadBreeding(context, breedingId)
    if (current.year !== context.game.currentYear) {
      return { status: 'blocked', blocks: [{ kind: 'past-year' }] }
    }
    await mareInHerd(context, current.mareId)
    const blocks: CorrectBreedingBlock[] = []
    const foal = await linkedFoal(context, current)
    if (foal) blocks.push({ kind: 'foal-exists', horseId: foal.id })
    const checked = await checkBreeding(context, input)
    if (!checked.ok) blocks.push(...checked.blocks)
    else if (sameBreeding(breedingValue(current), breedingValue(checked.value.fields))) {
      blocks.push({ kind: 'unchanged' })
    }
    if (!checked.ok || blocks.length > 0) return { status: 'blocked', blocks }
    const { fields, warnings, parentSystemUnknown } = checked.value
    const stop = gate([], warnings, context.confirmed)
    if (stop) return stop
    const breeding: BreedingRow = {
      id: current.id,
      gameId,
      mareId: current.mareId,
      year: current.year,
      ...(current.conception === undefined ? {} : { conception: current.conception }),
      ...fields,
      ...confirmation(warnings),
    }
    await db.breedings.put(breeding)
    await context.addEvent({
      kind: 'breeding-corrected',
      horseId: current.mareId,
      breedingId,
      from: breedingValue(current),
      to: breedingValue(breeding),
      ...confirmation(warnings),
    })
    return context.done({ breeding, parentSystemUnknown }, warnings)
  })
}

/** 驗證配種的內容，不寫入 */
async function checkBreeding(
  context: WriteContext,
  input: BreedingInput,
): Promise<Prepared<CheckedBreeding, BreedingCheckBlock>> {
  const sire = await resolveSire(context, input.sire)
  if (!sire.ok) return sire
  return {
    ok: true,
    value: { fields: { kind: 'free', ...sire.value }, warnings: [], parentSystemUnknown: false },
  }
}

/** 在圈的母馬；找不到、屬於其他局或不在圈內時丟出錯誤 */
async function mareInHerd(context: WriteContext, mareId: string): Promise<MareRow> {
  const mare = await loadMare(context, mareId)
  if (mare.herd !== 'in-herd') throw new Error(`不在繁殖圈內的母馬不能登記配種：${mareId}`)
  return mare
}

/** 這一局的配種紀錄；找不到或屬於其他局時丟出錯誤 */
async function loadBreeding(context: WriteContext, breedingId: string): Promise<BreedingRow> {
  const breeding = await context.db.breedings.get(breedingId)
  if (!breeding || breeding.gameId !== context.game.id) {
    throw new Error(`找不到配種紀錄：${breedingId}`)
  }
  return breeding
}

/** 出生紀錄連到這筆配種紀錄的產駒；交易要包含 horses */
async function linkedFoal(
  context: WriteContext,
  breeding: BreedingRow,
): Promise<HorseRow | undefined> {
  return context.db.horses
    .where('[gameId+damId]')
    .equals([context.game.id, breeding.mareId])
    .filter((horse) => horse.birth?.breedingId === breeding.id)
    .first()
}

/** 事件記的配種內容：類型、實際種牡馬、指定配種的預計產出與例外補入的原因 */
function breedingValue(
  breeding: Pick<BreedingRow, 'kind' | 'sireId' | 'sireName' | 'rule' | 'exceptionReason'>,
): BreedingValue {
  return {
    kind: breeding.kind,
    ...(breeding.sireId === undefined ? {} : { sireId: breeding.sireId }),
    ...(breeding.sireName === undefined ? {} : { sireName: breeding.sireName }),
    ...(breeding.rule === undefined ? {} : { output: breeding.rule.output }),
    ...(breeding.exceptionReason === undefined
      ? {}
      : { exceptionReason: breeding.exceptionReason }),
  }
}

/** 兩次配種的內容是否相同 */
function sameBreeding(a: BreedingValue, b: BreedingValue): boolean {
  return (
    a.kind === b.kind &&
    a.sireId === b.sireId &&
    a.sireName === b.sireName &&
    a.output?.line === b.output?.line &&
    a.output?.generation === b.output?.generation &&
    a.exceptionReason === b.exceptionReason
  )
}
