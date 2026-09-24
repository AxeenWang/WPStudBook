/**
 * 自家母駒的接替狀態（需求規格 8.9）：
 * provisional 暫定保留、candidate 候選、kept 正式保留、replaced 已被取代、sold 已售出
 */
export type SisterStatus = 'provisional' | 'candidate' | 'kept' | 'replaced' | 'sold'

/** 判斷姊妹接替用的自家母駒資料（由儲存層依馬匹紀錄彙整） */
export interface OwnMare {
  /** 內部識別 */
  id: string
  /** 父馬的內部識別；不知道時留空，無法判定姊妹 */
  sireId?: string
  /** 母馬的內部識別；不知道時留空，無法判定姊妹 */
  damId?: string
  /** 在繁殖圈內；售出或定年引退後為 false */
  inHerd: boolean
  status: SisterStatus
}

/** 判斷姊妹只需要識別與父母 */
export type Parentage = Pick<OwnMare, 'id' | 'sireId' | 'damId'>

/** 同父同母的姊妹：父母都已知而且都相同，不是同一匹（需求規格 8.9） */
export function isSister(a: Parentage, b: Parentage): boolean {
  return (
    a.id !== b.id &&
    a.sireId !== undefined &&
    a.damId !== undefined &&
    a.sireId === b.sireId &&
    a.damId === b.damId
  )
}

/** 可列入任務的接替狀態：暫定保留、候選、正式保留；已被取代、已售出不列入（需求規格 8.9） */
export function sisterStatusListed(status: SisterStatus): boolean {
  return status === 'provisional' || status === 'candidate' || status === 'kept'
}

/** 以這個狀態轉入時，她所屬的代立即成立：暫定保留或正式保留（需求規格 8.2） */
export function establishesGeneration(status: SisterStatus): boolean {
  return status === 'provisional' || status === 'kept'
}

/** 在繁殖圈內的母馬不會是已售出；有這種矛盾的輸入時丟出 RangeError */
function assertHerdStatus(mares: readonly OwnMare[]): void {
  const contradictory = mares.find((mare) => mare.inHerd && mare.status === 'sold')
  if (contradictory) {
    throw new RangeError(`在繁殖圈內的母馬狀態不能是已售出：${contradictory.id}`)
  }
}

/**
 * 自家母駒轉入或買回時的接替狀態（需求規格 8.9）：
 * 其他姊妹都不在圈內 → 暫定保留；已有姊妹在圈 → 候選。第二匹不得阻止，由使用者比較後決定。
 * others 有在圈但狀態是已售出的母馬時丟出 RangeError。
 */
export function entrySisterStatus(
  mare: Parentage,
  others: readonly OwnMare[],
): 'provisional' | 'candidate' {
  assertHerdStatus(others)
  return others.some((other) => other.inHerd && isSister(mare, other)) ? 'candidate' : 'provisional'
}

/** 接替狀態的變更；每次決定由儲存層保存事件（需求規格 8.9） */
export interface SisterStatusChange {
  id: string
  from: SisterStatus
  to: SisterStatus
}

/**
 * 使用者比較姊妹後選定正式保留（需求規格 8.9）：
 * 選定的改為正式保留，其他在圈而且列入任務的姊妹改為已被取代，同一父母組合只剩一匹正式保留；
 * 已被取代、已售出與不在圈內的姊妹不變。
 * 選定的母馬不在 mares 中或不在圈內時丟出 RangeError（畫面只列出在圈的姊妹）；
 * mares 有在圈但狀態是已售出的母馬時也丟出 RangeError。
 */
export function chooseKeptSister(
  chosenId: string,
  mares: readonly OwnMare[],
): SisterStatusChange[] {
  assertHerdStatus(mares)
  const chosen = mares.find((mare) => mare.id === chosenId)
  if (!chosen) throw new RangeError(`找不到要保留的母馬：${chosenId}`)
  if (!chosen.inHerd) throw new RangeError(`不在繁殖圈內的母馬不能選為正式保留：${chosenId}`)
  const changes: SisterStatusChange[] = []
  if (chosen.status !== 'kept') changes.push({ id: chosen.id, from: chosen.status, to: 'kept' })
  for (const mare of mares) {
    if (isSister(chosen, mare) && mare.inHerd && sisterStatusListed(mare.status)) {
      changes.push({ id: mare.id, from: mare.status, to: 'replaced' })
    }
  }
  return changes
}
