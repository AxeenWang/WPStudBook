import type { RestorationSlot } from '../core/board'
import type { DamRole } from '../core/generation'
import type { LineGeneration, LinePosition, PairingDistance } from '../core/lines'
import type { SisterStatus } from '../core/sisters'
import type { StallionStatus } from '../core/stallions'

// 資料表的一列（技術設計 4.3）。除了全域的 MetaRow，每一列都以 gameId 歸屬某一局；
// 識別一律是 crypto.randomUUID() 產生的字串（需求規格 12.2）。

/** 遊戲局（需求規格 12.1）；各局完全隔離 */
export interface GameRow {
  id: string
  name: string
  startYear: number
  /** 目前遊戲年：只由使用者更新，不依電腦日期（12.1） */
  currentYear: number
  /** 建立時間（ISO 8601） */
  createdAt: string
  /** 最近一次修改這一局資料的時間（ISO 8601） */
  updatedAt: string
}

/** 一局的設定；新局選擇只複製設定時整列複製（需求規格 12.1） */
export interface SettingsRow {
  gameId: string
  /** 母馬定年（8.5），預設 25 歲 */
  retirementAge: number
  /** 母馬高齡提醒年齡（8.5），預設 18 歲 */
  seniorAge: number
  /** 現任種牡馬的提醒年齡（7.7），預設 26 歲 */
  stallionReminderAge: number
}

/** 不屬於任何一局的全域資料 */
export interface MetaRow {
  key: string
  value: string
}

export type Sex = 'male' | 'female'

/** 自家產駒的出生紀錄（需求規格 8.2、9.3） */
export interface BirthRecord {
  /** 連結的年度繁殖紀錄；沒有配種紀錄的產駒（例如購入時已受胎）留空 */
  breedingId?: string
  /** 產駒的系與代數；只有八系指定配種所生才有，自由配種所生不取得八系的系（9.5） */
  placement?: LineGeneration
}

/** 一匹馬（需求規格 6.1、6.4）；被父母、產駒或後繼引用的馬匹不得物理刪除（10.4） */
export interface HorseRow {
  id: string
  gameId: string
  /** 完整馬名（含 `(外)`、`[地]` 前綴）；還沒有正式馬名時留空，追蹤名與「母馬名の0歳」不存在這裡 */
  fullName?: string
  /** 基本馬名（去除前綴）；還沒有正式馬名時留空 */
  baseName?: string
  /** 馬名的來源：import 為經匯入確認，manual 為手動輸入、尚未經匯入確認（6.4）；沒有馬名時留空 */
  nameSource?: 'import' | 'manual'
  /** 能力番号：`0x` 開頭的十六進位文字，`0x0000` 是有效值 */
  abilityNumber?: string
  birthYear?: number
  sex?: Sex
  /** 父馬的內部識別；沒有內部紀錄時留空 */
  sireId?: string
  /** 母馬的內部識別；沒有內部紀錄時留空 */
  damId?: string
  /** 匯入檔記載的父馬基本馬名 */
  sireName?: string
  /** 匯入檔記載的母馬基本馬名 */
  damName?: string
  /** 父系：父馬所屬的子系統，去掉結尾「系」保存（11.1） */
  sireSystem?: string
  /** 自家產駒的出生紀錄；市場馬沒有 */
  birth?: BirthRecord
}

/** 已開啟的系（需求規格 7.1）；親系統不在這裡保存，一律查系統對照表（技術設計 4.3） */
export interface LineRow {
  gameId: string
  line: LinePosition
  /** 目前子系統 */
  subsystem: string
  /** 代表色（CSS 色碼） */
  color: string
  /** 開啟的遊戲年 */
  openedYear: number
}

/** 系統對照表的一筆（需求規格 7.2） */
export interface SystemRow {
  gameId: string
  subsystem: string
  parentSystem: string
  /** 分出來源；沒有登錄時留空 */
  origin?: string
}

/**
 * 母馬的用途（需求規格 8.3、8.4）：
 * own 自家母駒、substitute 替代母馬、start 第 1 系起點用，
 * unassigned 待指定用途的市場母馬、free 自由配種所生的自家母駒（11.5）；後兩種不屬於任何母馬群
 */
export type MareUsage = 'own' | 'substitute' | 'start' | 'unassigned' | 'free'

/** 在圈狀態（8.1）：生產中、售出、定年引退 */
export type HerdStatus = 'in-herd' | 'sold' | 'retired'

/**
 * 母馬的來源（8.1）：市場創系、市場補血、市場混血、市場補系、所屬競走馬引退轉入、其他
 */
export type MareSourceKind =
  | 'market-founding'
  | 'market-supplement'
  | 'market-crossbreed'
  | 'market-restoration'
  | 'retired-racehorse'
  | 'other'

export interface MareSource {
  kind: MareSourceKind
  note?: string
}

/** 據點（第 3 章）：繋養牧場番号 32 日本、33 分場、34 美國、35 歐洲 */
export type Base = 32 | 33 | 34 | 35

/** 進過自家繁殖圈的母馬（需求規格 8.1）；離圈後這一列仍然保留 */
export interface MareRow {
  horseId: string
  gameId: string
  usage: MareUsage
  /**
   * 所屬母馬群的系與代數：自家母駒依出生紀錄，替代母馬依她替代的系與代數，
   * 起點母馬為第 1 系 0 代（第 1 系起點母馬群）；待指定用途與自由配種所生留空
   */
  groupLine?: LinePosition
  groupGeneration?: number
  herd: HerdStatus
  /** 自家母駒的接替狀態（8.9）；其他用途留空 */
  sisterStatus?: SisterStatus
  /** 以暫定保留或正式保留轉入時設為 true，之後不改回：她所屬的代因此成立（8.2） */
  establishedGeneration: boolean
  source: MareSource
  /** 據點；還不知道時留空 */
  location?: Base
  /** 例外補入的原因（7.3）：零代市場種牡馬的配對底下補入市場母馬時填寫 */
  exceptionReason?: string
}

/** 預定後繼已誕生、還沒正式供用時的就緒狀態（需求規格 7.7）：競走中、已引退待指定 */
export type StallionReadiness = 'racing' | 'retired-awaiting'

/**
 * 八系種牡馬的一次任用（需求規格 7.7）：現任、前任、預定後繼，
 * 以及補公系補入的零代市場種牡馬（7.6）
 */
export interface StallionRow {
  id: string
  gameId: string
  line: LinePosition
  /** 代數；市場種牡馬為零代 */
  generation: number
  /** 補公系補入的零代市場種牡馬所屬的補系宣告；一般任用留空 */
  restorationId?: string
  /** 馬匹；預定後繼尚未誕生時留空 */
  horseId?: string
  /** 預定後繼尚未誕生時，受胎的八系指定配種 */
  breedingId?: string
  /** 接任後的狀態；留空表示預定後繼，還沒正式供用 */
  status?: StallionStatus
  /** 預定後繼已誕生、還沒正式供用時的就緒狀態 */
  readiness?: StallionReadiness
}

/** 一次斷血補系宣告（需求規格 7.6） */
export interface RestorationRow {
  id: string
  gameId: string
  line: LinePosition
  /** 斷血的代數 */
  generation: number
  /** 斷掉的一方：公系或母系 */
  side: RestorationSlot['side']
  reason: string
  /** 宣告的遊戲年 */
  year: number
  /** 使用者更正（撤銷）宣告時設為 true；紀錄保留（5.3） */
  revoked: boolean
}

/** 受胎狀態，原樣保存匯入文字（需求規格 9.1） */
export type Conception = '空胎' | '受胎' | '不受胎' | '未確認'

/** 八系指定配種的規則快照（需求規格 7.4） */
export interface BreedingRule {
  /** 配對距離；建系起點為 null */
  distance: PairingDistance | null
  /** 實際種牡馬的系與代數 */
  sire: LineGeneration
  /** 母馬配種當時的身分；用途修改從下一次配種才生效（8.4） */
  dam: DamRole
  /** 預計產出 */
  output: LineGeneration
  /** 補公系配對（7.6）；其他配種留空 */
  restoration?: true
}

/** 年度繁殖紀錄：一匹母馬一年一筆（需求規格 9.1） */
export interface BreedingRow {
  id: string
  gameId: string
  /** 母馬的內部識別 */
  mareId: string
  /** 配種的遊戲年 */
  year: number
  /** 八系指定配種（含建系期依 7.3 分支進行的配種）或自由配種 */
  kind: 'designated' | 'free'
  /** 實際種牡馬的內部識別；對應不到內部馬匹時留空 */
  sireId?: string
  /** 對應不到內部馬匹時，實際種牡馬的外部名稱（11.1） */
  sireName?: string
  /** 受胎狀態；還沒有結果時留空 */
  conception?: Conception
  /** 規則快照；八系指定配種才有 */
  rule?: BreedingRule
}
