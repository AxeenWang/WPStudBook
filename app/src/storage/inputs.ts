import type { KnownHorse } from '../core/identity'
import type { MareAgeSettings } from '../core/mares'
import type { OwnMare } from '../core/sisters'
import type { StallionRecord } from '../core/stallions'
import type { SubstituteMare } from '../core/substitute'
import type { SuccessorCandidate } from '../core/successor'
import type { BreedingRow, HorseRow, MareRow, SettingsRow, StallionRow } from './records'
import { damRoleOf, ownSisterStatus } from './snapshot'

// 規則輸入快照以外的核心輸入（技術設計 4.3「規則輸入快照的彙整」）。全部是純函式。

/** 母馬的年齡設定（需求規格 8.5），取自這一局的設定 */
export function mareAgeSettings(settings: SettingsRow): MareAgeSettings {
  return { retirementAge: settings.retirementAge, seniorAge: settings.seniorAge }
}

/**
 * 判斷姊妹接替用的自家母駒（需求規格 8.9）：mares 中用途為自家母駒的，帶上馬匹記載的父母。
 * 找不到馬匹資料或缺少接替狀態時丟出錯誤。
 */
export function buildOwnMares(mares: readonly MareRow[], horses: readonly HorseRow[]): OwnMare[] {
  const byId = horseMap(horses)
  return mares
    .filter((mare) => mare.usage === 'own')
    .map((mare) => {
      const horse = requireHorse(byId, mare.horseId)
      return {
        id: mare.horseId,
        sireId: horse.sireId,
        damId: horse.damId,
        inHerd: mare.herd === 'in-herd',
        status: ownSisterStatus(mare),
      }
    })
}

/**
 * 兄弟比較與選定現任用的種牡馬紀錄（需求規格 7.7）：有馬匹的任用，帶上馬匹記載的父馬；
 * 尚未誕生的預定後繼沒有馬匹，不列入。找不到馬匹資料時丟出錯誤。
 */
export function buildStallionRecords(
  stallions: readonly StallionRow[],
  horses: readonly HorseRow[],
): StallionRecord[] {
  const byId = horseMap(horses)
  return stallions.flatMap((row) => {
    if (row.horseId === undefined) return []
    const horse = requireHorse(byId, row.horseId)
    return [
      {
        id: row.horseId,
        placement: { line: row.line, generation: row.generation },
        sireId: horse.sireId,
        status: row.status,
      },
    ]
  })
}

/**
 * 正式後繼核對用的產駒（需求規格 9.6）：產駒記載的父母，加上出生紀錄連結的配種紀錄的規則快照。
 * 沒有配種紀錄、自由配種、沒有規則快照，或出生紀錄沒有系與代數時，比照自由配種。
 * breeding 不是這匹產駒出生紀錄連結的配種紀錄時丟出 RangeError。
 */
export function buildSuccessorCandidate(
  foal: HorseRow,
  breeding: BreedingRow | undefined,
): SuccessorCandidate {
  if (breeding && foal.birth?.breedingId !== breeding.id) {
    throw new RangeError(`配種紀錄 ${breeding.id} 不是產駒 ${foal.id} 的出生紀錄`)
  }
  const parents = { sireId: foal.sireId, damId: foal.damId }
  const placement = foal.birth?.placement
  const rule = breeding?.kind === 'designated' ? breeding.rule : undefined
  if (!breeding || !rule || !placement) return { ...parents, origin: { kind: 'free' } }
  return {
    ...parents,
    origin: {
      kind: 'designated',
      breedingSireId: breeding.sireId,
      breedingDamId: breeding.mareId,
      sire: rule.sire,
      dam: rule.dam,
      recorded: placement,
      restoration: rule.restoration,
    },
  }
}

/**
 * 8.3 親系統檢查用的同代替代母馬：替代第 generation 代的市場母馬，包含已離圈的，
 * 因為她已生的產駒仍會出現在後代的 3 代前（技術設計 4.3）。
 * exceptHorseId 是正在檢查的母馬本身（例如修改用途時），不和自己比較。找不到馬匹資料時丟出錯誤。
 */
export function buildSubstituteMares(
  mares: readonly MareRow[],
  horses: readonly HorseRow[],
  generation: number,
  exceptHorseId?: string,
): SubstituteMare[] {
  const byId = horseMap(horses)
  return mares.flatMap((mare) => {
    const role = damRoleOf(mare)
    if (role?.kind !== 'substitute' || role.forGeneration !== generation) return []
    if (mare.horseId === exceptHorseId) return []
    const horse = requireHorse(byId, mare.horseId)
    return [
      {
        forLine: role.forLine,
        forGeneration: role.forGeneration,
        ownSireSystem: horse.sireSystem,
      },
    ]
  })
}

/**
 * 身分比對用的既有馬匹（需求規格 6.2；技術設計 4.2「身分、母馬、種牡馬與後繼」）：只傳同一局的馬。
 * 馬名只傳正式馬名的基本馬名；父母名優先用保存的匯入名稱，沒有才用連結馬匹的基本馬名。
 * 連結的父母不在 horses 中時丟出錯誤。
 */
export function buildKnownHorses(horses: readonly HorseRow[]): KnownHorse[] {
  const byId = horseMap(horses)
  const parentName = (name: string | undefined, id: string | undefined) =>
    name ?? (id === undefined ? undefined : requireHorse(byId, id).baseName)
  return horses.map((horse) => ({
    id: horse.id,
    abilityNumber: horse.abilityNumber,
    birthYear: horse.birthYear,
    name: horse.baseName,
    manualName: horse.nameSource === 'manual',
    sireName: parentName(horse.sireName, horse.sireId),
    damName: parentName(horse.damName, horse.damId),
  }))
}

function horseMap(horses: readonly HorseRow[]): Map<string, HorseRow> {
  return new Map(horses.map((horse) => [horse.id, horse]))
}

function requireHorse(horses: ReadonlyMap<string, HorseRow>, id: string): HorseRow {
  const horse = horses.get(id)
  if (!horse) throw new Error(`找不到馬匹：${id}`)
  return horse
}
