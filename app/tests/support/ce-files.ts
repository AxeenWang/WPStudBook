import type { ImportFormat } from '../../src/ce-import/formats'

// 測試用的 CE 匯出檔內容：表頭照附錄 A 的格式（取自實際匯出檔的表頭），資料列全部虛構

/** 一行 Tab 連接的欄名（與匯出檔的第一行相同）拆成欄位 */
const fields = (line: string) => line.split('\t')

/** 各格式的表頭，最後一欄是空白（附錄 A） */
export const HEADERS: Record<ImportFormat, readonly string[]> = {
  'two-year-old': fields(
    '馬名\t国\t年\t性\tSP\tST\tSP率\t力\t瞬\t勝\t柔\t精\t賢\t健\tサ\t気\t芝\tダ\t距離適性\t適瞬\t適持\t適消\t脚質\t成型\t成力\t成度\t成限\t寿命\t調子\t疲労\t合\t父系\t馬体重\t異能\t子出\t毛色\t性格\t高\t長\t跳\t小\t左\t右\t脚\t喉\t腰\t遅\t特性\tウマソナ\tドラマ因子\t父馬\t母馬\t牝系\t出走\t戦績\t前走\t近3走\t次走\tクラス\t賞金\t本賞金\t生産国\t生牧\t馬主\t繋牧\t調教師\t騎手\t海外遠征\t注目\t現役\t史実\t引齢\t史実番号\t能力番号\t馬番号\t継承特性\t馬名\t',
  ),
  foal: fields(
    '馬名\t国\t年\t性\tSP\tST\tSP率\t力\t瞬\t勝\t柔\t精\t賢\t健\tサ\t気\t芝\tダ\t適瞬\t適持\t適消\t脚質\t成型\t成力\t成限\t寿命\t距離適性\t子出\t毛色\t性格\t高\t長\t小\t左\t右\t脚\t喉\t腰\t特性\tウマソナ\t札\t馬印\t評価額\t取引額\t評判\t父馬\t父系\t母馬\t牝系\t生産国\t生牧\t馬主\t繋牧\t注目\t史実\t引齢\t史実番号\t能力番号\t馬番号\t継承特性\t馬名\t取引\t',
  ),
  broodmare: fields(
    '馬名\t国\t年\tSP\tST\t力\t瞬\t勝\t柔\t精\t賢\t健\tサ\t因左\t因右\t子出\t気\t芝\tダ\t脚質\t成型\t成力\t距離適性\t適瞬\t適持\t適消\t活力\t毛色\t性格\t高\t長\t小\t特性\tドラマ因子\t札\t評価額\t繁年\t繁頭\t戦\t勝\tG1\t勝鞍\t父馬\t父系\t母馬\t牝系\t生産国\t牧場\t状態\t種付け種牡馬\t受胎中史実馬\t特殊配合\t注目\t現役\t史実\t史実番号\t能力番号\t馬番号\t馬名\t購入額\t',
  ),
  stallion: fields(
    '馬名\t国\t年\tSP\tST\t力\t瞬\t勝\t柔\t精\t賢\t健\tサ\t因左\t因右\t子出\t気\t芝\tダ\t脚質\t成型\t成力\t距離適性\t適瞬\t適持\t適消\t毛色\t性格\t高\t長\t小\t特性\t父系\tドラマ因子\t戦\t勝\t種付料\tBF\tSC\tプラ\t当\t獲得賞金\t重賞勝\tG1勝\t1順位\t2順位\t3順位\t4順位\t父馬\t母馬\t牝系\t生産国\t牧場\t特殊配合\t注目\t現役\t史実\t史実番号\t能力番号\t馬番号\t継承特性\t馬名\t',
  ),
}

/** 一列的值：key 是第幾欄（從 1 起算），沒列出的欄是空白 */
export type ExportValues = Readonly<Partial<Record<number, string>>>

/** 各格式的一列範例（虛構）；含逗號的欄位（評価額、賞金、種付料）不影響 Tab 分隔 */
export const SAMPLES: Record<ImportFormat, ExportValues> = {
  'two-year-old': {
    1: '(外)テストアオバ',
    2: '日',
    3: '2',
    4: '牝',
    5: '68',
    6: '45',
    8: 'C',
    9: 'B',
    10: 'C+',
    11: 'D',
    12: 'B+',
    13: 'E',
    14: 'C',
    15: '61',
    17: '◎',
    18: '×',
    19: '1400～2000m',
    32: 'エクリプス系',
    35: '3',
    51: 'テストチチ',
    52: 'テストハハ',
    53: 'テストヒンケイ',
    60: '2,450',
    62: '日本',
    63: '32',
    64: '46',
    65: '32',
    73: '0x7FFF',
    74: '0x0a1f',
    75: '0x1b2c',
    77: 'テストアオバ',
  },
  foal: {
    1: 'テストハハの0歳',
    2: '日',
    3: '0',
    4: '牡',
    5: '72(72)',
    6: '40',
    8: 'B(0)',
    9: 'B+(0)',
    10: 'C(0)',
    11: 'D+(0)',
    12: 'C(0)',
    13: 'E(0)',
    14: 'S(0)',
    15: '42( +0)',
    17: '○',
    18: '◎',
    27: '1600～2400m',
    28: '2',
    43: '1,200',
    46: 'テストチチ',
    47: 'ファロス系',
    48: 'テストハハ',
    49: 'テストヒンケイ',
    50: '日本',
    51: '32',
    52: '46',
    53: '32',
    57: '0x0FFF',
    58: '0x0a20',
    59: '0x1b30',
    61: 'テストハハの0歳',
  },
  broodmare: {
    1: '[地]テストハハ',
    2: '日',
    3: '8',
    4: '64',
    5: '52',
    6: 'C',
    7: 'C+',
    8: 'D',
    9: 'B',
    10: 'C',
    11: 'D+',
    12: 'C',
    13: '55',
    16: '4',
    18: '△',
    19: '◎',
    23: '1200～1800m',
    27: '*80',
    36: '3,000',
    37: '4',
    38: '3',
    43: 'テストソフ',
    44: 'エクリプス系',
    45: 'テストソボ',
    46: 'テストヒンケイ',
    47: '日本',
    48: '32',
    49: '空胎',
    52: '疾風',
    56: '0x0FFF',
    57: '0x0b01',
    58: '0x1c01',
    59: 'テストハハ',
  },
  stallion: {
    1: '(外)テストチチ',
    2: '米',
    3: '6',
    4: '75',
    5: '60',
    6: 'B',
    7: 'A',
    8: 'B+',
    9: 'C',
    10: 'B',
    11: 'C+',
    12: 'B',
    13: '70',
    16: '5',
    18: '◎',
    19: '○',
    23: '1800～2600m',
    33: 'ナスルーラ系',
    37: '1,500',
    42: '12,345',
    49: 'テストソフ',
    50: 'テストソボ',
    51: 'テストヒンケイ',
    52: '米国',
    53: '240',
    54: '稲妻',
    56: '○',
    57: '○',
    58: '0x0010',
    59: '0x0010',
    60: '0x0010',
    62: 'テストチチ',
  },
}

/** 組出 Tab 分隔、CRLF 換行的匯出檔內容；與 CE 相同，最後一欄是空白，最後一行也有換行 */
export function exportText(format: ImportFormat, rows: readonly ExportValues[]): string {
  const header = HEADERS[format]
  const lines = rows.map((values) => header.map((_, index) => values[index + 1] ?? ''))
  return [header, ...lines].map((fields) => fields.join('\t')).join('\r\n') + '\r\n'
}

/**
 * 轉成 Excel 另存的 CSV（IMP-22）：逗號分隔，含逗號或雙引號的欄位加上雙引號（欄位內的雙引號寫兩次），
 * 每一行去掉尾端的空白欄
 */
export function excelCsv(text: string): string {
  return text
    .split('\r\n')
    .map((line) => {
      if (line === '') return line
      const fields = line.split('\t')
      if (fields[fields.length - 1] === '') fields.pop()
      return fields
        .map((field) => (/[",]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field))
        .join(',')
    })
    .join('\r\n')
}
