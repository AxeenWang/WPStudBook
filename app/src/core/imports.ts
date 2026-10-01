// ce-import 與 storage 共用的匯入型別（技術設計 4.2、4.4）

/** 遊戲內的時點（需求規格 4.1、11.1）：month 月 week 週，每月 4 週 */
export interface GameTiming {
  month: number
  week: number
}

/** 遊戲內的時點：1～12 月、每月 1～4 週 */
export function isGameTiming(timing: GameTiming): boolean {
  const { month, week } = timing
  const inRange = (value: number, max: number) =>
    Number.isInteger(value) && value >= 1 && value <= max
  return inRange(month, 12) && inRange(week, 4)
}

/**
 * 匯入的種類（需求規格 11.1）：一月二歲馬總表、四月誕生幼駒名單、五月繁殖圈名單、七月受胎名單、
 * 候選 TXT、目標種牡馬 TXT、十月全世界繁殖牝馬總表、種牡馬總表
 */
export type ImportType =
  | 'january-two-year-olds'
  | 'april-foals'
  | 'may-herd'
  | 'july-conception'
  | 'candidates'
  | 'target-stallion'
  | 'october-mares'
  | 'stallion-list'
