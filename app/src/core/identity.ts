/**
 * 匯入檔的一筆馬匹，跨匯入檔判斷同一匹馬用（需求規格 6.1、6.2）。
 * 能力番号是 `0x` 開頭的十六進位文字，由匯入層統一大小寫；`0x0000` 是有效值，不是空白。
 */
export interface IncomingHorse {
  abilityNumber: string
  /** 出生年，由匯入層依需求規格 6.3 推算 */
  birthYear: number
  /** 基本馬名（去除 `(外)`、`[地]` 前綴，需求規格 6.4）；不是正式馬名時留空，例如四月的「母馬名の0歳」 */
  name?: string
  /** 父馬的基本馬名；不知道時留空 */
  sireName?: string
  /** 母馬的基本馬名；不知道時留空 */
  damName?: string
}

/** 同一遊戲局內的既有馬匹；手動新增時能力番号、出生年與父母都可以留空（需求規格 8.4） */
export interface KnownHorse {
  /** 內部識別 */
  id: string
  abilityNumber?: string
  birthYear?: number
  /** 基本馬名；還沒有正式馬名的產駒留空 */
  name?: string
  sireName?: string
  damName?: string
}

/**
 * 衝突的原因：
 * - name、sire、dam：配到的既有紀錄，馬名、父馬或母馬明顯不符
 * - ability-number：以馬名配到的既有紀錄已有不同的能力番号，不得覆寫
 * - ambiguous：符合的既有紀錄有兩筆以上，無法判斷
 */
export type IdentityConflictReason = 'name' | 'sire' | 'dam' | 'ability-number' | 'ambiguous'

/**
 * 身分比對的結果（需求規格 6.2）：
 * - same：能力番号與出生年都相同，是同一匹馬（包含回歸的舊馬），沿用原內部識別
 * - assisted：既有紀錄沒有能力番号，以唯一馬名輔助配對，補入能力番号與出生年
 * - new：建立新馬；能力番号相同但出生年不同時是番号回收，舊馬不變
 * - conflict：由使用者處理，不套用
 */
export type HorseMatch =
  | { kind: 'same'; id: string }
  | { kind: 'assisted'; id: string }
  | { kind: 'new' }
  | { kind: 'conflict'; ids: string[]; reasons: IdentityConflictReason[] }

/**
 * 在既有馬匹中找出匯入的這匹馬（需求規格 6.2）。
 * known 只傳目前遊戲局的馬匹：不同遊戲局一律不互相配對。馬番号不作為判斷依據（6.1）。
 */
export function matchHorse(incoming: IncomingHorse, known: readonly KnownHorse[]): HorseMatch {
  const sameNumber = known.filter(
    (horse) =>
      horse.abilityNumber === incoming.abilityNumber && horse.birthYear === incoming.birthYear,
  )
  if (sameNumber.length > 1) return conflict(sameNumber, ['ambiguous'])
  if (sameNumber.length === 1) return confirm(sameNumber[0], incoming, 'same')

  // 能力番號＋出生年配不到時，以唯一馬名輔助配對；出生年要相同或未填
  const { name } = incoming
  if (name === undefined) return { kind: 'new' }
  const sameName = known.filter(
    (horse) =>
      horse.name !== undefined &&
      namesMatch(horse.name, name) &&
      (horse.birthYear === undefined || horse.birthYear === incoming.birthYear),
  )
  if (sameName.length === 0) return { kind: 'new' }
  if (sameName.length > 1) return conflict(sameName, ['ambiguous'])
  const horse = sameName[0]
  if (horse.abilityNumber !== undefined && horse.abilityNumber !== incoming.abilityNumber) {
    return conflict([horse], ['ability-number'])
  }
  return confirm(horse, incoming, 'assisted')
}

/** 同一匯入檔內重複的能力番号，依重複出現的順序；有任何一個時整份停止套用（需求規格 6.2） */
export function duplicateAbilityNumbers(abilityNumbers: readonly string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const abilityNumber of abilityNumbers) {
    if (seen.has(abilityNumber)) duplicates.add(abilityNumber)
    seen.add(abilityNumber)
  }
  return [...duplicates]
}

/** 配到一筆後，馬名或父母明顯不符時改為衝突 */
function confirm(
  horse: KnownHorse,
  incoming: IncomingHorse,
  kind: 'same' | 'assisted',
): HorseMatch {
  const reasons: IdentityConflictReason[] = []
  if (clearlyDiffers(horse.name, incoming.name)) reasons.push('name')
  if (clearlyDiffers(horse.sireName, incoming.sireName)) reasons.push('sire')
  if (clearlyDiffers(horse.damName, incoming.damName)) reasons.push('dam')
  return reasons.length === 0 ? { kind, id: horse.id } : conflict([horse], reasons)
}

/** 明顯不符：兩邊都有值而且不同；只有一邊有值不算 */
function clearlyDiffers(known: string | undefined, incoming: string | undefined): boolean {
  return known !== undefined && incoming !== undefined && !namesMatch(known, incoming)
}

/** 名稱比較忽略前後空白 */
function namesMatch(a: string, b: string): boolean {
  return a.trim() === b.trim()
}

function conflict(horses: readonly KnownHorse[], reasons: IdentityConflictReason[]): HorseMatch {
  return { kind: 'conflict', ids: horses.map((horse) => horse.id), reasons }
}
