import { checkSubAbilityTotal, isSubAbilityGrade } from '../core/foal'
import { normalizeAbilityNumber } from '../core/identity'
import { normalizeSystemName } from '../core/systems'
import type { FoalExistsBlock } from './breeding-writes'
import type { WPStudBookDatabase } from './database'
import type {
  FoalDisposition,
  HorseAbility,
  HorseRow,
  Sex,
  SurfaceAptitude,
  WriteWarning,
} from './records'
import {
  confirmation,
  findSameHorse,
  gate,
  loadMare,
  resolveSire,
  runWrite,
  sameSire,
  type Prepared,
  type SireInput,
  type SireNameBlock,
  type SireRef,
  type WriteOptions,
  type WriteResult,
} from './writes'

// 自家產駒的寫入操作：建立產駒、正式馬名與牧場處置（需求規格 9.3～9.5；技術設計 4.3「寫入操作」）

/** 建立產駒的輸入（需求規格 9.3）；選填的文字欄位留空或只有空白都當作沒有填 */
export interface FoalInput {
  /** 母馬：這一局的母馬（進過自家繁殖圈），在圈與否不限 */
  damId: string
  sex: Sex
  /** 出生年；畫面預填目前遊戲年 */
  birthYear: number
  /** 父馬；連結配種紀錄時可以省略，有傳時要和配種紀錄一致 */
  sire?: SireInput
  /** 父系：父馬的子系統 */
  sireSystem?: string
  abilityNumber?: string
  ability?: HorseAbility
  /** 牝系的名稱 */
  femaleLine?: string
  note?: string
}

/** 能力中檢查值域的項目 */
export type AbilityField =
  'speed' | 'stamina' | 'subAbilities' | 'subTotal' | 'turf' | 'dirt' | 'offspringQuality'

/** 能力值不合法；field 是哪一項 */
export interface AbilityBlock {
  kind: 'ability'
  field: AbilityField
}

/**
 * 建立產駒的阻止原因：
 * - foal-exists：同一母馬同一出生年已有產駒（BRD-06），horseId 是那一匹
 * - birth-year：出生年不是整數，或晚於目前遊戲年
 * - ability-number：能力番号的格式不符
 * - same-horse：能力番号與出生年都和這一局既有的馬相同（6.2）
 * - ability：能力值不合法
 * - sire-name：父馬的外部名稱空白或只有前綴
 * - sire-mismatch：傳了父馬，但和連結的配種紀錄 breedingId 不同
 */
export type FoalBlock =
  | FoalExistsBlock
  | { kind: 'birth-year' }
  | { kind: 'ability-number' }
  | { kind: 'same-horse'; horseId: string }
  | AbilityBlock
  | SireNameBlock
  | { kind: 'sire-mismatch'; breedingId: string }

/** 芝、ダート適性的四種符號 */
const SURFACES: readonly SurfaceAptitude[] = ['◎', '○', '△', '×']

/**
 * 建立產駒（需求規格 9.3、9.5、11.4、BRD-06）；手動建立與之後的四月匯入共用。
 * 母馬「出生年減 1」那一年的配種紀錄是 `受胎` 時連結：父馬取自配種紀錄，有傳父馬而不一致時阻止；
 * 八系指定配種所生的出生紀錄記規則快照的預計產出，牧場處置為保留；自由配種所生沒有系與代數，處置為待售。
 * 沒有 `受胎` 紀錄時警告並確認，確認後不連結，父馬用輸入的（可以不知道），出生紀錄是空的，處置為待售，
 * 比照自由配種。同一母馬同一出生年已有產駒時阻止並指出那一匹；七項副能力齊全、也帶了 `サ` 而不符時警告並確認。
 * 父母名與父系的來源依事件的來源：手動為手動輸入，匯入為經匯入確認。產駒還沒有正式馬名，顯示追蹤名（9.4）。
 * 事件 foal-added。母馬找不到或屬於其他局，或父馬是找不到、屬於其他局的馬匹或牝馬時丟出錯誤。
 */
export async function addFoal(
  db: WPStudBookDatabase,
  gameId: string,
  input: FoalInput,
  options: WriteOptions = {},
): Promise<WriteResult<HorseRow, FoalBlock>> {
  return runWrite(db, gameId, [db.mares, db.horses, db.breedings], options, async (context) => {
    const { game } = context
    const { damId, birthYear } = input
    await loadMare(context, damId)
    const blocks: FoalBlock[] = []
    const existing = await db.horses
      .where('[gameId+damId]')
      .equals([game.id, damId])
      .filter((horse) => horse.birthYear === birthYear)
      .first()
    if (existing) blocks.push({ kind: 'foal-exists', horseId: existing.id })
    const yearValid = Number.isInteger(birthYear) && birthYear <= game.currentYear
    if (!yearValid) blocks.push({ kind: 'birth-year' })
    const abilityText = input.abilityNumber?.trim() ?? ''
    const abilityNumber = abilityText === '' ? undefined : normalizeAbilityNumber(abilityText)
    if (abilityNumber === null) blocks.push({ kind: 'ability-number' })
    else if (abilityNumber !== undefined && yearValid) {
      const same = await findSameHorse(context, abilityNumber, birthYear)
      if (same) blocks.push({ kind: 'same-horse', horseId: same.id })
    }
    const ability = checkAbility(input.ability)
    if (!ability.ok) blocks.push(...ability.blocks)
    const sire = input.sire === undefined ? undefined : await resolveSire(context, input.sire)
    if (sire && !sire.ok) blocks.push(...sire.blocks)
    const breeding = yearValid
      ? await db.breedings
          .where('[gameId+mareId+year]')
          .equals([game.id, damId, birthYear - 1])
          .first()
      : undefined
    const linked = breeding?.conception === '受胎' ? breeding : undefined
    if (linked && sire?.ok && !sameSire(linked, sire.value)) {
      blocks.push({ kind: 'sire-mismatch', breedingId: linked.id })
    }
    if (!ability.ok || abilityNumber === null || blocks.length > 0) {
      return { status: 'blocked', blocks }
    }

    const warnings: WriteWarning[] = []
    if (!linked) {
      warnings.push({
        kind: 'no-conception-record',
        ...(breeding === undefined ? {} : { breedingId: breeding.id }),
        ...(breeding?.conception === undefined ? {} : { conception: breeding.conception }),
      })
    }
    const imported = ability.value?.subTotal
    const total = checkSubAbilityTotal(ability.value?.subAbilities ?? {}, imported)
    if (total.mismatch && total.total !== null && imported !== undefined) {
      warnings.push({ kind: 'sub-ability-total', total: total.total, imported })
    }
    const stop = gate([], warnings, context.confirmed)
    if (stop) return stop

    const sireRef: SireRef | Record<string, never> = linked
      ? linkedSire(linked)
      : sire?.ok
        ? sire.value
        : {}
    const placement = linked?.kind === 'designated' ? linked.rule?.output : undefined
    const disposition: FoalDisposition = placement ? 'keep' : 'for-sale'
    const sireSystem = input.sireSystem === undefined ? null : normalizeSystemName(input.sireSystem)
    const pedigree = 'sireName' in sireRef || sireSystem !== null
    const femaleLine = input.femaleLine?.trim() ?? ''
    const note = input.note?.trim() ?? ''
    const foal: HorseRow = {
      id: crypto.randomUUID(),
      gameId: game.id,
      ...(abilityNumber === undefined ? {} : { abilityNumber }),
      birthYear,
      sex: input.sex,
      ...sireRef,
      damId,
      ...(sireSystem === null ? {} : { sireSystem }),
      ...(pedigree
        ? { pedigreeSource: options.source?.kind === 'import' ? 'import' : 'manual' }
        : {}),
      birth: {
        ...(linked ? { breedingId: linked.id } : {}),
        ...(placement ? { placement } : {}),
      },
      ...(ability.value === undefined ? {} : { ability: ability.value }),
      ...(femaleLine === '' ? {} : { femaleLine }),
      disposition,
      ...(note === '' ? {} : { note }),
    }
    await db.horses.add(foal)
    await context.addEvent({
      kind: 'foal-added',
      horseId: foal.id,
      ...(linked ? { breedingId: linked.id } : {}),
      disposition,
      ...confirmation(warnings),
    })
    return context.done(foal, warnings)
  })
}

/** 連結的配種紀錄記的父馬：內部識別或外部名稱 */
function linkedSire(breeding: {
  sireId?: string
  sireName?: string
}): SireRef | Record<string, never> {
  if (breeding.sireId !== undefined) return { sireId: breeding.sireId }
  if (breeding.sireName !== undefined) return { sireName: breeding.sireName }
  return {}
}

/**
 * 驗證能力值並統一寫法（需求規格 4.7、9.3）：SP、ST 為 0 以上的整數，七項副能力為 G～S+，
 * `サ` 為 0～105 的整數，芝與ダート為 ◎○△× 之一，出生時的仔出為 0～15 的整數；距離適性原樣存文字，
 * 去掉前後空白。阻止原因依上面的順序列全。沒有填的項目不存，全部沒有時為 undefined
 */
function checkAbility(
  ability: HorseAbility | undefined,
): Prepared<HorseAbility | undefined, AbilityBlock> {
  if (ability === undefined) return { ok: true, value: undefined }
  const blocks: AbilityBlock[] = []
  const integer = (field: AbilityField, value: number | undefined, max?: number) => {
    const valid =
      value === undefined ||
      (Number.isInteger(value) && value >= 0 && (max === undefined || value <= max))
    if (!valid) blocks.push({ kind: 'ability', field })
  }
  integer('speed', ability.speed)
  integer('stamina', ability.stamina)
  const subAbilities = compact(ability.subAbilities ?? {})
  if (!Object.values(subAbilities).every((grade) => isSubAbilityGrade(grade))) {
    blocks.push({ kind: 'ability', field: 'subAbilities' })
  }
  integer('subTotal', ability.subTotal, 105)
  for (const field of ['turf', 'dirt'] as const) {
    const value = ability[field]
    if (value !== undefined && !SURFACES.includes(value)) blocks.push({ kind: 'ability', field })
  }
  integer('offspringQuality', ability.offspringQuality, 15)
  if (blocks.length > 0) return { ok: false, blocks }
  const distance = ability.distance?.trim() ?? ''
  const value = compact({
    ...ability,
    subAbilities: Object.keys(subAbilities).length === 0 ? undefined : subAbilities,
    distance: distance === '' ? undefined : distance,
  })
  return { ok: true, value: Object.keys(value).length === 0 ? undefined : value }
}

/** 去掉值是 undefined 的欄位 */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}
