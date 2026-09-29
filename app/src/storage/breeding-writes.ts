import { listBoard } from '../core/board'
import { checkDesignatedBreeding, type BreedingBlock } from '../core/check'
import type { DesignatedPairing } from '../core/designated'
import type { LineGeneration } from '../core/lines'
import { checkPedigree } from '../core/vitality'
import type { WPStudBookDatabase } from './database'
import { mareAgeSettings } from './inputs'
import { buildRuleSnapshot, loadMating, readRuleRows, ruleTables, type RuleRows } from './loaders'
import { substituteWarnings } from './mare-assignment'
import type {
  BreedingRow,
  BreedingValue,
  Conception,
  GameTiming,
  HorseRow,
  MareRow,
  StallionRow,
  WriteWarning,
} from './records'
import { damRoleOf, mareListed } from './snapshot'
import {
  confirmation,
  gate,
  loadMareInHerd,
  resolveSire,
  runWrite,
  type FoalExistsBlock,
  type Prepared,
  type SireInput,
  type SireNameBlock,
  type UnchangedBlock,
  type WriteContext,
  type WriteOptions,
  type WriteResult,
} from './writes'

// 配種紀錄的寫入操作：登記、更正與受胎狀態（需求規格 7.4、9.1、10.2、10.3；技術設計 4.3「寫入操作」）

/** 八系指定配種的輸入：任務看板上一條配對的產出與實際種牡馬 */
export interface DesignatedBreedingInput {
  kind: 'designated'
  /** 任務看板上配對的產出：第 line 系第 generation 代 */
  output: LineGeneration
  /** 實際種牡馬的內部識別 */
  sireId: string
  /** 例外補入的原因（7.3、10.3）；沒有傳時沿用母馬登記時的原因，不是例外補入時不保存 */
  exceptionReason?: string
}

/** 自由配種的輸入：實際種牡馬（內部馬匹或外部名稱） */
export interface FreeBreedingInput {
  kind: 'free'
  sire: SireInput
}

/** 配種的輸入：八系指定配種或自由配種 */
export type BreedingInput = DesignatedBreedingInput | FreeBreedingInput

/**
 * 配種內容的阻止原因，登記與更正共用：
 * - no-pairing：產出這一系這一代的配對不在任務看板的任務上（含暫停中的，不含還沒開啟的分支）
 * - mare-not-listed：母馬沒有列入任務（已達定年、已被取代的姊妹），不能登記指定配種
 * - rule：種牡馬或母馬的系、代數或身分與規則不符（10.3）；rule 是 core 的阻止內容
 * - sire-not-active：種牡馬的系與代數相符，但不是那一格目前在崗的種牡馬（10.3「現任種牡馬」）
 * - reason-required：零代市場種牡馬配替代母馬（例外補入）要有原因（7.3、10.3）
 * - sire-name：自由配種的種牡馬外部名稱空白或只有前綴
 */
export type BreedingCheckBlock =
  | { kind: 'no-pairing' }
  | { kind: 'mare-not-listed' }
  | { kind: 'rule'; rule: BreedingBlock }
  | { kind: 'sire-not-active' }
  | { kind: 'reason-required' }
  | SireNameBlock

/** 登記配種的阻止原因：內容不符，或這匹母馬今年已有配種紀錄（改用更正），breedingId 是那一筆 */
export type RegisterBreedingBlock =
  BreedingCheckBlock | { kind: 'already-registered'; breedingId: string }

/**
 * 這筆受胎配種被尚未出生的預定後繼引用（需求規格 9.1、BRD-28）；stallionId 是那一筆任用，要先取消預定後繼
 */
export interface SuccessorDesignatedBlock {
  kind: 'successor-designated'
  stallionId: string
}

/**
 * 更正配種的阻止原因：內容不符；past-year 是往年的紀錄，只能更正今年的；已有產駒；
 * 被尚未出生的預定後繼引用；和目前相同
 */
export type CorrectBreedingBlock =
  | BreedingCheckBlock
  | { kind: 'past-year' }
  | FoalExistsBlock
  | SuccessorDesignatedBlock
  | UnchangedBlock

/**
 * 受胎狀態的阻止原因：已有產駒或被尚未出生的預定後繼引用，卻要改成 `受胎` 以外（含清空）；和目前相同
 */
export type ConceptionBlock = FoalExistsBlock | SuccessorDesignatedBlock | UnchangedBlock

/** 受胎狀態的四種文字（需求規格 9.1） */
const CONCEPTIONS: readonly Conception[] = ['空胎', '受胎', '不受胎', '未確認']

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
 * 八系指定配種（7.4、10.3）：配對要在任務看板的任務上，母馬要列入任務，種牡馬要是那一格在崗的一匹，
 * 系、代數與身分以 checkDesignatedBreeding 比對；例外補入警告並確認、原因必填（沒有傳時沿用母馬登記時的），
 * 替代母馬重做 8.3 親系統檢查；10.2 血統檢查要確認的警告（活血少於 8 種、4 代內重複、資料不足）
 * 警告並確認，只提示的不要求確認。規則快照記配對、母馬當時的身分與血統檢查的結果。
 * 自由配種（7.8）：種牡馬是內部馬匹或外部名稱，不做規則與血統檢查，母馬只要在圈，不看用途與馬齡。
 * 登記不改今年計畫。事件 breeding-registered。
 * 母馬找不到、屬於其他局或不在圈內，或種牡馬找不到、屬於其他局，或自由配種的種牡馬是牝馬時丟出錯誤
 * （指定配種的種牡馬是牝馬時由 10.3 阻止，見 checkDesignated）。
 */
export async function registerBreeding(
  db: WPStudBookDatabase,
  gameId: string,
  mareId: string,
  input: BreedingInput,
  options: WriteOptions = {},
): Promise<WriteResult<SavedBreeding, RegisterBreedingBlock>> {
  return runWrite(db, gameId, breedingTables(db), options, async (context) => {
    const mare = await loadMareInHerd(context, mareId, '不能登記配種')
    const year = context.game.currentYear
    const existing = await db.breedings
      .where('[gameId+mareId+year]')
      .equals([gameId, mareId, year])
      .first()
    const checked = await checkBreeding(context, mare, input)
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
 * 往年的紀錄只回傳 past-year；已有產駒的出生紀錄連到這一筆、被尚未出生的預定後繼引用（BRD-28）、
 * 內容和目前相同時阻止。
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
    const mare = await loadMareInHerd(context, current.mareId, '不能更正配種')
    const blocks: CorrectBreedingBlock[] = []
    const foal = await linkedFoal(context, current)
    if (foal) blocks.push({ kind: 'foal-exists', horseId: foal.id })
    const successor = await designatedSuccessor(context, current)
    if (successor) blocks.push({ kind: 'successor-designated', stallionId: successor.id })
    const checked = await checkBreeding(context, mare, input)
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

/**
 * 登記或更正受胎狀態（需求規格 9.1、BRD-02、BRD-25）：四種狀態原樣保存，傳 null 清回沒有結果。
 * 不限年份，母馬不必在圈（配種後賣出的母馬仍有這一年的紀錄）。和目前相同時阻止；
 * 已有產駒的出生紀錄連到這一筆，或被尚未出生的預定後繼引用（BRD-28）時，改成 `受胎` 以外（含清空）阻止。
 * 不建立產駒（BRD-01）。
 * 事件 conception-set 記原狀態與新狀態。配種紀錄找不到、屬於其他局，或狀態不是四種之一時丟出錯誤。
 */
export async function setConception(
  db: WPStudBookDatabase,
  gameId: string,
  breedingId: string,
  conception: Conception | null,
  options: WriteOptions = {},
): Promise<WriteResult<BreedingRow, ConceptionBlock>> {
  if (conception !== null && !CONCEPTIONS.includes(conception)) {
    throw new Error(`受胎狀態不符：${conception}`)
  }
  return runWrite(db, gameId, [db.breedings, db.horses, db.stallions], options, async (context) => {
    const current = await loadBreeding(context, breedingId)
    const from = current.conception
    const to = conception ?? undefined
    const blocks: ConceptionBlock[] = []
    if (from === to) blocks.push({ kind: 'unchanged' })
    else if (to !== '受胎') {
      const foal = await linkedFoal(context, current)
      if (foal) blocks.push({ kind: 'foal-exists', horseId: foal.id })
      const successor = await designatedSuccessor(context, current)
      if (successor) blocks.push({ kind: 'successor-designated', stallionId: successor.id })
    }
    if (blocks.length > 0) return { status: 'blocked', blocks }
    const breeding: BreedingRow = { ...current }
    if (to === undefined) delete breeding.conception
    else breeding.conception = to
    await db.breedings.put(breeding)
    await context.addEvent({
      kind: 'conception-set',
      horseId: current.mareId,
      breedingId,
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
    })
    return context.done(breeding)
  })
}

/**
 * 預定出生（需求規格 9.1、BRD-01）：受胎的配種在隔年 4 月 1 週預定出生；其他狀態與還沒有結果時為 null。
 * 只是推導，不建立產駒；確認出生後才建立產駒
 */
export function expectedFoaling(
  breeding: Pick<BreedingRow, 'year' | 'conception'>,
): { year: number; timing: GameTiming } | null {
  return breeding.conception === '受胎'
    ? { year: breeding.year + 1, timing: { month: 4, week: 1 } }
    : null
}

/** 驗證配種的內容，不寫入 */
async function checkBreeding(
  context: WriteContext,
  mare: MareRow,
  input: BreedingInput,
): Promise<Prepared<CheckedBreeding, BreedingCheckBlock>> {
  if (input.kind === 'designated') return checkDesignated(context, mare, input)
  const sire = await resolveSire(context, input.sire)
  if (!sire.ok) return sire
  return {
    ok: true,
    value: { fields: { kind: 'free', ...sire.value }, warnings: [], parentSystemUnknown: false },
  }
}

/**
 * 八系指定配種的檢查（需求規格 7.3、8.3、10.2、10.3；技術設計 4.3「配種的登記：指定配種」）：
 * 交易內重新組出八系快照，從任務看板的任務找配對，再比對母馬、種牡馬與例外補入；
 * 都通過後做 8.3 與血統檢查，組出規則快照。
 * 種牡馬是牝馬時不丟出錯誤：牝馬不會有任用，比對時是八系以外，由 10.3 阻止
 * （自由配種、建立產駒與總合評價經 resolveSire，牝馬時丟出錯誤）
 */
async function checkDesignated(
  context: WriteContext,
  mare: MareRow,
  input: DesignatedBreedingInput,
): Promise<Prepared<CheckedBreeding, BreedingCheckBlock>> {
  const { db, game } = context
  const rows = await readRuleRows(db, game.id, game)
  const snapshot = buildRuleSnapshot(rows)
  const pairing = listBoard(snapshot.eightLines)
    .tasks.map((task) => task.pairing)
    .find(
      (candidate) =>
        candidate.output.line === input.output.line &&
        candidate.output.generation === input.output.generation,
    )
  if (!pairing) return { ok: false, blocks: [{ kind: 'no-pairing' }] }
  const sire = await db.horses.get(input.sireId)
  if (!sire || sire.gameId !== game.id) throw new Error(`找不到馬匹：${input.sireId}`)

  const blocks: BreedingCheckBlock[] = []
  const horses = new Map(rows.horses.map((horse) => [horse.id, horse]))
  if (!mareListed(mare, horses, game.currentYear, mareAgeSettings(rows.settings))) {
    blocks.push({ kind: 'mare-not-listed' })
  }
  const role = damRoleOf(mare)
  const active = slotStallions(rows, pairing).some(
    (row) => row.horseId === input.sireId && row.status === 'active',
  )
  const check = checkDesignatedBreeding(
    pairing,
    active ? pairing.sire : sirePlacement(rows.stallions, input.sireId),
    role ?? { kind: 'unassigned' },
  )
  blocks.push(...check.blocks.map((rule) => ({ kind: 'rule' as const, rule })))
  if (!active && check.blocks.every((block) => block.side !== 'sire')) {
    blocks.push({ kind: 'sire-not-active' })
  }
  const exception = check.warnings.length > 0
  const reason = (input.exceptionReason ?? mare.exceptionReason ?? '').trim()
  if (exception && reason === '') blocks.push({ kind: 'reason-required' })
  // 用途是待指定或自由配種（role 為 null）時 core 已經對母馬一方阻止；role === null 只為了讓型別收窄
  if (blocks.length > 0 || role === null) return { ok: false, blocks }

  const substitute =
    role.kind === 'substitute'
      ? substituteWarnings(rows, snapshot, role.forLine, role.forGeneration, {
          horseId: mare.horseId,
          sireSystem: horses.get(mare.horseId)?.sireSystem,
        })
      : { warnings: [], parentSystemUnknown: false }
  const mating = await loadMating(db, game.id, input.sireId, mare.horseId)
  const pedigree = checkPedigree(
    pairing.output.generation,
    mating,
    snapshot.systemTable,
    snapshot.lineSystems,
  )
  // 10.2：只提示的（未知位置只來自建系期的市場馬）不要求確認，留在規則快照的血統檢查結果裡
  const pedigreeKinds = pedigree.warnings
    .filter((warning) => !warning.hintOnly)
    .map((warning) => warning.kind)
  const warnings: WriteWarning[] = [
    ...(exception ? [{ kind: 'exception-entry' as const, ...pairing.output }] : []),
    ...substitute.warnings,
    ...(pedigreeKinds.length > 0 ? [{ kind: 'pedigree' as const, warnings: pedigreeKinds }] : []),
  ]
  return {
    ok: true,
    value: {
      fields: {
        kind: 'designated',
        sireId: input.sireId,
        rule: {
          distance: pairing.distance,
          sire: pairing.sire,
          dam: role,
          output: pairing.output,
          ...(pairing.kind === 'restore' ? { restoration: true as const } : {}),
          pedigree,
        },
        ...(exception ? { exceptionReason: reason } : {}),
      },
      warnings,
      parentSystemUnknown: substitute.parentSystemUnknown,
    },
  }
}

/**
 * 配對指定的那一格種牡馬任用（10.3）：一般配對是該系該代不屬於補系的任用；
 * 補公系配對是那一次（未撤銷的）補公系的任用
 */
function slotStallions(rows: RuleRows, pairing: DesignatedPairing): StallionRow[] {
  const { line, generation } = pairing.sire
  if (pairing.kind !== 'restore') {
    return rows.stallions.filter(
      (row) =>
        row.restorationId === undefined && row.line === line && row.generation === generation,
    )
  }
  const restoration = rows.restorations.find(
    (row) =>
      !row.revoked &&
      row.side === 'sire' &&
      row.line === line &&
      row.generation === pairing.output.generation - 1,
  )
  return rows.stallions.filter(
    (row) => restoration !== undefined && row.restorationId === restoration.id,
  )
}

/** 種牡馬在八系中的系與代數（10.3 比對用）：取他的任用，優先在崗的；沒有任用時為八系以外 */
function sirePlacement(stallions: readonly StallionRow[], horseId: string): LineGeneration | null {
  const posts = stallions.filter((row) => row.horseId === horseId)
  const post = posts.find((row) => row.status === 'active') ?? posts[0]
  return post ? { line: post.line, generation: post.generation } : null
}

/** 在寫入交易內讀取這一局的配種紀錄；找不到或屬於其他局時丟出錯誤。交易要包含 breedings */
export async function loadBreeding(
  context: WriteContext,
  breedingId: string,
): Promise<BreedingRow> {
  const breeding = await context.db.breedings.get(breedingId)
  if (!breeding || breeding.gameId !== context.game.id) {
    throw new Error(`找不到配種紀錄：${breedingId}`)
  }
  return breeding
}

/** 在寫入交易內讀取出生紀錄連到這筆配種紀錄的產駒；交易要包含 horses */
export async function linkedFoal(
  context: WriteContext,
  breeding: BreedingRow,
): Promise<HorseRow | undefined> {
  return context.db.horses
    .where('[gameId+damId]')
    .equals([context.game.id, breeding.mareId])
    .filter((horse) => horse.birth?.breedingId === breeding.id)
    .first()
}

/**
 * 引用這筆配種紀錄的尚未出生的預定後繼（需求規格 7.7）；確認出生後任用改存馬匹，就不再引用。
 * 交易要包含 stallions
 */
async function designatedSuccessor(
  context: WriteContext,
  breeding: BreedingRow,
): Promise<StallionRow | undefined> {
  return context.db.stallions
    .where('gameId')
    .equals(context.game.id)
    .filter((row) => row.breedingId === breeding.id)
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
