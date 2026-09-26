import type { Table } from 'dexie'
import { normalizeAbilityNumber, splitHorseName } from '../core/identity'
import { normalizeSystemName } from '../core/systems'
import type { WPStudBookDatabase } from './database'
import type { EventContent, GameRow, HorseRow, Sex, WriteWarning } from './records'

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
  /** 寫一筆事件：年份為目前遊戲年，寫入時間為 now */
  addEvent(content: EventContent): Promise<void>
  /** 把遊戲局的更新時間設為 now，回傳 done */
  done<T>(value: T, warnings?: WriteWarning[]): Promise<WriteResult<T, never>>
}

/**
 * 在一個 rw 交易內執行寫入操作（技術設計 4.3「寫入操作」）：交易開始時確認遊戲局存在。
 * tables 是操作要讀寫的其他資料表，games 與 events 一定包含在交易內。
 * 呼叫端已在外層交易內時成為子交易（Dexie 的巢狀交易），外層失敗時一起回復（4.4）。
 * 遊戲局不存在時丟出錯誤。
 */
export async function runWrite<T, B>(
  db: WPStudBookDatabase,
  gameId: string,
  tables: readonly Table[],
  options: WriteOptions,
  body: (context: WriteContext) => Promise<WriteResult<T, B>>,
): Promise<WriteResult<T, B>> {
  const now = (options.now ?? new Date()).toISOString()
  return db.transaction('rw', [db.games, db.events, ...tables], async () => {
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
        })
      },
      async done(value, warnings = []) {
        await db.games.update(gameId, { updatedAt: now })
        return { status: 'done', value, warnings }
      },
    })
  })
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
  /** 父系：父馬的子系統 */
  sireSystem?: string
}

/**
 * 手動建立馬匹的阻止原因：
 * - horse-name：完整馬名空白，或只有前綴、沒有馬名（需求規格 6.4）
 * - ability-number：能力番号的格式不符
 * - birth-year：出生年不是整數，或晚於目前遊戲年
 * - same-horse：能力番号與出生年都和這一局既有的馬相同，是同一匹馬（6.2），應改選既有的馬
 */
export type NewHorseBlock =
  | { kind: 'horse-name' }
  | { kind: 'ability-number' }
  | { kind: 'birth-year' }
  | { kind: 'same-horse'; horseId: string }

/**
 * 驗證手動輸入並組出新馬匹的資料列，不寫入。馬名來源為手動輸入，
 * 能力番号統一寫法（normalizeAbilityNumber），父系去掉結尾「系」（normalizeSystemName）。
 * 在 runWrite 的交易內呼叫，交易要包含 horses。
 */
export async function prepareNewHorse(
  context: WriteContext,
  input: NewHorseInput,
  sex: Sex,
): Promise<Prepared<HorseRow, NewHorseBlock>> {
  const { db, game } = context
  const blocks: NewHorseBlock[] = []
  const name = splitHorseName(input.fullName.trim())
  if (!name) blocks.push({ kind: 'horse-name' })
  const abilityText = input.abilityNumber?.trim() ?? ''
  const abilityNumber = abilityText === '' ? undefined : normalizeAbilityNumber(abilityText)
  if (abilityNumber === null) blocks.push({ kind: 'ability-number' })
  const { birthYear } = input
  if (birthYear !== undefined && (!Number.isInteger(birthYear) || birthYear > game.currentYear)) {
    blocks.push({ kind: 'birth-year' })
  }
  if (typeof abilityNumber === 'string' && birthYear !== undefined && blocks.length === 0) {
    const same = await db.horses
      .where('[gameId+abilityNumber+birthYear]')
      .equals([game.id, abilityNumber, birthYear])
      .first()
    if (same) blocks.push({ kind: 'same-horse', horseId: same.id })
  }
  if (!name || abilityNumber === null || blocks.length > 0) return { ok: false, blocks }
  const sireSystem = input.sireSystem === undefined ? null : normalizeSystemName(input.sireSystem)
  return {
    ok: true,
    value: {
      id: crypto.randomUUID(),
      gameId: game.id,
      fullName: name.fullName,
      baseName: name.baseName,
      nameSource: 'manual',
      ...(abilityNumber === undefined ? {} : { abilityNumber }),
      ...(birthYear === undefined ? {} : { birthYear }),
      sex,
      ...(sireSystem === null ? {} : { sireSystem }),
    },
  }
}
