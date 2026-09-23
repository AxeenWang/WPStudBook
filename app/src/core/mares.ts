import { sisterStatusListed, type SisterStatus } from './sisters'

/** 母馬的年齡設定（需求規格 8.5），使用者可以調整 */
export interface MareAgeSettings {
  /** 定年：達到時不列入任務，五月缺席時依此預設定年引退或售出 */
  retirementAge: number
  /** 高齡提醒年齡 */
  seniorAge: number
}

/** 預設值：定年 25 歲、高齡提醒 18 歲（需求規格 8.5） */
export const DEFAULT_MARE_AGE_SETTINGS: Readonly<MareAgeSettings> = {
  retirementAge: 25,
  seniorAge: 18,
}

/**
 * 某年的馬齡：出生當年為 0 歲，每年 1 月加 1（需求規格 4.6）。
 * 年份不是整數或早於出生年時丟出 RangeError。
 */
export function ageInYear(birthYear: number, year: number): number {
  if (!Number.isInteger(birthYear) || !Number.isInteger(year) || year < birthYear) {
    throw new RangeError(`年份必須是出生年以後的整數：出生年 ${birthYear}、年份 ${year}`)
  }
  return year - birthYear
}

/**
 * 母馬的年齡提醒（需求規格 8.5），都只提示、不影響操作：
 * - senior：達高齡提醒年齡，「產駒素質可能下降，可考慮出售」；已達定年的母馬不能賣出（4.6），不再提示
 * - last-breeding：定年減 1 歲，「最後值得配種的年齡」
 * - retirement-age：已達定年，不列入任務
 */
export type MareAgeNotice = 'senior' | 'last-breeding' | 'retirement-age'

export function mareAgeNotices(age: number, settings: MareAgeSettings): MareAgeNotice[] {
  const notices: MareAgeNotice[] = []
  if (age >= settings.seniorAge && age < settings.retirementAge) notices.push('senior')
  if (age === settings.retirementAge - 1) notices.push('last-breeding')
  if (age >= settings.retirementAge) notices.push('retirement-age')
  return notices
}

/** 五月缺席時預設的離圈原因：定年引退或售出 */
export type AbsenceReason = 'retired' | 'sold'

/**
 * 五月缺席、沒有在管理器登記賣出的母馬，預設的離圈原因（需求規格 11.5）：
 * 上次五月的馬齡達定年為定年引退，否則為售出（被取代的姊妹也一樣）；馬齡不明時為售出。
 * 使用者可在預覽逐匹更正。
 */
export function defaultAbsenceReason(
  lastMayAge: number | undefined,
  settings: MareAgeSettings,
): AbsenceReason {
  return lastMayAge !== undefined && lastMayAge >= settings.retirementAge ? 'retired' : 'sold'
}

/** 判斷母馬是否列入任務用的資料 */
export interface MareForTasks {
  /** 在繁殖圈內（生產中） */
  inHerd: boolean
  /** 今年的馬齡；出生年不明時留空 */
  age?: number
  /** 自家母駒的接替狀態；市場母馬留空 */
  sisterStatus?: SisterStatus
}

/**
 * 列入任務的母馬（需求規格 8.5、8.9）：在繁殖圈內而且未達定年；
 * 自家母駒還要是暫定保留、候選或正式保留。規則輸入快照的「列入任務的母馬數」依此計算。
 */
export function mareListedInTasks(mare: MareForTasks, settings: MareAgeSettings): boolean {
  if (!mare.inHerd) return false
  if (mare.age !== undefined && mare.age >= settings.retirementAge) return false
  return mare.sisterStatus === undefined || sisterStatusListed(mare.sisterStatus)
}

/**
 * 出售母親提醒（需求規格 8.5）：女兒已轉入（暫定或正式保留）而且母親今年四月已生產時提示；
 * 只提示，不自動賣出。daughters 是母親的自家女兒目前的接替狀態。
 */
export function suggestSellingMother(
  daughters: readonly SisterStatus[],
  foaledThisYear: boolean,
): boolean {
  return foaledThisYear && daughters.some((status) => status === 'provisional' || status === 'kept')
}
