// ce-import 與 storage 共用的馬匹與配種屬性型別（技術設計 4.2）

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
