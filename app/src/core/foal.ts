/**
 * 未命名產駒的追蹤名：母馬名＋完整出生年（實際出生年，不是配種年），
 * 例如 `オオトリモナーコス1990`（需求規格 9.4）。
 * 母馬名空白或出生年不是 0 以上的整數時丟出 RangeError。
 */
export function trackingName(damName: string, birthYear: number): string {
  if (damName.trim() === '') throw new RangeError('追蹤名需要母馬名')
  if (!Number.isInteger(birthYear) || birthYear < 0) {
    throw new RangeError(`出生年必須是 0 以上的整數：${birthYear}`)
  }
  return `${damName}${birthYear}`
}

/**
 * 產駒主要顯示的名稱（需求規格 9.4）：有正式馬名時用正式馬名；
 * 沒有，或正式馬名被清空時回退追蹤名。追蹤名另外保留為搜尋別名，由儲存層處理。
 */
export function foalDisplayName(
  formalName: string | undefined,
  damName: string,
  birthYear: number,
): string {
  if (formalName !== undefined && formalName.trim() !== '') return formalName
  return trackingName(damName, birthYear)
}

/** 副能力等級，由低到高（需求規格 4.7） */
export const SUB_ABILITY_GRADES = [
  'G',
  'G+',
  'F',
  'F+',
  'E',
  'E+',
  'D',
  'D+',
  'C',
  'C+',
  'B',
  'B+',
  'A',
  'A+',
  'S',
  'S+',
] as const

export type SubAbilityGrade = (typeof SUB_ABILITY_GRADES)[number]

/** 文字是不是副能力等級；匯入時用來判斷欄位內容 */
export function isSubAbilityGrade(text: string): text is SubAbilityGrade {
  return (SUB_ABILITY_GRADES as readonly string[]).includes(text)
}

/** 等級的非官方換算：G=0 起每升一級加 1，S+=15（需求規格 4.7） */
export function gradeValue(grade: SubAbilityGrade): number {
  return SUB_ABILITY_GRADES.indexOf(grade)
}

/** 七項副能力：力量、瞬發力、勝負根性、柔軟性、精神力、賢明度、健康；未取得的項目留空 */
export interface SubAbilities {
  power?: SubAbilityGrade
  burst?: SubAbilityGrade
  guts?: SubAbilityGrade
  flexibility?: SubAbilityGrade
  spirit?: SubAbilityGrade
  wisdom?: SubAbilityGrade
  health?: SubAbilityGrade
}

const SUB_ABILITY_KEYS: readonly (keyof SubAbilities)[] = [
  'power',
  'burst',
  'guts',
  'flexibility',
  'spirit',
  'wisdom',
  'health',
]

/** `サ`：七項齊全時為七項換算值的合計 0～105；缺任何一項時為 null（需求規格 4.7、9.3） */
export function subAbilityTotal(abilities: SubAbilities): number | null {
  let total = 0
  for (const key of SUB_ABILITY_KEYS) {
    const grade = abilities[key]
    if (grade === undefined) return null
    total += gradeValue(grade)
  }
  return total
}

export interface SubAbilityTotalCheck {
  /** 算出的 `サ`；七項不齊時為 null */
  total: number | null
  /** 算得出來而且與匯入值不同：警告（需求規格 9.3） */
  mismatch: boolean
}

/** 與匯入的 `サ` 比對（需求規格 9.3）；七項不齊或沒有匯入值時不比對 */
export function checkSubAbilityTotal(
  abilities: SubAbilities,
  imported: number | undefined,
): SubAbilityTotalCheck {
  const total = subAbilityTotal(abilities)
  return { total, mismatch: total !== null && imported !== undefined && total !== imported }
}
