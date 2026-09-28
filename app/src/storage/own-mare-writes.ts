import { chooseKeptSister, entrySisterStatus } from '../core/sisters'
import type { WPStudBookDatabase } from './database'
import { buildOwnMares } from './inputs'
import { loadSisters, loadSuccessorCandidate } from './loaders'
import { assertBase, placementOf } from './mare-assignment'
import type { Base, MareRow } from './records'
import {
  checkOwnSuccessor,
  loadFoal,
  loadMare,
  runWrite,
  type SuccessorCheckBlock,
  type UnchangedBlock,
  type WriteOptions,
  type WriteResult,
} from './writes'

// 自家母駒的寫入操作：轉入繁殖圈與選定正式保留（需求規格 8.4、8.9、9.6；技術設計 4.3「寫入操作」）

/** 自家母駒轉入的輸入 */
export interface TransferFillyInput {
  /** 據點；還不知道時省略 */
  location?: Base
  /** 來源（所屬競走馬引退轉入）的備註；只有空白時不寫 */
  note?: string
}

/** 母馬的用途、母馬群、接替狀態與是否使該代成立 */
type EntryGroup = Pick<
  MareRow,
  'usage' | 'groupLine' | 'groupGeneration' | 'sisterStatus' | 'establishedGeneration'
>

/**
 * 自家母駒轉入繁殖圈（需求規格 8.4、8.9、9.6、11.5、LINE-17、MARE-07）：
 * 八系指定配種所生以 9.6 再核對（目標是出生紀錄的系與代數），不符時阻止；通過時用途為自家，
 * 母馬群依出生紀錄，接替狀態以 entrySisterStatus 判定（姊妹不在圈內 → 暫定保留；已有姊妹在圈 → 候選），
 * 暫定保留時該代成立（establishedGeneration 為 true）。自由配種所生或比照自由配種（沒有連結配種紀錄）：
 * 生產中，用途為自由配種所生，不分群、沒有接替狀態（11.5）。來源為所屬競走馬引退轉入；
 * 不設年齡門檻，不改牧場處置。事件 mare-transferred 記用途與母馬群、接替狀態與據點。
 * 馬匹找不到、屬於其他局、不是自家產駒或不是牝駒，已經進過繁殖圈（改用買回），或據點不是 32～35 時丟出錯誤。
 */
export async function transferFilly(
  db: WPStudBookDatabase,
  gameId: string,
  horseId: string,
  input: TransferFillyInput = {},
  options: WriteOptions = {},
): Promise<WriteResult<MareRow, SuccessorCheckBlock>> {
  if (input.location !== undefined) assertBase(input.location)
  return runWrite(db, gameId, [db.horses, db.mares, db.breedings], options, async (context) => {
    const horse = await loadFoal(context, horseId)
    if (horse.sex !== 'female') throw new Error(`只有牝駒可以轉入繁殖圈：${horseId}`)
    if (await db.mares.get(horseId)) throw new Error(`已經進過繁殖圈的母馬要用買回：${horseId}`)
    const candidate = await loadSuccessorCandidate(db, gameId, horseId)
    let group: EntryGroup
    if (candidate.origin.kind === 'free') {
      group = { usage: 'free', establishedGeneration: false }
    } else {
      const checked = checkOwnSuccessor(candidate)
      if (!checked.ok) return { status: 'blocked', blocks: checked.blocks }
      const sisters = await loadSisters(db, gameId, horse.sireId, horse.damId)
      const sisterStatus = entrySisterStatus(
        { id: horseId, sireId: horse.sireId, damId: horse.damId },
        sisters,
      )
      group = {
        usage: 'own',
        groupLine: checked.value.line,
        groupGeneration: checked.value.generation,
        sisterStatus,
        establishedGeneration: sisterStatus === 'provisional',
      }
    }
    const note = input.note?.trim() ?? ''
    const mare: MareRow = {
      horseId,
      gameId,
      ...group,
      herd: 'in-herd',
      source: { kind: 'retired-racehorse', ...(note === '' ? {} : { note }) },
      ...(input.location === undefined ? {} : { location: input.location }),
    }
    await db.mares.add(mare)
    await context.addEvent({
      kind: 'mare-transferred',
      horseId,
      placement: placementOf(mare),
      ...(mare.sisterStatus === undefined ? {} : { sisterStatus: mare.sisterStatus }),
      ...(mare.location === undefined ? {} : { location: mare.location }),
    })
    return context.done(mare)
  })
}

/**
 * 選定正式保留（需求規格 8.9、MARE-12、MARE-24）：以 chooseKeptSister 套用，她改為正式保留，
 * 同父同母、在圈而且列入任務的姊妹改為已被取代；已被取代、已售出與不在圈內的姊妹不變。沒有姊妹時也可以選。
 * 選為正式保留時該代成立（establishedGeneration 設為 true，不改回，8.2）。沒有任何變化時阻止。
 * 狀態有變的每匹母馬各寫一筆事件 sister-status-changed，記原狀態、新狀態與選定的母馬；
 * 回傳狀態有變的母馬，選定的那一匹在前。之後改保留另一匹，對她再做一次。
 * 母馬或她的馬匹找不到、屬於其他局，或不是自家母駒時丟出錯誤；不在圈內時 chooseKeptSister 丟出 RangeError
 * （畫面只列出在圈的姊妹）。
 */
export async function keepSister(
  db: WPStudBookDatabase,
  gameId: string,
  horseId: string,
  options: WriteOptions = {},
): Promise<WriteResult<MareRow[], UnchangedBlock>> {
  return runWrite(db, gameId, [db.horses, db.mares], options, async (context) => {
    const mare = await loadMare(context, horseId)
    if (mare.usage !== 'own') throw new Error(`只有自家母駒有接替狀態：${horseId}`)
    const horse = await db.horses.get(horseId)
    if (!horse) throw new Error(`找不到馬匹：${horseId}`)
    // 父母任一方不明時 loadSisters 讀不到她自己，所以另外放進去；讀到兩次不影響結果（同一匹不算姊妹）
    const sisters = await loadSisters(db, gameId, horse.sireId, horse.damId)
    const changes = chooseKeptSister(horseId, [...buildOwnMares([mare], [horse]), ...sisters])
    if (changes.length === 0) return { status: 'blocked', blocks: [{ kind: 'unchanged' }] }
    const saved: MareRow[] = []
    for (const change of changes) {
      const current = await loadMare(context, change.id)
      const next: MareRow = {
        ...current,
        sisterStatus: change.to,
        ...(change.to === 'kept' ? { establishedGeneration: true } : {}),
      }
      await db.mares.put(next)
      await context.addEvent({
        kind: 'sister-status-changed',
        horseId: change.id,
        from: change.from,
        to: change.to,
        keptHorseId: horseId,
      })
      saved.push(next)
    }
    return context.done(saved)
  })
}
