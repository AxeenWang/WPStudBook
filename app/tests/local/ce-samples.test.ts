import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseImportFile, readImportFile, type ParsedEntries } from '../../src/ce-import/parse'

// 讀 .references/ 的實際匯出檔（不進版控）驗證解析；檔案不在時略過（AGENTS.md「tests/local」）

const DIR = fileURLToPath(new URL('../../../.references/', import.meta.url))

const JANUARY = '1968年 1月1週._二歲新馬.txt'
const APRIL = '1968年 4月1週_幼駒誕生.txt'
const MAY = '1968年 5月1週_繁殖牝馬.txt'
const JULY = '1968年 7月1週_繁殖牝馬.txt'
const OCTOBER = '1968年10月1週_繁殖牝馬.txt'
const STALLIONS = '1968年5月1週_種牡馬.txt'

const missing = (name: string) => !existsSync(join(DIR, name))

/** 依檔名預選的類型與年份解析實檔 */
function parseSample(name: string): ParsedEntries {
  const read = readImportFile(new Uint8Array(readFileSync(join(DIR, name))), name)
  if (read.status !== 'ok') throw new Error(`${name} 解碼失敗`)
  if (read.nameInfo?.type == null) throw new Error(`${name} 的檔名認不出類型`)
  const result = parseImportFile(read.text, read.nameInfo.type, read.nameInfo.year)
  if (result.status !== 'ok')
    throw new Error(`${name} 解析失敗：${JSON.stringify(result.problems)}`)
  return result
}

/** 各值出現的次數 */
function countBy(values: readonly (string | number | null)[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) counts[String(value)] = (counts[String(value)] ?? 0) + 1
  return counts
}

describe('實檔：解析', () => {
  it.skipIf(missing(JANUARY))(
    'JAN-01 1968年 1月1週._二歲新馬.txt → 1,160 筆、78 欄，出生年為 1966',
    () => {
      const parsed = parseSample(JANUARY)
      if (parsed.format !== 'two-year-old') throw new Error('格式不符')
      expect(parsed.entries).toHaveLength(1160)
      expect(countBy(parsed.entries.map((entry) => entry.birthYear))).toStrictEqual({ 1966: 1160 })
    },
  )

  it.skipIf(missing(APRIL))(
    'APR-01 1968年 4月1週_幼駒誕生.txt → 10 筆、0 歲、4 牝 6 牡，馬主番号 46、繋養牧場番号 32',
    () => {
      const parsed = parseSample(APRIL)
      if (parsed.format !== 'foal') throw new Error('格式不符')
      expect(parsed.entries).toHaveLength(10)
      expect(countBy(parsed.entries.map((entry) => entry.age))).toStrictEqual({ 0: 10 })
      expect(countBy(parsed.entries.map((entry) => entry.sex))).toStrictEqual({
        female: 4,
        male: 6,
      })
      expect(countBy(parsed.entries.map((entry) => entry.owner))).toStrictEqual({ 46: 10 })
      expect(countBy(parsed.entries.map((entry) => entry.stable))).toStrictEqual({ 32: 10 })
    },
  )

  it.skipIf(missing(MAY) || missing(JULY))(
    '附錄 A.3 五月名單全為空胎、七月全為受胎，同一匹母馬的能力番号與馬番号相同',
    () => {
      const may = parseSample(MAY)
      const july = parseSample(JULY)
      if (may.format !== 'broodmare' || july.format !== 'broodmare') throw new Error('格式不符')
      expect(countBy(may.entries.map((entry) => entry.status))).toStrictEqual({ 空胎: 10 })
      expect(countBy(july.entries.map((entry) => entry.status))).toStrictEqual({ 受胎: 10 })
      const numbers = (entries: typeof may.entries) =>
        entries.map((entry) => `${entry.abilityNumber} ${entry.horseNumber}`).sort()
      expect(numbers(july.entries)).toStrictEqual(numbers(may.entries))
    },
  )

  it.skipIf(missing(OCTOBER) || missing(MAY))(
    'OCT-01 1968年10月1週_繁殖牝馬.txt → 2,971 筆、61 欄（国 為日 1,439、米 746、欧 786），牧場為 0 或其他番号時不停止',
    () => {
      const october = parseSample(OCTOBER)
      const may = parseSample(MAY)
      if (october.format !== 'broodmare' || may.format !== 'broodmare') throw new Error('格式不符')
      expect(october.entries).toHaveLength(2971)
      expect(countBy(october.entries.map((entry) => entry.country))).toStrictEqual({
        日: 1439,
        米: 746,
        欧: 786,
      })
      expect(october.entries.filter((entry) => entry.farm === 0)).toHaveLength(34)
      const own = october.entries.filter((entry) => entry.farm === 32)
      expect(own.map((entry) => entry.abilityNumber).sort()).toStrictEqual(
        may.entries.map((entry) => entry.abilityNumber).sort(),
      )
    },
  )

  it.skipIf(missing(STALLIONS))(
    'STL-08 1968年5月1週_種牡馬.txt → 443 筆、63 欄（国 為日 104、米 158、欧 181），出生年為 1968 減 年',
    () => {
      const parsed = parseSample(STALLIONS)
      if (parsed.format !== 'stallion') throw new Error('格式不符')
      expect(parsed.entries).toHaveLength(443)
      expect(countBy(parsed.entries.map((entry) => entry.country))).toStrictEqual({
        日: 104,
        米: 158,
        欧: 181,
      })
      expect(parsed.entries.every((entry) => entry.birthYear === 1968 - entry.age)).toBe(true)
    },
  )
})
