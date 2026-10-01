import { isSubAbilityGrade, type SubAbilityGrade } from '../core/foal'
import { isSurfaceAptitude, type Sex, type SurfaceAptitude, type Vigor } from '../core/horse'
import { normalizeAbilityNumber } from '../core/identity'
import { normalizeSystemName } from '../core/systems'

/**
 * 解析的問題（需求規格 11.1、技術設計 4.4「解析」）；任何一個都是阻擋錯誤，整份停止：
 * - empty：檔案沒有任何一行
 * - field-count：欄數不符；value 是實際的欄數
 * - header：表頭在要讀的位置的欄名不符；header 是應有的欄名，value 是檔案裡的欄名
 * - quote：逗號分隔檔的雙引號不成對
 * - value：欄位的值不合格式
 * - scope：範圍異常（需求規格 11.4、11.5、11.6）
 * - row-count：目標種牡馬 TXT 不是剛好一筆；value 是資料列數
 * - duplicate：檔內能力番号重複
 */
export type ImportProblemReason =
  'empty' | 'field-count' | 'header' | 'quote' | 'value' | 'scope' | 'row-count' | 'duplicate'

export interface ImportProblem {
  reason: ImportProblemReason
  /** 檔案的第幾行，表頭是第 1 行；整份的問題沒有 */
  line?: number
  /** 第幾欄（從 1 起算） */
  column?: number
  /** 欄名 */
  header?: string
  /** 檔案裡的值 */
  value?: string
}

/**
 * 依位置讀一行的欄位（需求規格 11.1「依位置讀取，不依欄名」）。每個格式只宣告一次「第幾欄、欄名、
 * 怎麼讀」，表頭與資料列共用：讀表頭時比對欄名，讀資料列時轉換值。不符時記下問題並回傳預留值，
 * 有問題的列不會被採用
 */
export interface Cells {
  /** 原樣保留的文字，不修剪 */
  text(column: number, header: string): string
  /** 0 以上的整數；帶括號附加值時取括號前的主值 */
  integer(column: number, header: string): number
  /** 番号欄（生牧、馬主、繋牧、牧場）：空白時是 null，否則同 integer */
  code(column: number, header: string): number | null
  /** 副能力等級；帶括號附加值時取括號前的主值 */
  grade(column: number, header: string): SubAbilityGrade
  /** 芝、ダ適性 */
  aptitude(column: number, header: string): SurfaceAptitude
  /** 性別：牡、牝 */
  sex(column: number, header: string): Sex
  /** 活力：0～100 的整數，前置 `*` 表示増強 */
  vigor(column: number, header: string): Vigor
  /** 能力番号、馬番号：以 normalizeAbilityNumber 統一寫法 */
  number(column: number, header: string): string
  /** 父系：以 normalizeSystemName 去掉結尾「系」；空白時是 null */
  sireSystem(column: number, header: string): string | null
}

/** 讀表頭：比對要讀的位置的欄名，不符時記下 header 問題 */
export function headerCells(fields: readonly string[], problems: ImportProblem[]): Cells {
  const check =
    <T>(placeholder: T) =>
    (column: number, header: string): T => {
      const actual = fields[column - 1]
      if (actual !== header) {
        problems.push({ reason: 'header', line: 1, column, header, value: actual })
      }
      return placeholder
    }
  return {
    text: check(''),
    integer: check(0),
    code: check<number | null>(null),
    grade: check<SubAbilityGrade>('G'),
    aptitude: check<SurfaceAptitude>('×'),
    sex: check<Sex>('male'),
    vigor: check<Vigor>({ value: 0, boosted: false }),
    number: check(''),
    sireSystem: check<string | null>(null),
  }
}

/** 讀資料列：轉換值，不合格式時記下 value 問題 */
export function rowCells(
  fields: readonly string[],
  line: number,
  problems: ImportProblem[],
): Cells {
  const read =
    <T>(convert: (text: string) => T | undefined, placeholder: T) =>
    (column: number, header: string): T => {
      const text = fields[column - 1]
      const value = convert(text)
      if (value !== undefined) return value
      problems.push({ reason: 'value', line, column, header, value: text })
      return placeholder
    }
  return {
    text: read((text) => text, ''),
    integer: read(toInteger, 0),
    code: read<number | null>((text) => (text === '' ? null : toInteger(text)), null),
    grade: read(toGrade, 'G'),
    aptitude: read(toAptitude, '×'),
    sex: read(toSex, 'male'),
    vigor: read(toVigor, { value: 0, boosted: false }),
    number: read((text) => normalizeAbilityNumber(text) ?? undefined, ''),
    sireSystem: read((text) => normalizeSystemName(text), null),
  }
}

/** 帶括號附加值時取括號前的主值，例如 `72(72)`、`42( +0)`、`B(0)`（需求規格 11.1、APR-06） */
function mainValue(text: string): string {
  const open = text.indexOf('(')
  return open !== -1 && text.endsWith(')') ? text.slice(0, open) : text
}

function toInteger(text: string): number | undefined {
  const main = mainValue(text)
  return /^\d+$/.test(main) ? Number(main) : undefined
}

function toGrade(text: string): SubAbilityGrade | undefined {
  const main = mainValue(text)
  return isSubAbilityGrade(main) ? main : undefined
}

function toAptitude(text: string): SurfaceAptitude | undefined {
  return isSurfaceAptitude(text) ? text : undefined
}

function toSex(text: string): Sex | undefined {
  if (text === '牡') return 'male'
  if (text === '牝') return 'female'
  return undefined
}

function toVigor(text: string): Vigor | undefined {
  const match = /^(\*?)(\d+)$/.exec(text)
  if (match === null) return undefined
  const value = Number(match[2])
  return value <= 100 ? { value, boosted: match[1] === '*' } : undefined
}
