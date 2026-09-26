import type { RestorationSlot } from '../core/board'
import type { DamRole } from '../core/generation'
import type { LineGeneration, LinePosition, PairingDistance } from '../core/lines'
import type { SisterStatus } from '../core/sisters'
import type { MarketStallionSystemCheck, StallionStatus } from '../core/stallions'
import type { SubstituteConflict } from '../core/substitute'

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
  /** 父馬的基本馬名：匯入檔記載的，或手動輸入的（見 pedigreeSource） */
  sireName?: string
  /** 母馬的基本馬名：匯入檔記載的，或手動輸入的（見 pedigreeSource） */
  damName?: string
  /** 父系：父馬所屬的子系統，去掉結尾「系」保存（11.1） */
  sireSystem?: string
  /**
   * 父母名與父系的來源（6.4）：import 為經匯入確認；manual 為手動輸入、尚未經匯入確認，
   * 只輔助身分配對，匯入時改用匯入值。三項都沒有值時留空
   */
  pedigreeSource?: 'import' | 'manual'
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
  /**
   * 自家母駒的接替狀態（8.9）；其他用途留空。
   * 售出或定年引退時保留離圈前的值，已售出由 herd 表示（技術設計 4.2）
   */
  sisterStatus?: SisterStatus
  /** 以暫定保留或正式保留轉入時設為 true，之後不改回：她所屬的代因此成立（8.2） */
  establishedGeneration: boolean
  source: MareSource
  /** 據點；還不知道時留空 */
  location?: Base
  /** 例外補入的原因（7.3）：零代市場種牡馬的配對底下補入市場母馬時填寫 */
  exceptionReason?: string
}

/** 離圈的狀態：售出、定年引退 */
export type DepartedStatus = Exclude<HerdStatus, 'in-herd'>

/** 母馬的用途與所屬母馬群；待指定用途與自由配種所生沒有系與代數 */
export type MarePlacement = Pick<MareRow, 'usage' | 'groupLine' | 'groupGeneration'>

/** 活力快照（需求規格 8.7）：0～100 的總活力與是否増強；只有前置 `*` 才是増強，100 不代表增強 */
export interface Vigor {
  value: number
  boosted: boolean
}

/** 活力快照的月份：五月繁殖圈名單、七月受胎名單 */
export type VigorMonth = 5 | 7

/** 今年計畫（需求規格 8.7）：待定、八系指定配種、自由配種、等待活力、輪休 */
export type MarePlan = 'pending' | 'designated' | 'free' | 'waiting-vigor' | 'resting'

/**
 * 一匹母馬一年的資料（需求規格 8.7、8.8）；每一欄都可以留空，空白是還沒取得，不是 0。
 * 活力的「不適用」與「待更新」不保存，讀取時推導（技術設計 4.3）
 */
export interface MareYearRow {
  gameId: string
  horseId: string
  year: number
  /** 五月的活力快照 */
  mayVigor?: Vigor
  /** 七月的活力快照 */
  julyVigor?: Vigor
  /** 仔出：0～15 的整數，11～15 是 CE 擴充值 */
  offspringQuality?: number
  /** 繁殖年數 */
  breedingYears?: number
  /** 繁殖頭數 */
  foalCount?: number
  /** 今年計畫；沒有值視為待定 */
  plan?: MarePlan
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

/**
 * 更換現任的原因（需求規格 7.7）：弟弟較優、前任引退、無法供用、斷血補系、遊戲依史實引退、其他
 */
export type StallionChangeReasonKind =
  | 'younger-brother'
  | 'predecessor-retired'
  | 'unavailable'
  | 'restoration'
  | 'historical-retirement'
  | 'other'

export interface StallionChangeReason {
  kind: StallionChangeReasonKind
  /** 補充說明；選「其他」時通常會填 */
  note?: string
}

/**
 * 寫入操作要求確認的警告（需求規格 5.2），確認後存在事件的 confirmedWarnings：
 * - parent-system-duplicate：第 line 系的親系統 parentSystem 與 lines 這些系的親系統相同（7.2、LINE-03）
 * - stallion-system：補入或替換的零代市場種牡馬，父系與第 line 系目前的子系統不同；
 *   親系統也不同時一併列出，提示影響活血（7.6、7.7）
 * - substitute-parent-system：替代第 line 系第 generation 代的市場母馬，親系統會讓後代 3 代前撞系（8.3）
 * - exception-entry：在產出第 line 系第 generation 代的零代市場種牡馬配對底下例外補入市場母馬（7.3、MARE-31）
 * - possible-buyback：手動新增的母馬與已售出的母馬 horseIds 同名，可能是買回（8.4、MARE-29）
 */
export type WriteWarning =
  | {
      kind: 'parent-system-duplicate'
      line: LinePosition
      parentSystem: string
      lines: LinePosition[]
    }
  | {
      kind: 'stallion-system'
      line: LinePosition
      subsystem: NonNullable<MarketStallionSystemCheck['subsystem']>
      parentSystem: MarketStallionSystemCheck['parentSystem']
    }
  | {
      kind: 'substitute-parent-system'
      line: LinePosition
      generation: number
      conflicts: SubstituteConflict[]
    }
  | { kind: 'exception-entry'; line: LinePosition; generation: number }
  | { kind: 'possible-buyback'; horseIds: string[] }

/** 系統對照表一筆的內容：親系統與分出來源 */
export type SystemValue = Pick<SystemRow, 'parentSystem' | 'origin'>

/** 遊戲內的時點（需求規格 4.1、11.1）：month 月 week 週，每月 4 週 */
export interface GameTiming {
  month: number
  week: number
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

/** 事件的來源：手動，或哪一種匯入；連到匯入紀錄的識別由 CE 匯入計畫加入（技術設計 4.3） */
export type EventSource = { kind: 'manual' } | { kind: 'import'; importType: ImportType }

/** 手動資料更正的欄位（需求規格 6.4）；事件記原值與新值，沒有值時記 null */
export interface HorseFieldValues {
  fullName?: string | null
  abilityNumber?: string | null
  birthYear?: number | null
  sireName?: string | null
  damName?: string | null
  sireSystem?: string | null
}

/**
 * 事件的共用欄位（技術設計 4.3「寫入操作」）。
 * 事件的對象另外放在 horseId、line、system，各自和 gameId 建索引；各種類自己的內容不使用這三個名稱，以免誤進索引
 */
interface EventBase {
  id: string
  gameId: string
  /** 操作當時的目前遊戲年 */
  year: number
  /** 寫入時間（ISO 8601） */
  recordedAt: string
  /** 來源：手動，或哪一種匯入 */
  source: EventSource
  /** 遊戲內的時點；手動操作沒有選時留空 */
  timing?: GameTiming
  /** 使用者確認過的警告（需求規格 5.2）；沒有警告時留空 */
  confirmedWarnings?: WriteWarning[]
}

/**
 * 一筆歷程事件（需求規格 5.3）：
 * - system-added、system-changed：系統對照表新增一筆、修改親系統或分出來源（7.2）
 * - line-opened：開啟新系，連同零代市場種牡馬（7.1）
 * - line-subsystem-changed：系的子系統名稱變更（7.1）
 * - stallion-assigned：補入或替換零代市場種牡馬（7.6、7.7）；replacedHorseIds 是同一格原本的種牡馬
 * - stallion-status-changed：種牡馬標示退出生產行列、已引退，或更正回在崗（7.7）
 * - restoration-declared、restoration-revoked：斷血補系的宣告與撤銷（7.6）
 * - mare-added：新增市場母馬（8.4），記用途、母馬的來源與例外補入的原因
 * - mare-usage-changed：修改市場母馬的用途（8.4）
 * - mare-departed：母馬離圈，reason 為售出或定年引退（8.5）
 * - mare-departure-corrected：更正離圈原因，或撤銷離圈回到生產中（8.5）
 * - mare-returned：已離圈的母馬買回或回歸（8.5、8.9），記接替狀態、用途與據點的變化
 * - mare-moved：轉場（8.6）；原本不知道據點時沒有 from
 * - horse-corrected：手動資料的更正（6.4），只記有改的欄位
 * - mare-plan-changed：今年計畫（8.7）；年份是事件的年份
 * - vigor-corrected：活力快照的人工更正（8.7），snapshotYear 是快照的年份
 * 母馬的事件只填對象 horseId：替代母馬不屬於她替代的系（8.3）
 */
export type EventRow = EventBase &
  (
    | { kind: 'system-added'; system: string; parentSystem: string; origin?: string }
    | { kind: 'system-changed'; system: string; from: SystemValue; to: SystemValue }
    | {
        kind: 'line-opened'
        line: LinePosition
        horseId: string
        stallionId: string
        subsystem: string
      }
    | { kind: 'line-subsystem-changed'; line: LinePosition; from: string; to: string }
    | {
        kind: 'stallion-assigned'
        line: LinePosition
        horseId: string
        stallionId: string
        restorationId?: string
        reason?: StallionChangeReason
        replacedHorseIds: string[]
      }
    | {
        kind: 'stallion-status-changed'
        line: LinePosition
        horseId?: string
        stallionId: string
        generation: number
        restorationId?: string
        from: StallionStatus
        to: StallionStatus
      }
    | {
        kind: 'restoration-declared'
        line: LinePosition
        restorationId: string
        generation: number
        side: RestorationRow['side']
        reason: string
      }
    | { kind: 'restoration-revoked'; line: LinePosition; restorationId: string }
    | {
        kind: 'mare-added'
        horseId: string
        placement: MarePlacement
        mareSource: MareSource
        exceptionReason?: string
      }
    | {
        kind: 'mare-usage-changed'
        horseId: string
        from: MarePlacement
        to: MarePlacement
        exceptionReason?: string
      }
    | { kind: 'mare-departed'; horseId: string; reason: DepartedStatus }
    | {
        kind: 'mare-departure-corrected'
        horseId: string
        from: DepartedStatus
        to: HerdStatus
        sisterStatus?: { from: SisterStatus; to: SisterStatus }
      }
    | {
        kind: 'mare-returned'
        horseId: string
        from: DepartedStatus
        sisterStatus?: { from: SisterStatus; to: SisterStatus }
        usage?: { from: MarePlacement; to: MarePlacement }
        exceptionReason?: string
        location?: { from?: Base; to: Base }
      }
    | { kind: 'mare-moved'; horseId: string; from?: Base; to: Base }
    | { kind: 'horse-corrected'; horseId: string; from: HorseFieldValues; to: HorseFieldValues }
    | { kind: 'mare-plan-changed'; horseId: string; from?: MarePlan; to: MarePlan }
    | {
        kind: 'vigor-corrected'
        horseId: string
        snapshotYear: number
        month: VigorMonth
        from?: Vigor
        to: Vigor
      }
  )

/** 事件去掉共用欄位（識別、遊戲局、年份、寫入時間、來源、時點）後的內容，由寫入操作填寫 */
export type EventContent<E extends EventRow = EventRow> = E extends unknown
  ? Omit<E, 'id' | 'gameId' | 'year' | 'recordedAt' | 'source' | 'timing'>
  : never
