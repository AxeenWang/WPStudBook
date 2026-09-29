import { normalizeAbilityNumber } from '../core/identity'
import type { LineGeneration } from '../core/lines'
import { chooseIncumbent, type StallionRecord } from '../core/stallions'
import type { SuccessorCandidate } from '../core/successor'
import { linkedFoal, loadBreeding } from './breeding-writes'
import type { WPStudBookDatabase } from './database'
import { recordHorseNumber } from './horse-numbers'
import { buildSuccessorCandidate } from './inputs'
import { loadSuccessorCandidate } from './loaders'
import type { BreedingRow, StallionChangeReason, StallionReadiness, StallionRow } from './records'
import { reasonOf } from './stallion-writes'
import {
  checkOwnSuccessor,
  loadFoal,
  runWrite,
  type FoalExistsBlock,
  type Prepared,
  type SuccessorCheckBlock,
  type UnchangedBlock,
  type WriteContext,
  type WriteOptions,
  type WriteResult,
} from './writes'

// 預定後繼與接任的寫入操作（需求規格 7.6、7.7、9.6；技術設計 4.3「寫入操作」）

/** 預定後繼的對象：已出生的自家公駒，或已受胎、產駒還沒出生的八系指定配種 */
export type SuccessorTarget = { horseId: string } | { breedingId: string }

/** 指定預定後繼的輸入 */
export interface DesignateSuccessorInput {
  target: SuccessorTarget
  /** 已出生的公駒的就緒狀態；省略時為競走中。尚未出生時不接受 */
  readiness?: StallionReadiness
}

/**
 * 指定預定後繼的阻止原因：
 * - successor：9.6 的核對不符（例如自由配種所生）
 * - line-has-successor：這一系已有預定後繼 stallionId；每系一匹，改指定要先取消（需求規格 7.7）
 * - already-appointed：公駒在那一格已有接任過的任用 stallionId
 * - foal-exists：指定的配種已有產駒 horseId 出生，改為指定那匹產駒
 */
export type DesignateSuccessorBlock =
  | SuccessorCheckBlock
  | { kind: 'line-has-successor'; stallionId: string }
  | { kind: 'already-appointed'; stallionId: string }
  | FoalExistsBlock

/**
 * 確認預定後繼出生的阻止原因：
 * - not-born：連到那筆配種的產駒還沒有建立
 * - foal-female：產駒 horseId 是牝，預定後繼失效，由使用者取消（需求規格 7.7）
 * - successor：產駒的 9.6 核對不符
 */
export type ConfirmBirthBlock =
  { kind: 'not-born' } | { kind: 'foal-female'; horseId: string } | SuccessorCheckBlock

/** 正式接任或更換現任的輸入 */
export interface AppointStallionInput {
  /** 接任的自家公駒 */
  horseId: string
  /** 更換現任的原因（需求規格 7.7）；那一格已有接任過的種牡馬時必填 */
  reason?: StallionChangeReason
  /** 種牡馬馬番号（需求規格 6.4、7.7）；只有空白時當作沒有填 */
  horseNumber?: string
}

/**
 * 正式接任與更換現任的阻止原因：
 * - successor：9.6 的核對不符
 * - horse-number：種牡馬馬番号的格式不符
 * - stallion-ended：他在那一格已退出生產行列或已引退，先用 setStallionStatus 更正
 * - unchanged：他已是那一格的現任
 * - birth-unconfirmed：那一格尚未出生的預定後繼 stallionId 指定的就是他出生的配種，先確認出生（需求規格 7.7）
 * - reason-required：那一格已有接任過的種牡馬，是更換現任，要附原因
 */
export type AppointStallionBlock =
  | SuccessorCheckBlock
  | { kind: 'horse-number' }
  | { kind: 'stallion-ended' }
  | UnchangedBlock
  | { kind: 'birth-unconfirmed'; stallionId: string }
  | { kind: 'reason-required' }

/** 接任後的任用，以及同一格改為已被取代的任用 */
export interface AppointedStallion {
  appointment: StallionRow
  replaced: StallionRow[]
}

/** 就緒狀態的兩種值：競走中、已引退待指定 */
const READINESS: readonly StallionReadiness[] = ['racing', 'retired-awaiting']

/** 預定後繼的格位與對象：已出生時是馬匹，尚未出生時是受胎的配種紀錄 */
type ResolvedTarget = { slot: LineGeneration } & ({ horseId: string } | { breedingId: string })

/**
 * 指定預定後繼（需求規格 7.6、7.7、9.6、LINE-40～42）：對象是已出生的自家公駒，
 * 或已受胎、產駒還沒出生的八系指定配種。系與代數不由畫面選：公駒取出生紀錄，配種取規則快照的預計產出；
 * 以 9.6 核對，不符時阻止（尚未出生時以配種紀錄的父母與規則快照組出核對輸入）。
 * 同一系已有預定後繼、公駒在那一格已有接任過的任用、配種已有產駒出生時阻止。
 * 新增一列狀態留空的任用：已出生時存馬匹與就緒（預設競走中），尚未出生時存配種紀錄。
 * 那一格因此有種牡馬紀錄，以他為種牡馬的任務依任務看板的規則出現並暫停到他接任，補公系也可能因此結束。
 * 事件 successor-designated 記系位置、代數與對象。
 * 馬匹或配種紀錄找不到、屬於其他局，對象是牝駒、市場馬、不是受胎或不是八系指定配種的紀錄，
 * 尚未出生時傳了就緒，或就緒不是兩種之一時丟出錯誤。
 */
export async function designateSuccessor(
  db: WPStudBookDatabase,
  gameId: string,
  input: DesignateSuccessorInput,
  options: WriteOptions = {},
): Promise<WriteResult<StallionRow, DesignateSuccessorBlock>> {
  const { target, readiness } = input
  if (readiness !== undefined && !READINESS.includes(readiness)) {
    throw new Error(`就緒狀態不符：${readiness}`)
  }
  return runWrite(db, gameId, [db.horses, db.breedings, db.stallions], options, async (context) => {
    const resolved =
      'horseId' in target
        ? await coltTarget(context, target.horseId)
        : await unbornTarget(context, target.breedingId, readiness)
    if (!resolved.ok) return { status: 'blocked', blocks: resolved.blocks }
    const { slot } = resolved.value
    const horseId = 'horseId' in resolved.value ? resolved.value.horseId : undefined
    const lineRows = await db.stallions
      .where('gameId')
      .equals(gameId)
      .filter((row) => row.line === slot.line)
      .toArray()
    const blocks: DesignateSuccessorBlock[] = []
    const pending = lineRows.find((row) => row.status === undefined)
    if (pending) blocks.push({ kind: 'line-has-successor', stallionId: pending.id })
    // 尚未出生時 horseId 是 undefined，只對得到尚未出生的預定後繼（狀態留空），不會算成已接任
    const appointed = lineRows.find((row) => row.horseId === horseId && row.status !== undefined)
    if (appointed) blocks.push({ kind: 'already-appointed', stallionId: appointed.id })
    if (blocks.length > 0) return { status: 'blocked', blocks }

    const row: StallionRow = {
      id: crypto.randomUUID(),
      gameId,
      line: slot.line,
      generation: slot.generation,
      ...('horseId' in resolved.value
        ? { horseId: resolved.value.horseId, readiness: readiness ?? 'racing' }
        : { breedingId: resolved.value.breedingId }),
    }
    await db.stallions.add(row)
    await context.addEvent({
      kind: 'successor-designated',
      line: row.line,
      ...(row.horseId === undefined ? {} : { horseId: row.horseId }),
      stallionId: row.id,
      generation: row.generation,
      ...(row.breedingId === undefined ? {} : { breedingId: row.breedingId }),
      ...(row.readiness === undefined ? {} : { readiness: row.readiness }),
    })
    return context.done(row)
  })
}

/**
 * 取消預定後繼（需求規格 7.7、LINE-42）：刪除那一列任用並寫事件 successor-cancelled，歷程留在事件
 * （技術設計 4.3）。任用找不到、屬於其他局或已接任（改用 setStallionStatus）時丟出錯誤。
 */
export async function cancelSuccessor(
  db: WPStudBookDatabase,
  gameId: string,
  stallionId: string,
  options: WriteOptions = {},
): Promise<WriteResult<StallionRow, never>> {
  return runWrite(db, gameId, [db.stallions], options, async (context) => {
    const row = await loadPending(context, stallionId)
    await db.stallions.delete(stallionId)
    await context.addEvent({
      kind: 'successor-cancelled',
      line: row.line,
      ...(row.horseId === undefined ? {} : { horseId: row.horseId }),
      stallionId,
      generation: row.generation,
      ...(row.breedingId === undefined ? {} : { breedingId: row.breedingId }),
    })
    return context.done(row)
  })
}

/**
 * 確認預定後繼的產駒出生（需求規格 7.7「產駒出生後不自動改指，由使用者確認」、LINE-42）：
 * 只限尚未出生的預定後繼。找出出生紀錄連到那筆配種的產駒：還沒有時阻止；是牝時阻止（預定後繼失效，由使用者取消）。
 * 公駒以 9.6 再核對，目標是這一列的系與代數；通過後這一列改存馬匹、拿掉配種紀錄，就緒為競走中。
 * 事件 successor-born 記系位置、馬匹與配種紀錄。任用找不到、屬於其他局、已接任或已出生時丟出錯誤。
 */
export async function confirmSuccessorBirth(
  db: WPStudBookDatabase,
  gameId: string,
  stallionId: string,
  options: WriteOptions = {},
): Promise<WriteResult<StallionRow, ConfirmBirthBlock>> {
  return runWrite(db, gameId, [db.horses, db.breedings, db.stallions], options, async (context) => {
    const { breedingId, ...row } = await loadPending(context, stallionId)
    if (breedingId === undefined) throw new Error(`預定後繼已經出生：${stallionId}`)
    const foal = await linkedFoal(context, await loadBreeding(context, breedingId))
    const blocks: ConfirmBirthBlock[] = []
    if (!foal) blocks.push({ kind: 'not-born' })
    else if (foal.sex === 'female') blocks.push({ kind: 'foal-female', horseId: foal.id })
    if (!foal || blocks.length > 0) return { status: 'blocked', blocks }
    const checked = checkOwnSuccessor(await loadSuccessorCandidate(db, gameId, foal.id), {
      line: row.line,
      generation: row.generation,
    })
    if (!checked.ok) return { status: 'blocked', blocks: checked.blocks }
    const next: StallionRow = { ...row, horseId: foal.id, readiness: 'racing' }
    await db.stallions.put(next)
    await context.addEvent({
      kind: 'successor-born',
      line: next.line,
      horseId: foal.id,
      stallionId,
      breedingId,
    })
    return context.done(next)
  })
}

/**
 * 預定後繼的就緒狀態（需求規格 7.7）：已出生的預定後繼在競走中與已引退待指定之間切換；和目前相同時阻止。
 * 事件 successor-readiness-changed 記原狀態與新狀態。任用找不到、屬於其他局、已接任或尚未出生，
 * 或就緒不是兩種之一時丟出錯誤；已出生的預定後繼缺少就緒狀態時丟出 RangeError。
 */
export async function setSuccessorReadiness(
  db: WPStudBookDatabase,
  gameId: string,
  stallionId: string,
  readiness: StallionReadiness,
  options: WriteOptions = {},
): Promise<WriteResult<StallionRow, UnchangedBlock>> {
  if (!READINESS.includes(readiness)) throw new Error(`就緒狀態不符：${readiness}`)
  return runWrite(db, gameId, [db.stallions], options, async (context) => {
    const row = await loadPending(context, stallionId)
    const { horseId, readiness: from } = row
    if (horseId === undefined) throw new Error(`尚未出生的預定後繼沒有就緒狀態：${stallionId}`)
    if (from === undefined) throw new RangeError(`預定後繼缺少就緒狀態：${stallionId}`)
    if (from === readiness) return { status: 'blocked', blocks: [{ kind: 'unchanged' }] }
    const next: StallionRow = { ...row, readiness }
    await db.stallions.put(next)
    await context.addEvent({
      kind: 'successor-readiness-changed',
      line: row.line,
      horseId,
      stallionId,
      from,
      to: readiness,
    })
    return context.done(next)
  })
}

/**
 * 正式接任或更換現任（需求規格 7.7、9.6、PED-08、LINE-22、LINE-30、STL-03）：對象是自家公駒，
 * 格位取出生紀錄的系與代數，不由畫面選；以 9.6 核對，不符時阻止。他在那一格是預定後繼或已被取代時沿用那一列，
 * 已退出生產行列或已引退時阻止（先用 setStallionStatus 更正），已在崗時阻止；那一格尚未出生的預定後繼
 * 指定的就是他出生的配種時阻止，先用 confirmSuccessorBirth 確認出生；沒有任用時新增一列。
 * 那一格另有接任過的任用（在崗、已被取代、退出生產行列、已引退）時是更換現任，要附 7.7 的原因；
 * 第一次接任不需原因；同一格其他還沒接任的預定後繼不算。以 chooseIncumbent 套用：他改為在崗並拿掉就緒，
 * 同一格原本在崗的改為已被取代；上一代的現任（交接期間可同時在崗）與這一系其他的預定後繼不動。
 * 種牡馬馬番号去掉前後空白、統一寫法，有填時記一筆種牡馬階段。事件 stallion-appointed 記格位、原因與被取代的馬，
 * 生效年是事件的年份。兄弟比較後保留原現任時不呼叫這個操作，不寫任何紀錄。
 * 馬匹找不到、屬於其他局、不是自家產駒或不是公駒時丟出錯誤。
 */
export async function appointStallion(
  db: WPStudBookDatabase,
  gameId: string,
  input: AppointStallionInput,
  options: WriteOptions = {},
): Promise<WriteResult<AppointedStallion, AppointStallionBlock>> {
  const tables = [db.horses, db.breedings, db.stallions, db.horseNumbers]
  return runWrite(db, gameId, tables, options, async (context) => {
    const { horseId } = input
    const horse = await loadFoal(context, horseId)
    if (horse.sex !== 'male') throw new Error(`只有公駒可以接任種牡馬：${horseId}`)
    const checked = checkOwnSuccessor(await loadSuccessorCandidate(db, gameId, horseId))
    const numberText = input.horseNumber?.trim() ?? ''
    const horseNumber = numberText === '' ? undefined : normalizeAbilityNumber(numberText)
    const blocks: AppointStallionBlock[] = checked.ok ? [] : [...checked.blocks]
    if (horseNumber === null) blocks.push({ kind: 'horse-number' })
    if (!checked.ok || horseNumber === null) return { status: 'blocked', blocks }

    const slot = checked.value
    // 自家產駒至少 1 代，這一格不會有補公系補入的零代任用
    const rows = await db.stallions
      .where('[gameId+line+generation]')
      .equals([gameId, slot.line, slot.generation])
      .toArray()
    const own = rows.find((row) => row.horseId === horseId)
    if (own?.status === 'withdrawn' || own?.status === 'retired') {
      blocks.push({ kind: 'stallion-ended' })
    } else if (own?.status === 'active') {
      blocks.push({ kind: 'unchanged' })
    }
    // 9.6 通過時出生紀錄一定連到配種紀錄；任用還存著那筆配種的，是還沒確認出生的預定後繼
    const unborn = rows.find((row) => row.breedingId === horse.birth?.breedingId)
    if (unborn) blocks.push({ kind: 'birth-unconfirmed', stallionId: unborn.id })
    const replacing = rows.some((row) => row !== own && row.status !== undefined)
    if (replacing && input.reason === undefined) blocks.push({ kind: 'reason-required' })
    if (blocks.length > 0) return { status: 'blocked', blocks }

    const current: StallionRow = own ?? {
      id: crypto.randomUUID(),
      gameId,
      line: slot.line,
      generation: slot.generation,
      horseId,
    }
    const slotRows = own ? rows : [...rows, current]
    const changes = chooseIncumbent(horseId, slotRows.flatMap(stallionRecordOf))
    const appointment: StallionRow = { ...current, status: 'active' }
    delete appointment.readiness
    const replaced = slotRows.flatMap((row): StallionRow[] =>
      changes.some((change) => change.id === row.horseId && change.to === 'replaced')
        ? [{ ...row, status: 'replaced' }]
        : [],
    )
    await db.stallions.bulkPut([appointment, ...replaced])
    if (horseNumber !== undefined) {
      await recordHorseNumber(context, horseId, 'stallion', horseNumber)
    }
    await context.addEvent({
      kind: 'stallion-appointed',
      line: slot.line,
      horseId,
      stallionId: appointment.id,
      generation: slot.generation,
      ...(input.reason === undefined ? {} : { reason: reasonOf(input.reason) }),
      replacedHorseIds: replaced.flatMap((row) => row.horseId ?? []),
    })
    return context.done({ appointment, replaced })
  })
}

/** 已出生的公駒：以 9.6 核對，格位是出生紀錄的系與代數。不是公駒時丟出錯誤 */
async function coltTarget(
  context: WriteContext,
  horseId: string,
): Promise<Prepared<ResolvedTarget, DesignateSuccessorBlock>> {
  const horse = await loadFoal(context, horseId)
  if (horse.sex !== 'male') throw new Error(`只有公駒可以當預定後繼：${horseId}`)
  const checked = checkOwnSuccessor(
    await loadSuccessorCandidate(context.db, context.game.id, horseId),
  )
  return checked.ok ? { ok: true, value: { slot: checked.value, horseId } } : checked
}

/**
 * 尚未出生的產駒：配種紀錄要是受胎的八系指定配種、還沒有產駒；以配種紀錄組出的核對輸入做 9.6 核對，
 * 格位是規則快照的預計產出。傳了就緒，或紀錄不是受胎的八系指定配種時丟出錯誤
 */
async function unbornTarget(
  context: WriteContext,
  breedingId: string,
  readiness: StallionReadiness | undefined,
): Promise<Prepared<ResolvedTarget, DesignateSuccessorBlock>> {
  if (readiness !== undefined) throw new Error(`尚未出生的預定後繼沒有就緒狀態：${breedingId}`)
  const breeding = await loadBreeding(context, breedingId)
  if (breeding.kind !== 'designated' || breeding.conception !== '受胎') {
    throw new Error(`不是受胎的八系指定配種：${breedingId}`)
  }
  const foal = await linkedFoal(context, breeding)
  if (foal) return { ok: false, blocks: [{ kind: 'foal-exists', horseId: foal.id }] }
  const checked = checkOwnSuccessor(unbornCandidate(breeding))
  return checked.ok ? { ok: true, value: { slot: checked.value, breedingId } } : checked
}

/**
 * 尚未出生的產駒的核對輸入：父母取自配種紀錄，出生紀錄的系與代數取規則快照的預計產出
 * （技術設計 4.3「預定後繼的指定」）
 */
function unbornCandidate(breeding: BreedingRow): SuccessorCandidate {
  const placement = breeding.rule?.output
  return buildSuccessorCandidate(
    {
      id: breeding.id,
      gameId: breeding.gameId,
      sireId: breeding.sireId,
      damId: breeding.mareId,
      birth: { breedingId: breeding.id, ...(placement === undefined ? {} : { placement }) },
    },
    breeding,
  )
}

/** 這一局的預定後繼（狀態留空的任用）；找不到、屬於其他局或已接任時丟出錯誤 */
async function loadPending(context: WriteContext, stallionId: string): Promise<StallionRow> {
  const row = await context.db.stallions.get(stallionId)
  if (!row || row.gameId !== context.game.id) throw new Error(`找不到種牡馬的任用：${stallionId}`)
  if (row.status !== undefined) throw new Error(`已接任的種牡馬不是預定後繼：${stallionId}`)
  return row
}

/** 任用列在 chooseIncumbent 用的種牡馬紀錄；尚未出生的預定後繼沒有馬匹，不列入 */
function stallionRecordOf(row: StallionRow): StallionRecord[] {
  if (row.horseId === undefined) return []
  return [
    {
      id: row.horseId,
      placement: { line: row.line, generation: row.generation },
      status: row.status,
    },
  ]
}
