import { isBase, type Base } from '../core/horse'
import {
  matchHorse,
  splitHorseName,
  type HorseMatch,
  type IdentityConflictReason,
  type KnownHorse,
} from '../core/identity'
import type {
  HerdSummary,
  ImportHorse,
  ImportMare,
  ImportMode,
  ImportSnapshot,
  MareCreateItem,
  MayItem,
} from '../core/imports'
import type { LinePosition } from '../core/lines'
import {
  DEFAULT_MARE_AGE_SETTINGS,
  ageInYear,
  defaultAbsenceReason,
  type AbsenceReason,
  type MareAssignment,
  type MareUsage,
} from '../core/mares'
import type { ImportContent } from './flow'
import type { BroodmareEntry } from './formats'

// 五月繁殖圈名單的配對與預覽（需求規格 11.5；技術設計 4.4「五月對帳」）

/** 配對方式：能力番号＋出生年、唯一馬名輔助，或使用者指定給未配對的母馬 */
export type MayMatch = 'ability-number' | 'name' | 'picked'

/**
 * 列的分類（技術設計 4.4「五月對帳」）：
 * - continuing：繼續在圈，配到在圈的母馬
 * - revoked：資料更正時，配到被更正的那次匯入判定缺席的母馬，撤銷離圈（需求規格 11.5「資料更正」）
 * - sold-present：已登記賣出卻仍在名單（MAY-13），待核對
 * - returned：回歸（ID-04），配到其他已離圈的母馬
 * - new-own：新進的自家產駒，配到還沒進過繁殖圈的自家牝駒
 * - new-other：新進的其他母馬，沒配到任何紀錄
 */
export type MayRowKind =
  'continuing' | 'revoked' | 'sold-present' | 'returned' | 'new-own' | 'new-other'

/**
 * 一列要做的變更：
 * - identity：補上的能力番号與出生年（只列原本空白的）
 * - location：據點和目前不同時的原值（原本不知道或新進時沒有）與新值
 * - horseNumber：新的繁殖牝馬馬番号；已記過時留空
 */
export interface MayChanges {
  identity?: { abilityNumber?: string; birthYear?: number }
  location?: { from?: Base; to: Base }
  horseNumber?: string
}

/** 警告：新進（其他）的第 1 欄去掉前綴後的基本馬名 split 與第 59 欄 baseName 不同；照樣建立，基本馬名取第 59 欄 */
export interface MayWarning {
  kind: 'base-name'
  split: string
  baseName: string
}

/** 沒有錯誤的一列：分類、配到的母馬或牝駒（新進其他沒有）、配對方式、變更、警告與套用的項目 */
export interface MayRow {
  line: number
  kind: MayRowKind
  horseId?: string
  match?: MayMatch
  changes: MayChanges
  warnings: MayWarning[]
  /** 已登記賣出卻仍在名單的處理；還沒選時留空 */
  resolution?: SoldPresentResolution
  /** 這一列的項目；什麼都不用改或待核對時是空的 */
  items: MayItem[]
}

/**
 * 錯誤的原因（技術設計 4.4「五月對帳」），錯誤的列不套用：
 * - matchHorse 判出的衝突：name、sire、dam（經匯入確認的馬名或父母明顯不符）、ability-number（以馬名配到的紀錄
 *   已有不同的能力番号）、ambiguous（無法唯一判斷，或同一筆紀錄被兩列以上配到）
 * - horse-name：第 1 欄只有前綴、沒有馬名，或第 59 欄空白（需求規格 6.4）
 */
export type MayErrorReason = IdentityConflictReason | 'horse-name'

/** 錯誤的一列：行號、指到的母馬或牝駒（算見到，不判缺席）與原因 */
export interface MayError {
  line: number
  horseIds: string[]
  reasons: MayErrorReason[]
}

/** 缺席的母馬：判斷用的馬齡（不明時留空）、預設原因與要套用的原因 */
export interface MayAbsence {
  horseId: string
  /** 名單年份減 1 那年的馬齡；出生年晚於那一年時留空 */
  age?: number
  defaultReason: AbsenceReason
  reason: AbsenceReason
}

/**
 * 未配對的母馬（需求規格 11.5「未配對」）：可以指定的列是能力番号與出生年不矛盾、還沒被指定的新進（其他）
 */
export interface MayUnmatched {
  horseId: string
  candidates: number[]
  /** 使用者的處理：指定的行號，或確認缺席的原因；還沒處理時留空 */
  resolution?: { line: number } | { reason: AbsenceReason }
}

/** 用途把關清單上的一匹（MAY-11）：既有的母馬以識別、新進（其他）以行號；目前的用途與選的用途 */
export interface MayUsageEntry {
  key: string | number
  current: { usage: MareUsage; groupLine?: LinePosition; groupGeneration?: number }
  /** 使用者選的用途；沒選時留空，維持目前的用途 */
  decision?: UsageDecision
}

/** 已登記賣出卻仍在名單的處理（MAY-13）：撤銷賣出紀錄，或視為買回 */
export type SoldPresentResolution = 'revoke' | 'buyback'

/**
 * 用途把關選的用途（MAY-11）：任務看板上的一條配對或待指定用途；零代種牡馬的配對要附例外補入原因（7.3）。
 * confirmed 是套用回傳 item-unconfirmed 之後，使用者確認了這一匹的警告。與目前相同的用途畫面不送出
 * （繼續在圈的母馬改成相同用途時，修改用途的寫入操作會阻止）
 */
export interface UsageDecision {
  assignment: MareAssignment
  exceptionReason?: string
  confirmed?: true
}

/**
 * 預覽中使用者的決定（技術設計 4.4「五月對帳」），畫面每改一次就重新預覽：
 * - absences：母馬 → 售出或定年引退，改缺席的預設原因，或確認未配對的母馬缺席
 * - picks：未配對的母馬 → 行號，指定新進（其他）的一列
 * - soldPresent：已登記賣出卻仍在名單的母馬 → 撤銷離圈或視為買回
 * - usages：用途把關清單上的母馬（既有的以識別、新進其他以行號）→ 用途
 */
export interface MayDecisions {
  absences?: ReadonlyMap<string, AbsenceReason>
  picks?: ReadonlyMap<string, number>
  soldPresent?: ReadonlyMap<string, SoldPresentResolution>
  usages?: ReadonlyMap<string | number, UsageDecision>
}

/**
 * IMP-05 的筆數：以列計，可套用（有項目的列）、略過（什麼都不用改的列）、待核對（已登記賣出還沒處理的列）、
 * 錯誤加起來等於列數；警告是可套用的列中有警告的列數
 */
export interface MayCounts {
  applicable: number
  skipped: number
  pending: number
  errors: number
  warnings: number
}

/** 五月的預覽（技術設計 4.4「五月對帳」） */
export interface MayPreview {
  /** 名單的年份 */
  year: number
  /** 檔案的列數 */
  total: number
  rows: MayRow[]
  errors: MayError[]
  absences: MayAbsence[]
  /** 上次五月之後手動登記賣出、這次缺席的母馬：照紀錄，不產生項目（MAY-12） */
  registeredSales: string[]
  unmatched: MayUnmatched[]
  usages: MayUsageEntry[]
  herd: HerdSummary
  counts: MayCounts
}

/**
 * 五月繁殖圈名單的配對與預覽（需求規格 11.5，技術設計 4.4「五月對帳」）。快照要有五月的資料，否則丟出錯誤；
 * 快照有較晚的五月（laterMay）時丟出 RangeError：較早年份的名單只能回溯後重新匯入（需求規格 11.5「較晚的五月已套用」）。
 * 母馬與還沒進過繁殖圈的自家牝駒以 matchHorse 配對（能力番号＋出生年，配不到時以唯一馬名輔助）；同一筆紀錄
 * 被兩列以上配到時那幾列都是衝突。沒被任何列見到的在圈母馬：有能力番号與出生年的缺席，預設原因看名單年份減 1
 * 那年的馬齡；缺能力番号或出生年的是未配對。decisions 是使用者的決定，不合法時丟出 RangeError（畫面不會送出）：
 * absences 的母馬不是缺席或未配對、soldPresent 的母馬不是已登記賣出卻仍在名單、usages 的對象不在用途把關清單，
 * 以及未配對的指定不合法（resolveUnmatched）。牧場不是 32～35 時丟出 RangeError（解析已擋下）
 */
export function previewMay(
  entries: readonly BroodmareEntry[],
  snapshot: ImportSnapshot,
  mode: ImportMode,
  decisions: MayDecisions = {},
): MayPreview {
  const { may } = snapshot
  if (may === undefined) throw new Error('快照沒有五月繁殖圈名單的資料')
  if (may.laterMay !== undefined) {
    throw new RangeError(`已套用 ${may.laterMay.year} 年的五月繁殖圈名單，較早年份的名單請改用回溯`)
  }
  const mares = new Map(may.mares.map((mare) => [mare.id, mare]))
  const horses = new Map<string, ImportHorse>(
    [...may.mares, ...may.fillies].map((horse) => [horse.id, horse]),
  )
  const results = matchRows(entries, [...horses.values()].map(knownHorse))
  const seen = new Set(results.flatMap(({ found }) => foundIds(found)))
  // 新進（其他）的列：沒配到任何紀錄、馬名沒有問題
  const newEntries = results
    .filter(({ entry, found }) => found.kind === 'new' && !horseNameError(entry))
    .map(({ entry }) => entry)

  // 沒被見到的在圈母馬：有能力番号與出生年的缺席，缺的是未配對
  const settings = { ...DEFAULT_MARE_AGE_SETTINGS, retirementAge: may.retirementAge }
  const absences: MayAbsence[] = []
  const unmatched: MayUnmatched[] = []
  for (const mare of may.mares) {
    if (mare.herd !== 'in-herd' || seen.has(mare.id)) continue
    if (mare.abilityNumber === undefined || mare.birthYear === undefined) {
      const candidates = newEntries
        .filter((entry) => consistent(mare, entry))
        .map((entry) => entry.line)
      unmatched.push({ horseId: mare.id, candidates })
    } else {
      const age = lastMayAge(mare.birthYear, may.year)
      const defaultReason = defaultAbsenceReason(age, settings)
      absences.push({
        horseId: mare.id,
        ...(age === undefined ? {} : { age }),
        defaultReason,
        reason: decisions.absences?.get(mare.id) ?? defaultReason,
      })
    }
  }
  for (const horseId of decisions.absences?.keys() ?? []) {
    const listed = [...absences, ...unmatched].some((item) => item.horseId === horseId)
    if (!listed) throw new RangeError(`這匹母馬不是缺席或未配對：${horseId}`)
  }
  resolveUnmatched(results, unmatched, mares, decisions)
  const registeredSales = may.mares
    .filter((mare) => mare.soldByUser && !seen.has(mare.id))
    .map((mare) => mare.id)

  // 列：錯誤的不套用，其他依配到的對象分類
  const rows: MayRow[] = []
  const errors: MayError[] = []
  for (const { entry, found } of results) {
    const reasons = errorReasons(entry, found, horses)
    if (found.kind === 'conflict' || reasons.length > 0) {
      errors.push({ line: entry.line, horseIds: foundIds(found), reasons })
    } else if (found.kind === 'new') {
      rows.push(newRow(entry, decisions.usages?.get(entry.line)))
    } else {
      const horse = horses.get(found.id)
      if (horse === undefined) throw new Error(`找不到馬匹：${found.id}`)
      rows.push(matchedRow(entry, found.match, horse, mares.get(found.id), mode, decisions))
    }
  }
  for (const horseId of decisions.soldPresent?.keys() ?? []) {
    if (!rows.some((row) => row.kind === 'sold-present' && row.horseId === horseId)) {
      throw new RangeError(`這匹母馬不是已登記賣出卻仍在名單：${horseId}`)
    }
  }
  const usages = usageEntries(rows, mares, decisions.usages)
  for (const key of decisions.usages?.keys() ?? []) {
    if (!usages.some((entry) => entry.key === key)) {
      throw new RangeError(`不在用途把關清單上：${key}`)
    }
  }

  const applicable = rows.filter((row) => row.items.length > 0)
  const pending = rows.filter((row) => actingKind(row.kind, row.resolution) === undefined)
  return {
    year: may.year,
    total: entries.length,
    rows,
    errors,
    absences,
    registeredSales,
    unmatched,
    usages,
    herd: herdSummary(entries, rows, errors, absences, unmatched),
    counts: {
      applicable: applicable.length,
      skipped: rows.length - applicable.length - pending.length,
      pending: pending.length,
      errors: errors.length,
      warnings: applicable.filter((row) => row.warnings.length > 0).length,
    },
  }
}

/**
 * 五月的內容（技術設計 4.4「五月對帳」）：還有未配對的母馬沒處理時丟出 RangeError（需求規格 11.5「未配對」）。
 * 項目依離圈、撤銷離圈、補齊身分、回歸／轉入／新建、轉場、馬番号、修改用途的順序，同一類依行號；
 * 缺席依快照的順序，確認缺席的未配對接在後面。摘要的 total 是列數，另填待核對、警告與錯誤的筆數，
 * 以及 MAY-02 的筆數與據點分布
 */
export function mayContent(preview: MayPreview): ImportContent {
  const open = preview.unmatched.filter((item) => item.resolution === undefined)
  if (open.length > 0) {
    const ids = open.map((item) => item.horseId).join('、')
    throw new RangeError(`未配對的母馬還沒處理：${ids}`)
  }
  const { applicable, skipped, pending, warnings, errors } = preview.counts
  const departures = [
    ...preview.absences.map(({ horseId, reason }) => ({ horseId, reason })),
    ...preview.unmatched.flatMap(({ horseId, resolution }) =>
      resolution !== undefined && 'reason' in resolution
        ? [{ horseId, reason: resolution.reason }]
        : [],
    ),
  ].map(({ horseId, reason }): MayItem => ({ kind: 'mare-depart', horseId, reason }))
  // sort 是穩定排序：同一類維持列的順序，也就是行號的順序
  const rowItems = preview.rows
    .flatMap((row) => row.items)
    .sort((a, b) => ITEM_ORDER[a.kind] - ITEM_ORDER[b.kind])
  return {
    summary: {
      total: preview.total,
      applied: applicable,
      skipped,
      pending,
      warnings,
      errors,
      herd: preview.herd,
    },
    items: [...departures, ...rowItems],
  }
}

/** 項目的套用順序：離圈先做，回歸與轉入判定姊妹狀態（8.9）時才看得到這次的缺席；撤銷在轉入之前 */
const ITEM_ORDER: Record<MayItem['kind'], number> = {
  'mare-depart': 0,
  'mare-revoke': 1,
  'horse-identity': 2,
  'mare-return': 3,
  'filly-transfer': 3,
  'mare-create': 3,
  'mare-move': 4,
  'horse-number': 5,
  'mare-usage': 6,
}

/** 一列的配對結果：配到一筆紀錄、沒配到任何紀錄，或衝突 */
type Found =
  | { kind: 'matched'; id: string; match: MayMatch }
  | { kind: 'new' }
  | { kind: 'conflict'; ids: string[]; reasons: IdentityConflictReason[] }

/** 每一列以 matchHorse 配對；同一筆紀錄被兩列以上配到時，那幾列都改為衝突（無法唯一判斷） */
function matchRows(
  entries: readonly BroodmareEntry[],
  known: readonly KnownHorse[],
): { entry: BroodmareEntry; found: Found }[] {
  const results = entries.map((entry) => ({
    entry,
    found: foundOf(
      matchHorse(
        {
          abilityNumber: entry.abilityNumber,
          birthYear: entry.birthYear,
          name: entry.baseName,
          sireName: parentName(entry.sireName),
          damName: parentName(entry.damName),
        },
        known,
      ),
    ),
  }))
  const claims = new Map<string, number>()
  for (const { found } of results) {
    if (found.kind === 'matched') claims.set(found.id, (claims.get(found.id) ?? 0) + 1)
  }
  return results.map(({ entry, found }) =>
    found.kind === 'matched' && (claims.get(found.id) ?? 0) > 1
      ? { entry, found: { kind: 'conflict', ids: [found.id], reasons: ['ambiguous'] } }
      : { entry, found },
  )
}

/** matchHorse 的結果換成列的配對結果 */
function foundOf(match: HorseMatch): Found {
  switch (match.kind) {
    case 'same':
      return { kind: 'matched', id: match.id, match: 'ability-number' }
    case 'assisted':
      return { kind: 'matched', id: match.id, match: 'name' }
    case 'new':
      return { kind: 'new' }
    case 'conflict':
      return { kind: 'conflict', ids: match.ids, reasons: match.reasons }
  }
}

/** 列指到的紀錄：配到的那一筆或衝突的那幾筆；這些母馬算見到，不判缺席 */
function foundIds(found: Found): string[] {
  if (found.kind === 'matched') return [found.id]
  return found.kind === 'conflict' ? found.ids : []
}

/** 比對用的既有馬匹：馬名用基本馬名，父母名用經匯入確認的名稱（技術設計 4.2「同一匹馬」） */
function knownHorse(horse: ImportHorse): KnownHorse {
  return {
    id: horse.id,
    abilityNumber: horse.abilityNumber,
    birthYear: horse.birthYear,
    name: horse.baseName,
    manualName: horse.nameSource === 'manual',
    sireName: horse.sire.confirmed,
    damName: horse.dam.confirmed,
  }
}

/** 檔案的父母名去掉前綴的基本馬名；空白或只有前綴時為 undefined */
function parentName(text: string): string | undefined {
  return splitHorseName(text.trim())?.baseName
}

/** 這一列的據點；解析已擋下 32～35 以外的值，不符時丟出 RangeError */
function baseOf(entry: BroodmareEntry): Base {
  if (!isBase(entry.farm))
    throw new RangeError(`第 ${entry.line} 行的牧場不是 32～35：${entry.farm}`)
  return entry.farm
}

/** 第 1 欄只有前綴、沒有馬名，或第 59 欄空白（需求規格 6.4） */
function horseNameError(entry: BroodmareEntry): boolean {
  return splitHorseName(entry.fullName) === null || entry.baseName.trim() === ''
}

/**
 * 列的錯誤：matchHorse 判出的衝突；指定的列與母馬經匯入確認的父母名明顯不符（技術設計 4.2「同一匹馬」）；
 * 只有前綴或第 59 欄空白
 */
function errorReasons(
  entry: BroodmareEntry,
  found: Found,
  horses: ReadonlyMap<string, ImportHorse>,
): MayErrorReason[] {
  const reasons: MayErrorReason[] = found.kind === 'conflict' ? [...found.reasons] : []
  if (found.kind === 'matched' && found.match === 'picked') {
    const horse = horses.get(found.id)
    if (clearlyDiffers(horse?.sire.confirmed, parentName(entry.sireName))) reasons.push('sire')
    if (clearlyDiffers(horse?.dam.confirmed, parentName(entry.damName))) reasons.push('dam')
  }
  if (horseNameError(entry)) reasons.push('horse-name')
  return reasons
}

/** 明顯不符：兩邊都有值而且不同（忽略前後空白）；只有一邊有值不算 */
function clearlyDiffers(known: string | undefined, incoming: string | undefined): boolean {
  return known !== undefined && incoming !== undefined && known.trim() !== incoming.trim()
}

/**
 * 未配對母馬的處理（需求規格 11.5「未配對」）：指定的列改為配到那匹母馬（配對方式為指定），確認缺席的記下原因；
 * 指定過的列不再是候選。指定的不是未配對的母馬、同一匹又確認缺席、那一列不是新進（其他）或已被指定、
 * 能力番号或出生年矛盾時丟出 RangeError（畫面不會送出）
 */
function resolveUnmatched(
  results: { entry: BroodmareEntry; found: Found }[],
  unmatched: MayUnmatched[],
  mares: ReadonlyMap<string, ImportMare>,
  decisions: MayDecisions,
): void {
  const picked = new Set<number>()
  for (const [horseId, line] of decisions.picks ?? []) {
    const target = unmatched.find((item) => item.horseId === horseId)
    const mare = mares.get(horseId)
    if (target === undefined || mare === undefined) {
      throw new RangeError(`這匹母馬不是未配對：${horseId}`)
    }
    if (decisions.absences?.has(horseId)) {
      throw new RangeError(`未配對的母馬不能同時指定列與確認缺席：${horseId}`)
    }
    const result = results.find(({ entry }) => entry.line === line)
    if (result === undefined || result.found.kind !== 'new' || horseNameError(result.entry)) {
      throw new RangeError(`第 ${line} 行不是新進（其他），或已指定給別的母馬`)
    }
    if (!consistent(mare, result.entry)) {
      throw new RangeError(`第 ${line} 行的能力番号或出生年與母馬不同：${horseId}`)
    }
    result.found = { kind: 'matched', id: horseId, match: 'picked' }
    target.resolution = { line }
    picked.add(line)
  }
  for (const item of unmatched) {
    const reason = decisions.absences?.get(item.horseId)
    if (reason !== undefined) item.resolution = { reason }
    item.candidates = item.candidates.filter((line) => !picked.has(line))
  }
}

/** 這一列和這匹馬已有的能力番号、出生年不矛盾 */
function consistent(horse: ImportHorse, entry: BroodmareEntry): boolean {
  return (
    (horse.abilityNumber === undefined || horse.abilityNumber === entry.abilityNumber) &&
    (horse.birthYear === undefined || horse.birthYear === entry.birthYear)
  )
}

/** 缺席判斷用的馬齡：名單年份減 1 那年的馬齡；出生年晚於那一年時當作馬齡不明 */
function lastMayAge(birthYear: number, year: number): number | undefined {
  return birthYear <= year - 1 ? ageInYear(birthYear, year - 1) : undefined
}

/** 新進（其他）的一列：建立市場母馬，用途是用途把關選的（預設待指定用途）；第 1 欄與第 59 欄不同時警告 */
function newRow(entry: BroodmareEntry, usage: UsageDecision | undefined): MayRow {
  const location = baseOf(entry)
  const split = splitHorseName(entry.fullName)?.baseName
  const warnings: MayWarning[] =
    split !== undefined && split !== entry.baseName
      ? [{ kind: 'base-name', split, baseName: entry.baseName }]
      : []
  return {
    line: entry.line,
    kind: 'new-other',
    changes: { location: { to: location }, horseNumber: entry.horseNumber },
    warnings,
    items: [createItem(entry, location, usage)],
  }
}

/** 新進（其他）建立市場母馬的項目：這一列的值；用途把關沒選時待指定用途 */
function createItem(
  entry: BroodmareEntry,
  location: Base,
  usage: UsageDecision | undefined,
): MareCreateItem {
  return {
    kind: 'mare-create',
    fullName: entry.fullName,
    baseName: entry.baseName,
    abilityNumber: entry.abilityNumber,
    birthYear: entry.birthYear,
    sireName: entry.sireName,
    damName: entry.damName,
    ...(entry.sireSystem === null ? {} : { sireSystem: entry.sireSystem }),
    femaleLine: entry.femaleLine,
    location,
    horseNumber: entry.horseNumber,
    assignment: { kind: 'unassigned' },
    ...usage,
  }
}

/** 配到母馬或牝駒的一列：分類、變更、已登記賣出的處理與項目 */
function matchedRow(
  entry: BroodmareEntry,
  match: MayMatch,
  horse: ImportHorse,
  mare: ImportMare | undefined,
  mode: ImportMode,
  decisions: MayDecisions,
): MayRow {
  const kind = rowKind(mare, mode)
  const location = baseOf(entry)
  const filled = {
    ...(horse.abilityNumber === undefined ? { abilityNumber: entry.abilityNumber } : {}),
    ...(horse.birthYear === undefined ? { birthYear: entry.birthYear } : {}),
  }
  const from = mare?.location
  const moved = from !== location
  const recorded = mare?.broodmareNumbers.includes(entry.horseNumber) ?? false
  const changes: MayChanges = {
    ...(Object.keys(filled).length > 0 ? { identity: filled } : {}),
    ...(moved ? { location: { ...(from === undefined ? {} : { from }), to: location } } : {}),
    ...(recorded ? {} : { horseNumber: entry.horseNumber }),
  }
  const resolution = kind === 'sold-present' ? decisions.soldPresent?.get(horse.id) : undefined
  const acting = actingKind(kind, resolution)
  const usage = decisions.usages?.get(horse.id)
  return {
    line: entry.line,
    kind,
    horseId: horse.id,
    match,
    changes,
    warnings: [],
    ...(resolution === undefined ? {} : { resolution }),
    items: acting === undefined ? [] : rowItems(acting, horse.id, entry, changes, location, usage),
  }
}

/** 配到的對象決定分類：牝駒是新進；在圈的繼續在圈；已離圈的依撤銷、已登記賣出、回歸的順序判斷 */
function rowKind(mare: ImportMare | undefined, mode: ImportMode): MayRowKind {
  if (mare === undefined) return 'new-own'
  if (mare.herd === 'in-herd') return 'continuing'
  if (mode === 'correction' && mare.departedThisYear) return 'revoked'
  return mare.soldByUser ? 'sold-present' : 'returned'
}

/**
 * 列實際照哪一種處理：已登記賣出選撤銷照撤銷離圈、選視為買回照回歸，還沒選時待核對、不套用（undefined）；
 * 其他照分類
 */
function actingKind(kind: MayRowKind, resolution?: SoldPresentResolution): MayRowKind | undefined {
  if (kind !== 'sold-present') return kind
  if (resolution === 'revoke') return 'revoked'
  return resolution === 'buyback' ? 'returned' : undefined
}

/**
 * 配到的一列的項目（技術設計 4.4「五月對帳」）：撤銷離圈、補齊身分、回歸或轉入、轉場、馬番号，
 * 以及用途把關選的用途（回歸的帶給回歸，繼續在圈的另加修改用途）
 */
function rowItems(
  kind: MayRowKind,
  horseId: string,
  entry: BroodmareEntry,
  changes: MayChanges,
  location: Base,
  usage: UsageDecision | undefined,
): MayItem[] {
  const items: MayItem[] = []
  if (kind === 'revoked') items.push({ kind: 'mare-revoke', horseId })
  if (changes.identity) {
    const { abilityNumber, birthYear } = entry
    items.push({ kind: 'horse-identity', horseId, abilityNumber, birthYear })
  }
  if (kind === 'returned') items.push({ kind: 'mare-return', horseId, location, ...usage })
  if (kind === 'new-own') items.push({ kind: 'filly-transfer', horseId, location })
  if ((kind === 'continuing' || kind === 'revoked') && changes.location) {
    items.push({ kind: 'mare-move', horseId, location })
  }
  if (changes.horseNumber !== undefined) {
    items.push({ kind: 'horse-number', horseId, stage: 'broodmare', number: changes.horseNumber })
  }
  if (kind === 'continuing' && usage !== undefined) {
    items.push({ kind: 'mare-usage', horseId, ...usage })
  }
  return items
}

/** 市場母馬：替代、起點用、待指定用途 */
function isMarket(usage: MareUsage): boolean {
  return usage === 'substitute' || usage === 'start' || usage === 'unassigned'
}

/**
 * 用途把關清單（需求規格 11.5、MAY-11）：新進（其他）的列、這次回歸或視為買回的市場母馬，
 * 以及上次五月之後新增或回歸（entered）而繼續在圈的市場母馬；依行號，帶使用者選的用途
 */
function usageEntries(
  rows: readonly MayRow[],
  mares: ReadonlyMap<string, ImportMare>,
  decided: ReadonlyMap<string | number, UsageDecision> | undefined,
): MayUsageEntry[] {
  const withDecision = (entry: MayUsageEntry): MayUsageEntry => {
    const decision = decided?.get(entry.key)
    return decision === undefined ? entry : { ...entry, decision }
  }
  return rows.flatMap((row): MayUsageEntry[] => {
    if (row.kind === 'new-other') {
      return [withDecision({ key: row.line, current: { usage: 'unassigned' } })]
    }
    const mare = row.horseId === undefined ? undefined : mares.get(row.horseId)
    if (mare === undefined || !isMarket(mare.usage)) return []
    const acting = actingKind(row.kind, row.resolution)
    const listed = acting === 'returned' || (acting === 'continuing' && mare.entered)
    if (!listed) return []
    const current = {
      usage: mare.usage,
      ...(mare.groupLine === undefined ? {} : { groupLine: mare.groupLine }),
      ...(mare.groupGeneration === undefined ? {} : { groupGeneration: mare.groupGeneration }),
    }
    return [withDecision({ key: mare.id, current })]
  })
}

/** MAY-02 的筆數與據點分布 */
function herdSummary(
  entries: readonly BroodmareEntry[],
  rows: readonly MayRow[],
  errors: readonly MayError[],
  absences: readonly MayAbsence[],
  unmatched: readonly MayUnmatched[],
): HerdSummary {
  const bases: Record<Base, number> = { 32: 0, 33: 0, 34: 0, 35: 0 }
  for (const entry of entries) bases[baseOf(entry)] += 1
  const count = (kinds: readonly MayRowKind[]) =>
    rows.filter((row) => {
      const acting = actingKind(row.kind, row.resolution)
      return acting !== undefined && kinds.includes(acting)
    })
  const staying = count(['continuing', 'revoked'])
  // 這次判定的缺席，加上確認缺席的未配對
  const reasons = [
    ...absences.map((absence) => absence.reason),
    ...unmatched.flatMap(({ resolution }) =>
      resolution !== undefined && 'reason' in resolution ? [resolution.reason] : [],
    ),
  ]
  return {
    continuing: staying.length,
    newArrivals: count(['new-own', 'new-other']).length,
    returned: count(['returned']).length,
    retired: reasons.filter((reason) => reason === 'retired').length,
    sold: reasons.filter((reason) => reason === 'sold').length,
    moved: staying.filter((row) => row.changes.location?.from !== undefined).length,
    unmatched: unmatched.filter((item) => item.resolution === undefined).length,
    conflicts: errors.length,
    bases,
  }
}
