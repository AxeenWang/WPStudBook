import { splitHorseName } from '../core/identity'
import type { FoalNameItem, ImportFoal, ImportMode, ImportSnapshot } from '../core/imports'
import type { ImportContent } from './flow'
import type { TwoYearOldEntry } from './formats'

// 一月二歲馬總表的配對與預覽（需求規格 9.4、11.3；技術設計 4.4「一月」）

/** 配對方式：能力番号＋出生年、父母＋出生年，或使用者指定 */
export type JanuaryMatch = 'ability-number' | 'parents' | 'picked'

/**
 * 一對要做的變更（技術設計 4.4「一月」）：
 * - name：馬名或馬名來源有變時，原本的完整馬名（沒有時留空）、新的完整馬名，與原本的手動名會不會留作別名
 * - abilityNumber：補上的能力番号；產駒原本就有時留空
 * - horseNumber：新的競走馬馬番号；已記過時留空
 */
export interface JanuaryChanges {
  name?: { from?: string; to: string; alias: boolean }
  abilityNumber?: string
  horseNumber?: string
}

/**
 * 警告：第 1 欄去掉前綴後的基本馬名 split 與第 77 欄 baseName 不同（JAN-09）；照樣套用，基本馬名取第 77 欄
 */
export interface JanuaryWarning {
  kind: 'base-name'
  split: string
  baseName: string
}

/** 配成的一對：產駒與檔案的一列（行號）；有變更時帶套用的項目 */
export interface JanuaryPair {
  foalId: string
  line: number
  match: JanuaryMatch
  changes: JanuaryChanges
  warnings: JanuaryWarning[]
  /** 套用的項目；什麼都不用改時留空 */
  item?: FoalNameItem
}

/**
 * 錯誤的原因（技術設計 4.4「一月」），錯誤的對不套用：
 * - sire、dam：以能力番号配到，經匯入確認的父馬或母馬名與檔案明顯不符（需求規格 6.2）
 * - name-confirmed：馬名已經匯入確認、與這一列不同，而這次不是資料更正（6.4）
 * - horse-name：第 1 欄只有前綴、沒有馬名，或第 77 欄空白（6.4）
 */
export type JanuaryErrorReason = 'sire' | 'dam' | 'name-confirmed' | 'horse-name'

/** 錯誤的一對：產駒、行號、配對方式與原因 */
export interface JanuaryError {
  foalId: string
  line: number
  match: JanuaryMatch
  reasons: JanuaryErrorReason[]
}

/**
 * 待核對的原因（需求規格 11.3）：
 * - no-candidate：配不到，以父母＋出生年沒有候選列
 * - ambiguous：無法唯一配對，候選兩列以上，或候選列也配到別的產駒
 * - not-in-file：未見於總表，已有能力番号而檔案沒有那個能力番号；不能指定
 */
export type JanuaryPendingReason = 'no-candidate' | 'ambiguous' | 'not-in-file'

/** 待核對的產駒；candidates 是候選列的行號，不含已指定給別的產駒的列 */
export interface JanuaryPending {
  foalId: string
  reason: JanuaryPendingReason
  candidates: number[]
}

/**
 * IMP-05 的五種筆數：可套用、略過與錯誤以列計，加起來等於檔案的列數；待核對以匹計（未見於總表的產駒沒有列）；
 * 警告是可套用的列中有警告的列數
 */
export interface JanuaryCounts {
  applicable: number
  skipped: number
  errors: number
  pending: number
  warnings: number
}

/** 一月的預覽（技術設計 4.4「一月」） */
export interface JanuaryPreview {
  /** 出生年（年份減 2），供使用者確認（需求規格 11.3） */
  birthYear: number
  /** 檔案的列數 */
  total: number
  pairs: JanuaryPair[]
  errors: JanuaryError[]
  pending: JanuaryPending[]
  counts: JanuaryCounts
}

/**
 * 一月二歲馬總表的配對與預覽（需求規格 11.3，技術設計 4.4「一月」）。快照要有一月的資料，否則丟出錯誤。
 * 先以能力番号＋出生年配對；還沒有能力番号的產駒，與沒配到的列，以父母＋出生年退回配對，兩邊都唯一時配成一對；
 * 沒配成對的產駒列入待核對，其他的列是非管理的馬，只計入略過。picks 是使用者指定的「產駒 → 行號」：
 * 產駒要是配不到或無法唯一配對的待核對產駒，那一列要在檔案裡、沒有配給別的產駒、出生年與產駒相同，
 * 否則丟出 RangeError（畫面不會送出）。配成的對（含指定的）再檢查錯誤：父母不符只查以能力番号配到的
 */
export function previewJanuary(
  entries: readonly TwoYearOldEntry[],
  snapshot: ImportSnapshot,
  mode: ImportMode,
  picks: ReadonlyMap<string, number> = new Map(),
): JanuaryPreview {
  const { january } = snapshot
  if (january === undefined) throw new Error('快照沒有一月二歲馬總表的資料')
  const { birthYear, foals } = january
  const matched = new Map<string, { entry: TwoYearOldEntry; match: JanuaryMatch }>()
  const used = new Set<number>()
  const pair = (foalId: string, entry: TwoYearOldEntry, match: JanuaryMatch) => {
    matched.set(foalId, { entry, match })
    used.add(entry.line)
  }

  // 1. 能力番号＋出生年
  const byNumber = new Map(entries.map((entry) => [numberKey(entry), entry]))
  for (const foal of foals) {
    const entry = foal.abilityNumber === undefined ? undefined : byNumber.get(numberKey(foal))
    if (entry) pair(foal.id, entry, 'ability-number')
  }

  // 2. 父母＋出生年：還沒有能力番号的產駒，與第 1 步沒配到的列
  const free = entries.filter((entry) => !used.has(entry.line))
  const options = foals
    .filter((foal) => foal.abilityNumber === undefined)
    .map((foal) => ({ foal, rows: free.filter((entry) => parentsMatch(foal, entry)) }))
  const claims = new Map<number, number>()
  for (const { rows } of options) {
    for (const entry of rows) claims.set(entry.line, (claims.get(entry.line) ?? 0) + 1)
  }
  const unresolved = new Map<string, JanuaryPending>()
  for (const { foal, rows } of options) {
    const [only] = rows
    if (rows.length === 1 && only !== undefined && claims.get(only.line) === 1) {
      pair(foal.id, only, 'parents')
    } else {
      const reason = rows.length === 0 ? 'no-candidate' : 'ambiguous'
      const candidates = rows.map((entry) => entry.line)
      unresolved.set(foal.id, { foalId: foal.id, reason, candidates })
    }
  }

  // 3. 已有能力番号、第 1 步沒配到：未見於總表
  for (const foal of foals) {
    if (foal.abilityNumber !== undefined && !matched.has(foal.id)) {
      unresolved.set(foal.id, { foalId: foal.id, reason: 'not-in-file', candidates: [] })
    }
  }

  // 4. 使用者指定
  const byLine = new Map(entries.map((entry) => [entry.line, entry]))
  const byId = new Map(foals.map((foal) => [foal.id, foal]))
  for (const [foalId, line] of picks) {
    const waiting = unresolved.get(foalId)
    const foal = byId.get(foalId)
    if (waiting === undefined || waiting.reason === 'not-in-file' || foal === undefined) {
      throw new RangeError(`這匹產駒不能指定列：${foalId}`)
    }
    const entry = byLine.get(line)
    if (entry === undefined) throw new RangeError(`檔案沒有第 ${line} 行`)
    if (used.has(line)) throw new RangeError(`第 ${line} 行已配給別的產駒`)
    if (entry.birthYear !== foal.birthYear) throw new RangeError(`第 ${line} 行的出生年與產駒不同`)
    pair(foalId, entry, 'picked')
    unresolved.delete(foalId)
  }

  // 5. 配成的對檢查錯誤，產生變更與項目
  const pairs: JanuaryPair[] = []
  const errors: JanuaryError[] = []
  for (const foal of foals) {
    const found = matched.get(foal.id)
    if (found === undefined) continue
    const { entry, match } = found
    const reasons = errorReasons(foal, entry, match, mode)
    if (reasons.length > 0) errors.push({ foalId: foal.id, line: entry.line, match, reasons })
    else pairs.push(pairOf(foal, entry, match))
  }
  const pending = foals.flatMap((foal) => {
    const waiting = unresolved.get(foal.id)
    if (waiting === undefined) return []
    return [{ ...waiting, candidates: waiting.candidates.filter((line) => !used.has(line)) }]
  })
  const applicable = pairs.filter((item) => item.item !== undefined)
  return {
    birthYear,
    total: entries.length,
    pairs,
    errors,
    pending,
    counts: {
      applicable: applicable.length,
      skipped: entries.length - applicable.length - errors.length,
      errors: errors.length,
      pending: pending.length,
      warnings: applicable.filter((item) => item.warnings.length > 0).length,
    },
  }
}

/**
 * 一月的內容（技術設計 4.4「一月」）：每一個可套用的對一個項目，不必改的對不產生項目。
 * 摘要的 total 是列數，applied、skipped 是可套用與略過的列數，另填待核對、警告與錯誤的筆數
 */
export function januaryContent(preview: JanuaryPreview): ImportContent {
  const { applicable, skipped, pending, warnings, errors } = preview.counts
  return {
    summary: { total: preview.total, applied: applicable, skipped, pending, warnings, errors },
    items: preview.pairs.flatMap((pair) => (pair.item === undefined ? [] : [pair.item])),
  }
}

/** 能力番号＋出生年的鍵 */
function numberKey(horse: { abilityNumber?: string; birthYear: number }): string {
  return `${horse.abilityNumber}/${horse.birthYear}`
}

/** 檔案的父母名去掉前綴的基本馬名；空白或只有前綴時為 undefined */
function parentName(text: string): string | undefined {
  return splitHorseName(text.trim())?.baseName
}

/** 名稱比較忽略前後空白 */
function sameName(a: string, b: string): boolean {
  return a.trim() === b.trim()
}

/** 明顯不符：兩邊都有值而且不同；只有一邊有值不算 */
function clearlyDiffers(known: string | undefined, incoming: string | undefined): boolean {
  return known !== undefined && incoming !== undefined && !sameName(known, incoming)
}

/** 以父母＋出生年退回配對：產駒父母的任何已知名稱都要有，而且與檔案相同 */
function parentsMatch(foal: ImportFoal, entry: TwoYearOldEntry): boolean {
  const sire = parentName(entry.sireName)
  const dam = parentName(entry.damName)
  const { known: knownSire } = foal.sire
  const { known: knownDam } = foal.dam
  return (
    entry.birthYear === foal.birthYear &&
    knownSire !== undefined &&
    knownDam !== undefined &&
    sire !== undefined &&
    dam !== undefined &&
    sameName(knownSire, sire) &&
    sameName(knownDam, dam)
  )
}

/** 配成一對之後的錯誤（技術設計 4.4「一月」）；父母不符只查以能力番号配到的 */
function errorReasons(
  foal: ImportFoal,
  entry: TwoYearOldEntry,
  match: JanuaryMatch,
  mode: ImportMode,
): JanuaryErrorReason[] {
  const reasons: JanuaryErrorReason[] = []
  if (match === 'ability-number') {
    if (clearlyDiffers(foal.sire.confirmed, parentName(entry.sireName))) reasons.push('sire')
    if (clearlyDiffers(foal.dam.confirmed, parentName(entry.damName))) reasons.push('dam')
  }
  const renamed = foal.fullName !== entry.fullName || foal.baseName !== entry.baseName
  if (foal.nameSource === 'import' && renamed && mode !== 'correction') {
    reasons.push('name-confirmed')
  }
  if (splitHorseName(entry.fullName) === null || entry.baseName.trim() === '') {
    reasons.push('horse-name')
  }
  return reasons
}

/** 沒有錯誤的一對：要做的變更、第 77 欄的警告，有變更時附套用的項目 */
function pairOf(foal: ImportFoal, entry: TwoYearOldEntry, match: JanuaryMatch): JanuaryPair {
  const confirms =
    foal.fullName !== entry.fullName ||
    foal.baseName !== entry.baseName ||
    foal.nameSource !== 'import'
  const fills = foal.abilityNumber === undefined
  const records = !foal.racehorseNumbers.includes(entry.horseNumber)
  const alias = foal.nameSource === 'manual' && foal.fullName !== entry.fullName
  const name = {
    ...(foal.fullName === undefined ? {} : { from: foal.fullName }),
    to: entry.fullName,
    alias,
  }
  const changes: JanuaryChanges = {
    ...(confirms ? { name } : {}),
    ...(fills ? { abilityNumber: entry.abilityNumber } : {}),
    ...(records ? { horseNumber: entry.horseNumber } : {}),
  }
  const split = splitHorseName(entry.fullName)?.baseName
  const warnings: JanuaryWarning[] =
    split !== undefined && split !== entry.baseName
      ? [{ kind: 'base-name', split, baseName: entry.baseName }]
      : []
  const item: FoalNameItem = {
    kind: 'foal-name',
    horseId: foal.id,
    birthYear: foal.birthYear,
    fullName: entry.fullName,
    baseName: entry.baseName,
    abilityNumber: entry.abilityNumber,
    horseNumber: entry.horseNumber,
  }
  return {
    foalId: foal.id,
    line: entry.line,
    match,
    changes,
    warnings,
    ...(confirms || fills || records ? { item } : {}),
  }
}
