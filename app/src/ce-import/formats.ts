import type { SubAbilities } from '../core/foal'
import type { Sex, SurfaceAptitude, Vigor } from '../core/horse'
import type { ImportType } from '../core/imports'
import type { Cells } from './cells'

/** 匯出檔的四種格式（附錄 A）：一月二歲馬總表、四月誕生幼駒名單、繁殖牝馬格式、種牡馬格式 */
export type ImportFormat = 'two-year-old' | 'foal' | 'broodmare' | 'stallion'

/**
 * 各類型的格式（附錄 A）：五月繁殖圈名單、七月受胎名單、十月全世界繁殖牝馬總表與候選 TXT 是繁殖牝馬格式，
 * 種牡馬總表與目標種牡馬 TXT 是種牡馬格式
 */
export const FORMAT_OF: Record<ImportType, ImportFormat> = {
  'january-two-year-olds': 'two-year-old',
  'april-foals': 'foal',
  'may-herd': 'broodmare',
  'july-conception': 'broodmare',
  'october-mares': 'broodmare',
  candidates: 'broodmare',
  'stallion-list': 'stallion',
  'target-stallion': 'stallion',
}

/** 各格式的欄數，含尾端的空白欄（附錄 A）；尾端的空白欄可有可無（需求規格 11.1） */
export const FIELD_COUNTS: Record<ImportFormat, number> = {
  'two-year-old': 78,
  foal: 63,
  broodmare: 61,
  stallion: 63,
}

/** 各格式共有的欄位（附錄 A 的主要欄位）；馬名與父母名原樣保留，基本馬名由比對階段取得 */
export interface ExportEntry {
  /** 檔案的第幾行，表頭是第 1 行 */
  line: number
  /** 第 1 欄的完整馬名 */
  fullName: string
  /** 最後一個 `馬名` 欄的基本馬名 */
  baseName: string
  /** `国` */
  country: string
  /** `年`：馬齡 */
  age: number
  /** 出生年＝年份減馬齡（需求規格 6.3、11.3、11.8、11.10） */
  birthYear: number
  /** `SP` */
  speed: number
  /** `ST` */
  stamina: number
  subAbilities: Required<SubAbilities>
  /** `サ` */
  subTotal: number
  turf: SurfaceAptitude
  dirt: SurfaceAptitude
  /** 距離適性，原樣保留，例如 `1700～3100m` */
  distance: string
  /** `子出` */
  offspringQuality: number
  sireName: string
  damName: string
  /** `父系`，去掉結尾「系」；空白時是 null */
  sireSystem: string | null
  /** `牝系` */
  femaleLine: string
  abilityNumber: string
  horseNumber: string
}

/** 一月二歲馬總表的一列（附錄 A.1） */
export interface TwoYearOldEntry extends ExportEntry {
  sex: Sex
  /** `生産国` */
  birthCountry: string
  /** `生牧` */
  birthFarm: number | null
  /** `馬主`：馬主番号 */
  owner: number | null
  /** `繋牧`：繋養牧場番号 */
  stable: number | null
  /** `史実`：`○` 或空白，原樣保留 */
  historical: string
}

/** 四月誕生幼駒名單的一列（附錄 A.2） */
export interface FoalEntry extends ExportEntry {
  sex: Sex
  birthFarm: number | null
  owner: number | null
  stable: number | null
}

/** 繁殖牝馬格式的一列（附錄 A.3） */
export interface BroodmareEntry extends ExportEntry {
  vigor: Vigor
  /** `繁年`：繁殖年數 */
  breedingYears: number
  /** `繁頭`：繁殖頭數 */
  foalCount: number
  /** `牧場`：繋養牧場番号 */
  farm: number | null
  /** `状態`，原樣保留 */
  status: string
  /** `種付け種牡馬`，原樣保留 */
  matedStallion: string
  /** `特殊配合`，原樣保留 */
  specialMating: string
}

/** 種牡馬格式的一列（附錄 A.4） */
export interface StallionEntry extends ExportEntry {
  /** `種付料`：帶千分位逗號，原樣保留 */
  studFee: string
  birthCountry: string
  /** `牧場`：任何牧場的番号（需求規格 11.8） */
  farm: number | null
  specialMating: string
  /** `現役`：`○` 或空白，原樣保留 */
  active: string
  historical: string
}

/** 各格式依位置讀一列；讀表頭時 year 不使用。史実番号不讀（JAN-07） */
export type EntryReader<E extends ExportEntry> = (cells: Cells, line: number, year: number) => E

/** 一月二歲馬總表（附錄 A.1） */
export const readTwoYearOld: EntryReader<TwoYearOldEntry> = (cells, line, year) => {
  const age = cells.integer(3, '年')
  return {
    line,
    fullName: cells.text(1, '馬名'),
    country: cells.text(2, '国'),
    age,
    birthYear: year - age,
    sex: cells.sex(4, '性'),
    speed: cells.integer(5, 'SP'),
    stamina: cells.integer(6, 'ST'),
    subAbilities: subAbilities(cells, 8),
    subTotal: cells.integer(15, 'サ'),
    turf: cells.aptitude(17, '芝'),
    dirt: cells.aptitude(18, 'ダ'),
    distance: cells.text(19, '距離適性'),
    sireSystem: cells.sireSystem(32, '父系'),
    offspringQuality: cells.integer(35, '子出'),
    sireName: cells.text(51, '父馬'),
    damName: cells.text(52, '母馬'),
    femaleLine: cells.text(53, '牝系'),
    birthCountry: cells.text(62, '生産国'),
    birthFarm: cells.code(63, '生牧'),
    owner: cells.code(64, '馬主'),
    stable: cells.code(65, '繋牧'),
    historical: cells.text(71, '史実'),
    abilityNumber: cells.number(74, '能力番号'),
    horseNumber: cells.number(75, '馬番号'),
    baseName: cells.text(77, '馬名'),
  }
}

/** 四月誕生幼駒名單（附錄 A.2） */
export const readFoal: EntryReader<FoalEntry> = (cells, line, year) => {
  const age = cells.integer(3, '年')
  return {
    line,
    fullName: cells.text(1, '馬名'),
    country: cells.text(2, '国'),
    age,
    birthYear: year - age,
    sex: cells.sex(4, '性'),
    speed: cells.integer(5, 'SP'),
    stamina: cells.integer(6, 'ST'),
    subAbilities: subAbilities(cells, 8),
    subTotal: cells.integer(15, 'サ'),
    turf: cells.aptitude(17, '芝'),
    dirt: cells.aptitude(18, 'ダ'),
    distance: cells.text(27, '距離適性'),
    offspringQuality: cells.integer(28, '子出'),
    sireName: cells.text(46, '父馬'),
    sireSystem: cells.sireSystem(47, '父系'),
    damName: cells.text(48, '母馬'),
    femaleLine: cells.text(49, '牝系'),
    birthFarm: cells.code(51, '生牧'),
    owner: cells.code(52, '馬主'),
    stable: cells.code(53, '繋牧'),
    abilityNumber: cells.number(58, '能力番号'),
    horseNumber: cells.number(59, '馬番号'),
    baseName: cells.text(61, '馬名'),
  }
}

/** 繁殖牝馬格式（附錄 A.3） */
export const readBroodmare: EntryReader<BroodmareEntry> = (cells, line, year) => {
  const age = cells.integer(3, '年')
  return {
    line,
    fullName: cells.text(1, '馬名'),
    country: cells.text(2, '国'),
    age,
    birthYear: year - age,
    speed: cells.integer(4, 'SP'),
    stamina: cells.integer(5, 'ST'),
    subAbilities: subAbilities(cells, 6),
    subTotal: cells.integer(13, 'サ'),
    offspringQuality: cells.integer(16, '子出'),
    turf: cells.aptitude(18, '芝'),
    dirt: cells.aptitude(19, 'ダ'),
    distance: cells.text(23, '距離適性'),
    vigor: cells.vigor(27, '活力'),
    breedingYears: cells.integer(37, '繁年'),
    foalCount: cells.integer(38, '繁頭'),
    sireName: cells.text(43, '父馬'),
    sireSystem: cells.sireSystem(44, '父系'),
    damName: cells.text(45, '母馬'),
    femaleLine: cells.text(46, '牝系'),
    farm: cells.code(48, '牧場'),
    status: cells.text(49, '状態'),
    matedStallion: cells.text(50, '種付け種牡馬'),
    specialMating: cells.text(52, '特殊配合'),
    abilityNumber: cells.number(57, '能力番号'),
    horseNumber: cells.number(58, '馬番号'),
    baseName: cells.text(59, '馬名'),
  }
}

/** 種牡馬格式（附錄 A.4） */
export const readStallion: EntryReader<StallionEntry> = (cells, line, year) => {
  const age = cells.integer(3, '年')
  return {
    line,
    fullName: cells.text(1, '馬名'),
    country: cells.text(2, '国'),
    age,
    birthYear: year - age,
    speed: cells.integer(4, 'SP'),
    stamina: cells.integer(5, 'ST'),
    subAbilities: subAbilities(cells, 6),
    subTotal: cells.integer(13, 'サ'),
    offspringQuality: cells.integer(16, '子出'),
    turf: cells.aptitude(18, '芝'),
    dirt: cells.aptitude(19, 'ダ'),
    distance: cells.text(23, '距離適性'),
    sireSystem: cells.sireSystem(33, '父系'),
    studFee: cells.text(37, '種付料'),
    sireName: cells.text(49, '父馬'),
    damName: cells.text(50, '母馬'),
    femaleLine: cells.text(51, '牝系'),
    birthCountry: cells.text(52, '生産国'),
    farm: cells.code(53, '牧場'),
    specialMating: cells.text(54, '特殊配合'),
    active: cells.text(56, '現役'),
    historical: cells.text(57, '史実'),
    abilityNumber: cells.number(59, '能力番号'),
    horseNumber: cells.number(60, '馬番号'),
    baseName: cells.text(62, '馬名'),
  }
}

/** 七項副能力：從 first 起連續七欄 力、瞬、勝、柔、精、賢、健 */
function subAbilities(cells: Cells, first: number): Required<SubAbilities> {
  return {
    power: cells.grade(first, '力'),
    burst: cells.grade(first + 1, '瞬'),
    guts: cells.grade(first + 2, '勝'),
    flexibility: cells.grade(first + 3, '柔'),
    spirit: cells.grade(first + 4, '精'),
    wisdom: cells.grade(first + 5, '賢'),
    health: cells.grade(first + 6, '健'),
  }
}
