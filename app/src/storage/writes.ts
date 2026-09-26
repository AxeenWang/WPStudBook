import type { Table } from 'dexie'
import { normalizeAbilityNumber, splitHorseName } from '../core/identity'
import {
  findParentSystemConflict,
  normalizeSystemName,
  type LineSystemSnapshot,
} from '../core/systems'
import type { WPStudBookDatabase } from './database'
import type {
  EventContent,
  EventSource,
  GameRow,
  GameTiming,
  HorseRow,
  LineRow,
  Sex,
  SystemRow,
  WriteWarning,
} from './records'
import { buildLineSystems, buildSystemTable } from './snapshot'

// 寫入操作的共用部分（技術設計 4.3「寫入操作」）

/**
 * 寫入操作的結果：
 * - done：已寫入；warnings 是這次確認過的警告
 * - blocked：違反規則，什麼都不寫
 * - unconfirmed：有警告而呼叫端沒有帶確認，什麼都不寫；畫面取得使用者確認後帶 confirmed 再呼叫一次
 */
export type WriteResult<T, B> =
  | { status: 'done'; value: T; warnings: WriteWarning[] }
  | { status: 'blocked'; blocks: B[] }
  | { status: 'unconfirmed'; warnings: WriteWarning[] }

export interface WriteOptions {
  /** 使用者已確認這次操作的警告 */
  confirmed?: boolean
  /** 寫入時間；省略時為現在 */
  now?: Date
  /** 事件的來源；省略時為手動（技術設計 4.3） */
  source?: EventSource
  /** 事件的遊戲內時點；省略時留空 */
  timing?: GameTiming
}

/** 寫入操作在交易內使用的上下文 */
export interface WriteContext {
  db: WPStudBookDatabase
  /** 這一局，交易開始時讀取 */
  game: GameRow
  /** 使用者已確認這次操作的警告 */
  confirmed: boolean
  /** 寫入時間（ISO 8601） */
  now: string
  /** 寫一筆事件：年份為目前遊戲年，寫入時間為 now，來源與時點取自 WriteOptions */
  addEvent(content: EventContent): Promise<void>
  /** 把遊戲局的更新時間設為 now，回傳 done */
  done<T>(value: T, warnings?: WriteWarning[]): Promise<WriteResult<T, never>>
}

/**
 * 在一個 rw 交易內執行寫入操作（技術設計 4.3「寫入操作」）：交易開始時確認遊戲局存在。
 * tables 是操作要讀寫的其他資料表，games 與 events 一定包含在交易內。
 * 呼叫端已在外層交易內時成為子交易（Dexie 的巢狀交易），外層失敗時一起回復（4.4）；
 * 外層交易要是 rw，並包含 games、events 與 tables 的每一張表，否則 Dexie 會丟出 SubTransactionError。
 * 遊戲局不存在，或時點不是 1～12 月、1～4 週時丟出錯誤。
 */
export async function runWrite<T, B>(
  db: WPStudBookDatabase,
  gameId: string,
  tables: readonly Table[],
  options: WriteOptions,
  body: (context: WriteContext) => Promise<WriteResult<T, B>>,
): Promise<WriteResult<T, B>> {
  const now = (options.now ?? new Date()).toISOString()
  const { source = { kind: 'manual' }, timing } = options
  if (timing !== undefined && !isGameTiming(timing)) {
    throw new Error(`遊戲內的時點不符：${timing.month} 月 ${timing.week} 週`)
  }
  // tables 可能已含 games（例如 ruleTables），去掉重複的
  const scope = [...new Set([db.games, db.events, ...tables])]
  return db.transaction('rw', scope, async () => {
    // 不引用 games.ts 的 loadGame：games.ts 的寫入操作也用 runWrite，避免循環引用
    const game = await db.games.get(gameId)
    if (!game) throw new Error(`找不到遊戲局：${gameId}`)
    return body({
      db,
      game,
      confirmed: options.confirmed ?? false,
      now,
      async addEvent(content) {
        await db.events.add({
          ...content,
          id: crypto.randomUUID(),
          gameId,
          year: game.currentYear,
          recordedAt: now,
          source,
          ...(timing === undefined ? {} : { timing }),
        })
      },
      async done(value, warnings = []) {
        await db.games.update(gameId, { updatedAt: now })
        return { status: 'done', value, warnings }
      },
    })
  })
}

/** 遊戲內的時點：1～12 月、每月 1～4 週 */
function isGameTiming(timing: GameTiming): boolean {
  const { month, week } = timing
  const inRange = (value: number, max: number) =>
    Number.isInteger(value) && value >= 1 && value <= max
  return inRange(month, 12) && inRange(week, 4)
}

/**
 * 寫入前的關卡：有阻止時回傳 blocked；有警告而使用者還沒確認時回傳 unconfirmed；可以寫入時回傳 null
 */
export function gate<B>(
  blocks: readonly B[],
  warnings: readonly WriteWarning[],
  confirmed: boolean,
): WriteResult<never, B> | null {
  if (blocks.length > 0) return { status: 'blocked', blocks: [...blocks] }
  if (warnings.length > 0 && !confirmed) {
    return { status: 'unconfirmed', warnings: [...warnings] }
  }
  return null
}

/** 事件的確認紀錄：有確認過的警告時才加上 confirmedWarnings */
export function confirmation(warnings: readonly WriteWarning[]): {
  confirmedWarnings?: WriteWarning[]
} {
  return warnings.length > 0 ? { confirmedWarnings: [...warnings] } : {}
}

/** 驗證通過時的值，或阻止的原因 */
export type Prepared<T, B> = { ok: true; value: T } | { ok: false; blocks: B[] }

/** 手動建立一匹馬的輸入（技術設計 4.3「寫入操作」）；選填欄位留空或只有空白都當作沒有填 */
export interface NewHorseInput {
  /** 完整馬名（含 `(外)`、`[地]` 前綴） */
  fullName: string
  abilityNumber?: string
  birthYear?: number
  /** 父馬名；去掉 `(外)`、`[地]` 前綴後存基本馬名 */
  sireName?: string
  /** 母馬名；去掉 `(外)`、`[地]` 前綴後存基本馬名 */
  damName?: string
  /** 父系：父馬的子系統 */
  sireSystem?: string
}

/**
 * 手動建立馬匹的阻止原因：
 * - horse-name：完整馬名空白，或只有前綴、沒有馬名（需求規格 6.4）
 * - ability-number：能力番号的格式不符
 * - birth-year：出生年不是整數，或晚於目前遊戲年
 * - parent-name：父馬名或母馬名只有前綴、沒有馬名（6.4）
 * - same-horse：能力番号與出生年都和這一局既有的馬相同，是同一匹馬（6.2），應改選既有的馬
 */
export type NewHorseBlock =
  | { kind: 'horse-name' }
  | { kind: 'ability-number' }
  | { kind: 'birth-year' }
  | { kind: 'parent-name'; parent: 'sire' | 'dam' }
  | { kind: 'same-horse'; horseId: string }

/** 手動輸入的馬匹欄位，驗證並統一寫法之後的值；沒有填的選填欄位留空 */
export interface HorseFields {
  fullName: string
  baseName: string
  abilityNumber?: string
  birthYear?: number
  sireName?: string
  damName?: string
  sireSystem?: string
}

/**
 * 驗證手動輸入的馬匹欄位並統一寫法，不寫入：能力番号經 normalizeAbilityNumber，
 * 父母名去掉前綴、存基本馬名，父系去掉結尾「系」（normalizeSystemName）。阻止原因一次列全。
 * 更正既有的馬時 exceptHorseId 是那匹馬自己，同一匹馬的比對排除自己。
 * 在 runWrite 的交易內呼叫，交易要包含 horses。
 */
export async function checkHorseInput(
  context: WriteContext,
  input: NewHorseInput,
  exceptHorseId?: string,
): Promise<Prepared<HorseFields, NewHorseBlock>> {
  const { db, game } = context
  const blocks: NewHorseBlock[] = []
  const name = splitHorseName(input.fullName.trim())
  if (!name) blocks.push({ kind: 'horse-name' })
  const abilityText = input.abilityNumber?.trim() ?? ''
  const abilityNumber = abilityText === '' ? undefined : normalizeAbilityNumber(abilityText)
  if (abilityNumber === null) blocks.push({ kind: 'ability-number' })
  const { birthYear } = input
  const birthYearValid =
    birthYear === undefined || (Number.isInteger(birthYear) && birthYear <= game.currentYear)
  if (!birthYearValid) blocks.push({ kind: 'birth-year' })
  const sireName = parentName(input.sireName)
  if (sireName === null) blocks.push({ kind: 'parent-name', parent: 'sire' })
  const damName = parentName(input.damName)
  if (damName === null) blocks.push({ kind: 'parent-name', parent: 'dam' })
  // 能力番号與出生年都有效時才查同一匹馬；馬名不符也照查，阻止原因一次列全
  if (typeof abilityNumber === 'string' && birthYear !== undefined && birthYearValid) {
    const same = await db.horses
      .where('[gameId+abilityNumber+birthYear]')
      .equals([game.id, abilityNumber, birthYear])
      .filter((horse) => horse.id !== exceptHorseId)
      .first()
    if (same) blocks.push({ kind: 'same-horse', horseId: same.id })
  }
  if (!name || abilityNumber === null || sireName === null || damName === null) {
    return { ok: false, blocks }
  }
  if (blocks.length > 0) return { ok: false, blocks }
  const sireSystem = input.sireSystem === undefined ? null : normalizeSystemName(input.sireSystem)
  return {
    ok: true,
    value: {
      fullName: name.fullName,
      baseName: name.baseName,
      ...(abilityNumber === undefined ? {} : { abilityNumber }),
      ...(birthYear === undefined ? {} : { birthYear }),
      ...(sireName === undefined ? {} : { sireName }),
      ...(damName === undefined ? {} : { damName }),
      ...(sireSystem === null ? {} : { sireSystem }),
    },
  }
}

/** 選填的父母名：沒有填或只有空白時為 undefined；只有前綴、沒有馬名時為 null */
function parentName(text: string | undefined): string | null | undefined {
  const trimmed = text?.trim() ?? ''
  if (trimmed === '') return undefined
  return splitHorseName(trimmed)?.baseName ?? null
}

/**
 * 由手動輸入的欄位組出馬匹的資料列：馬名來源為手動輸入；
 * 父母名或父系有值時，它們的來源也是手動輸入（需求規格 6.4），沒有值時不寫來源
 */
export function manualHorseRow(
  gameId: string,
  id: string,
  fields: HorseFields,
  sex: Sex | undefined,
): HorseRow {
  const pedigree =
    fields.sireName !== undefined || fields.damName !== undefined || fields.sireSystem !== undefined
  return {
    id,
    gameId,
    ...fields,
    nameSource: 'manual',
    ...(sex === undefined ? {} : { sex }),
    ...(pedigree ? { pedigreeSource: 'manual' as const } : {}),
  }
}

/**
 * 驗證手動輸入並組出新馬匹的資料列，不寫入（checkHorseInput、manualHorseRow）。
 * 在 runWrite 的交易內呼叫，交易要包含 horses。
 */
export async function prepareNewHorse(
  context: WriteContext,
  input: NewHorseInput,
  sex: Sex,
): Promise<Prepared<HorseRow, NewHorseBlock>> {
  const checked = await checkHorseInput(context, input)
  if (!checked.ok) return checked
  return {
    ok: true,
    value: manualHorseRow(context.game.id, crypto.randomUUID(), checked.value, sex),
  }
}

/** 在寫入交易內讀取這一局已開啟的系與系統對照表；交易要包含 lines 與 systems */
export async function readLinesAndSystems(
  context: WriteContext,
): Promise<{ lines: LineRow[]; systems: SystemRow[] }> {
  const { db, game } = context
  const [lines, systems] = await Promise.all([
    db.lines.where('gameId').equals(game.id).toArray(),
    db.systems.where('gameId').equals(game.id).toArray(),
  ])
  return { lines, systems }
}

/** 由資料列組出八系目前的系統（技術設計 4.3「規則輸入快照的彙整」的系統） */
export function lineSystemsFromRows(
  lines: readonly LineRow[],
  systems: readonly SystemRow[],
): LineSystemSnapshot {
  return buildLineSystems(lines, buildSystemTable(systems))
}

/**
 * 親系統重複的警告（需求規格 7.2、LINE-03）：比較修改前後八系目前的系統，
 * 親系統因此改變的系（包括這次開啟的系：開啟前親系統留空），與其他系目前的親系統相同時列出；
 * 原本就重複、這次沒有變的不列。
 */
export function parentDuplicateWarnings(
  before: LineSystemSnapshot,
  after: LineSystemSnapshot,
): WriteWarning[] {
  return after.flatMap((entry): WriteWarning[] => {
    const previous = before.find((candidate) => candidate.line === entry.line)
    if (previous?.parentSystem === entry.parentSystem) return []
    const conflict = findParentSystemConflict(after, entry.line, entry.parentSystem)
    return conflict ? [{ kind: 'parent-system-duplicate', line: entry.line, ...conflict }] : []
  })
}

/** 零代市場種牡馬：新建一匹，或選這一局既有的市場馬（補公系可以沿用建系時的零代種牡馬） */
export type ZeroStallionInput =
  { kind: 'new'; horse: NewHorseInput } | { kind: 'existing'; horseId: string }

/**
 * 零代市場種牡馬的阻止原因：新建時同 NewHorseBlock；
 * not-market-stallion：選的既有馬是自家產駒（有出生紀錄）或牝馬，不是市場種牡馬
 */
export type ZeroStallionBlock = NewHorseBlock | { kind: 'not-market-stallion' }

/**
 * 取得零代市場種牡馬的馬匹：新建時驗證輸入並組出資料列（isNew 為 true，由呼叫端寫入）；
 * 選既有的馬時讀取並確認是市場種牡馬。在 runWrite 的交易內呼叫，交易要包含 horses。
 * 既有的馬找不到或屬於其他局時丟出錯誤。
 */
export async function resolveZeroStallion(
  context: WriteContext,
  input: ZeroStallionInput,
): Promise<Prepared<{ horse: HorseRow; isNew: boolean }, ZeroStallionBlock>> {
  if (input.kind === 'new') {
    const prepared = await prepareNewHorse(context, input.horse, 'male')
    return prepared.ok ? { ok: true, value: { horse: prepared.value, isNew: true } } : prepared
  }
  const horse = await context.db.horses.get(input.horseId)
  if (!horse || horse.gameId !== context.game.id) {
    throw new Error(`找不到馬匹：${input.horseId}`)
  }
  if (horse.birth !== undefined || horse.sex === 'female') {
    return { ok: false, blocks: [{ kind: 'not-market-stallion' }] }
  }
  return { ok: true, value: { horse, isNew: false } }
}
