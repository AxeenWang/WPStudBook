// ce-import 與 storage 共用的馬匹與配種屬性型別，以及判斷文字或番号屬於哪一種的函式（技術設計 4.2）

export type Sex = 'male' | 'female'

/** 芝、ダート適性（需求規格 4.7）：◎ > ○ > △ > × */
export type SurfaceAptitude = '◎' | '○' | '△' | '×'

/** 活力快照（需求規格 8.7）：0～100 的總活力與是否増強；只有前置 `*` 才是増強，100 不代表増強 */
export interface Vigor {
  value: number
  boosted: boolean
}

/** 受胎狀態，原樣保存匯入文字（需求規格 9.1） */
export type Conception = '空胎' | '受胎' | '不受胎' | '未確認'

/** 據點（第 3 章）：繋養牧場番号 32 日本、33 分場、34 美國、35 歐洲 */
export type Base = 32 | 33 | 34 | 35

const SURFACE_APTITUDES: readonly string[] = ['◎', '○', '△', '×'] satisfies SurfaceAptitude[]

const CONCEPTIONS: readonly string[] = ['空胎', '受胎', '不受胎', '未確認'] satisfies Conception[]

const BASES: readonly number[] = [32, 33, 34, 35] satisfies Base[]

/** 文字是芝、ダート適性的四種符號之一（需求規格 4.7）；`○` 是 U+25CB，不是「〇」 */
export function isSurfaceAptitude(text: string): text is SurfaceAptitude {
  return SURFACE_APTITUDES.includes(text)
}

/** 文字是受胎狀態的四種之一（需求規格 9.1、附錄 A.3） */
export function isConception(text: string): text is Conception {
  return CONCEPTIONS.includes(text)
}

/** 番号是自家牧場的據點 32～35（第 3 章「據點」）；沒有值時不是 */
export function isBase(code: number | null): code is Base {
  return code !== null && BASES.includes(code)
}
