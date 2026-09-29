import { checkSubAbilityTotal, isSubAbilityGrade } from '../core/foal'
import { normalizeAbilityNumber, splitHorseName } from '../core/identity'
import { normalizeSystemName } from '../core/systems'
import type { WPStudBookDatabase } from './database'
import type {
  Conception,
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
  loadFoal,
  loadMare,
  resolveSire,
  runWrite,
  sameSire,
  type FoalExistsBlock,
  type Prepared,
  type SireInput,
  type SireNameBlock,
  type SireRef,
  type UnchangedBlock,
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
 * 正式馬名的阻止原因：
 * - name-confirmed：馬名經匯入確認（一月總表填入），不能再手動修改或清空（9.4）
 * - horse-name：只有前綴、沒有馬名（6.4）
 * - unchanged：和目前相同
 */
export type FoalNameBlock = { kind: 'name-confirmed' } | { kind: 'horse-name' } | UnchangedBlock

/** 牧場處置的阻止原因：free-foal 是出生紀錄沒有系與代數的產駒不能改為保留（9.5）；和目前相同 */
export type DispositionBlock = { kind: 'free-foal' } | UnchangedBlock

/**
 * 重新連結出生紀錄的阻止原因：
 * - no-conception-record：母馬「出生年減 1」那一年沒有 `受胎` 的配種紀錄；有紀錄時附那一筆的識別與狀態
 * - sire-mismatch：產駒已記的父馬和配種紀錄 breedingId 不同
 * - mare-entered：牝駒已轉入繁殖圈，連到八系指定配種會改變她的系與代數
 *   （技術設計 4.3「自家母駒與出生紀錄的一致性」）
 */
export type RelinkBlock =
  | { kind: 'no-conception-record'; breedingId?: string; conception?: Conception }
  | { kind: 'sire-mismatch'; breedingId: string }
  | { kind: 'mare-entered' }

/** 牧場處置的三種值 */
const DISPOSITIONS: readonly FoalDisposition[] = ['keep', 'for-sale', 'sold']

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
      ? (sireOf(linked) ?? {})
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

/**
 * 填入、更正或清空自家產駒的正式馬名（需求規格 9.4、BRD-08、BRD-10）：只限自家產駒（有出生紀錄）；
 * 市場馬的手動馬名用 correctHorse。馬名經匯入確認時阻止；fullName 是 null 或只有空白時清空，
 * 清空後沒有馬名，顯示回退追蹤名。基本馬名跟著完整馬名，馬名來源為手動輸入；牧場處置不變。
 * 事件 foal-named 記原名與新名；一月總表取代手動名時的別名由 CE 匯入計畫處理。
 * 馬匹找不到、屬於其他局或不是自家產駒時丟出錯誤。
 */
export async function nameFoal(
  db: WPStudBookDatabase,
  gameId: string,
  horseId: string,
  fullName: string | null,
  options: WriteOptions = {},
): Promise<WriteResult<HorseRow, FoalNameBlock>> {
  return runWrite(db, gameId, [db.horses], options, async (context) => {
    const current = await loadFoal(context, horseId)
    const text = fullName?.trim() ?? ''
    const name = text === '' ? undefined : splitHorseName(text)
    const blocks: FoalNameBlock[] = []
    if (current.nameSource === 'import') blocks.push({ kind: 'name-confirmed' })
    else if (name === null) blocks.push({ kind: 'horse-name' })
    else if (name?.fullName === current.fullName) blocks.push({ kind: 'unchanged' })
    if (name === null || blocks.length > 0) return { status: 'blocked', blocks }
    const foal: HorseRow = { ...current }
    if (name) {
      foal.fullName = name.fullName
      foal.baseName = name.baseName
      foal.nameSource = 'manual'
    } else {
      delete foal.fullName
      delete foal.baseName
      delete foal.nameSource
    }
    await db.horses.put(foal)
    await context.addEvent({
      kind: 'foal-named',
      horseId,
      ...(current.fullName === undefined ? {} : { from: current.fullName }),
      ...(name ? { to: name.fullName } : {}),
    })
    return context.done(foal)
  })
}

/**
 * 牧場處置（需求規格 9.3、9.5、BRD-15、BRD-26）：保留、待售、已售出。只限自家產駒；
 * 出生紀錄沒有系與代數的產駒（自由配種所生或比照自由配種）不能改為保留；和目前相同時阻止。
 * 事件 foal-disposition-changed 記原處置與新處置。馬匹找不到、屬於其他局或不是自家產駒、
 * 處置不是三種之一時丟出錯誤；自家產駒缺少牧場處置時丟出 RangeError。
 */
export async function setFoalDisposition(
  db: WPStudBookDatabase,
  gameId: string,
  horseId: string,
  disposition: FoalDisposition,
  options: WriteOptions = {},
): Promise<WriteResult<HorseRow, DispositionBlock>> {
  if (!DISPOSITIONS.includes(disposition)) throw new Error(`牧場處置不符：${disposition}`)
  return runWrite(db, gameId, [db.horses], options, async (context) => {
    const current = await loadFoal(context, horseId)
    const from = current.disposition
    if (from === undefined) throw new RangeError(`自家產駒缺少牧場處置：${horseId}`)
    const blocks: DispositionBlock[] = []
    if (disposition === from) blocks.push({ kind: 'unchanged' })
    else if (disposition === 'keep' && current.birth?.placement === undefined) {
      blocks.push({ kind: 'free-foal' })
    }
    if (blocks.length > 0) return { status: 'blocked', blocks }
    const foal: HorseRow = { ...current, disposition }
    await db.horses.put(foal)
    await context.addEvent({ kind: 'foal-disposition-changed', horseId, from, to: disposition })
    return context.done(foal)
  })
}

/**
 * 重新連結出生紀錄（需求規格 9.3、BRD-27）：產駒建立後才把母馬前一年的紀錄改成 `受胎` 時使用。
 * 只限沒有連結配種紀錄的自家產駒；母馬「出生年減 1」那一年的配種紀錄要是 `受胎`，產駒已記的父馬要和紀錄相同。
 * 連結後出生紀錄記配種紀錄，八系指定配種所生另記規則快照的預計產出；父馬取自紀錄（原本沒有時補上），
 * 補上外部父馬名而原本沒有父母名的來源時，來源依事件的來源（同 addFoal）。
 * 連到八系指定配種、原本待售時牧場處置改為保留，比照 addFoal 的預設（原本待售是沒有連結時強制的）；
 * 已售出不變，連到自由配種也不變。已轉入繁殖圈的牝駒連到八系指定配種時阻止。母馬不必在圈。
 * 事件 foal-linked 記配種紀錄與牧場處置的變化。
 * 馬匹找不到、屬於其他局、不是自家產駒或已經連結配種紀錄時丟出錯誤；自家產駒缺少母馬或出生年時丟出 RangeError。
 */
export async function relinkFoal(
  db: WPStudBookDatabase,
  gameId: string,
  horseId: string,
  options: WriteOptions = {},
): Promise<WriteResult<HorseRow, RelinkBlock>> {
  return runWrite(db, gameId, [db.horses, db.breedings, db.mares], options, async (context) => {
    const foal = await loadFoal(context, horseId)
    if (foal.birth?.breedingId !== undefined) throw new Error(`產駒已經連結配種紀錄：${horseId}`)
    const { damId, birthYear } = foal
    if (damId === undefined || birthYear === undefined) {
      throw new RangeError(`自家產駒缺少母馬或出生年：${horseId}`)
    }
    const breeding = await db.breedings
      .where('[gameId+mareId+year]')
      .equals([gameId, damId, birthYear - 1])
      .first()
    if (breeding?.conception !== '受胎') {
      const block: RelinkBlock = {
        kind: 'no-conception-record',
        ...(breeding === undefined ? {} : { breedingId: breeding.id }),
        ...(breeding?.conception === undefined ? {} : { conception: breeding.conception }),
      }
      return { status: 'blocked', blocks: [block] }
    }
    const placement = breeding.kind === 'designated' ? breeding.rule?.output : undefined
    const recorded = sireOf(foal)
    const blocks: RelinkBlock[] = []
    if (recorded && !sameSire(breeding, recorded)) {
      blocks.push({ kind: 'sire-mismatch', breedingId: breeding.id })
    }
    if (placement && (await db.mares.get(horseId))) blocks.push({ kind: 'mare-entered' })
    if (blocks.length > 0) return { status: 'blocked', blocks }

    const importing = context.source.kind === 'import'
    const addsPedigree = breeding.sireName !== undefined && foal.pedigreeSource === undefined
    const keep = placement !== undefined && foal.disposition === 'for-sale'
    const next: HorseRow = {
      ...foal,
      ...sireOf(breeding),
      ...(addsPedigree ? { pedigreeSource: importing ? 'import' : 'manual' } : {}),
      birth: { breedingId: breeding.id, ...(placement === undefined ? {} : { placement }) },
      ...(keep ? { disposition: 'keep' } : {}),
    }
    await db.horses.put(next)
    await context.addEvent({
      kind: 'foal-linked',
      horseId,
      breedingId: breeding.id,
      ...(keep ? { disposition: { from: 'for-sale', to: 'keep' } } : {}),
    })
    return context.done(next)
  })
}

/** 資料列（配種紀錄或產駒）記的父馬：內部識別或外部名稱；都沒有時為 undefined */
function sireOf(row: { sireId?: string; sireName?: string }): SireRef | undefined {
  if (row.sireId !== undefined) return { sireId: row.sireId }
  if (row.sireName !== undefined) return { sireName: row.sireName }
  return undefined
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
