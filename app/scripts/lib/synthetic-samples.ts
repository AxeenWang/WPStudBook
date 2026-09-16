import iconv from 'iconv-lite';
import type { ImportType } from '../../src/domain/import-type.ts';
import { IMPORT_FORMATS, type ImportFormatId } from '../../src/import/formats.ts';
import { cell, type SourceRow } from '../../src/import/parse.ts';
import {
  APR_FOALS_COLUMNS,
  BROODMARE_COLUMNS,
  JAN2YO_COLUMNS,
  STALLION_COLUMNS,
  type ColumnMap,
} from '../../src/import/columns.ts';

/**
 * 合成樣本（設計決策 7.4）：內容全部虛構，只依附錄 A 的欄數與欄位位置組出 TSV，
 * 再以 iconv-lite 轉成 CP932。產物不提交，版本控制只放這份產生器。
 *
 * 樣本刻意涵蓋規格點名的特例：`(外)`、`[地]` 前綴、`0x0000`、空白欄、`*13`、`72(72)`、
 * `42( +0)`、欄位內含逗號的 `2,450`、父系結尾「系」、年與月之間沒有空白的檔名。
 */
export interface SyntheticSample {
  readonly id: string;
  readonly fileName: string;
  readonly formatId: ImportFormatId;
  /** 這份樣本代表的匯入類型；候選 TXT 與目標種牡馬 TXT 的檔名無法解析，由使用者選。 */
  readonly importType: ImportType;
  readonly columns: ColumnMap;
  readonly rows: readonly Readonly<Record<string, string>>[];
}

/** 表頭：解析器驗證的欄位用真實欄名，其餘補佔位字串；最後一欄依附錄 A 是空白。 */
export function headerCells(formatId: ImportFormatId): string[] {
  const format = IMPORT_FORMATS[formatId];
  const row = Array.from({ length: format.columnCount }, (_, index) => `欄${String(index + 1)}`);
  for (const { position, name } of format.headers) {
    row[position - 1] = name;
  }
  return row;
}

function dataCells(
  formatId: ImportFormatId,
  columns: ColumnMap,
  values: Readonly<Record<string, string>>,
): string[] {
  const row = Array.from({ length: IMPORT_FORMATS[formatId].columnCount }, () => '');
  for (const [key, value] of Object.entries(values)) {
    const position = columns[key];
    if (position === undefined) {
      throw new Error(`${formatId} 沒有欄位 ${key}`);
    }
    row[position - 1] = value;
  }
  return row;
}

/** 組成樣本檔的位元組：Tab 分隔、CRLF 換行、檔尾也有換行、無 BOM 的 CP932（附錄 A）。 */
export function buildSampleBytes(sample: SyntheticSample): Uint8Array {
  const lines = [
    headerCells(sample.formatId),
    ...sample.rows.map((values) => dataCells(sample.formatId, sample.columns, values)),
  ];
  const text = lines.map((cells) => cells.join('\t')).join('\r\n') + '\r\n';
  return new Uint8Array(iconv.encode(text, 'cp932'));
}

/** 依欄位名稱取樣本的欄位值，讓測試不必記住附錄 A 的欄位序號。 */
export function sampleCell(
  sample: SyntheticSample,
  row: SourceRow,
  key: string,
): string | undefined {
  const position = sample.columns[key];
  if (position === undefined) {
    throw new Error(`${sample.id} 沒有欄位 ${key}`);
  }
  return cell(row, position);
}

const SUB_PARAMS = {
  power: 'B',
  quickness: 'A',
  guts: 'B',
  flexibility: 'C',
  spirit: 'B',
  wisdom: 'A',
  health: 'B',
} as const;

const STALLIONS: SyntheticSample = {
  id: 'mayStallions',
  // 年與月之間沒有空白，與 .references/ 的種牡馬實檔一致（設計決策 7.4）。
  fileName: '1968年5月1週_種牡馬.txt',
  formatId: 'stallion',
  importType: 'mayStallions',
  columns: STALLION_COLUMNS,
  rows: [
    {
      name: 'テストウマ001',
      country: '日',
      age: '8',
      sp: '95',
      st: '88',
      ...SUB_PARAMS,
      subParamTotal: '45',
      kodashi: '8',
      turf: '◎',
      dirt: '○',
      distance: '中距離',
      sireSystem: 'エクリプス系',
      // 欄位內含千分位逗號，不得據此判斷分隔（需求規格 11.1）。
      studFee: '2,450',
      sire: 'テストウマ900',
      dam: 'テストメス900',
      femaleLine: 'テスト牝系',
      bredCountry: '日',
      farm: '12',
      active: '○',
      historical: '○',
      historicalNo: '0x0001',
      // 0x0000 是有效值，不是空白或未知（ID-12）。
      abilityNo: '0x0000',
      horseNo: '0x0000',
      baseName: 'テストウマ001',
    },
    {
      name: '(外)テストウマ002',
      country: '米',
      age: '5',
      sp: '82',
      st: '90',
      ...SUB_PARAMS,
      subParamTotal: '40',
      kodashi: '6',
      turf: '○',
      dirt: '◎',
      distance: '短距離',
      sireSystem: 'ヘロド系',
      studFee: '1,200',
      sire: 'テストウマ901',
      dam: 'テストメス901',
      bredCountry: '米',
      farm: '240',
      active: '○',
      historical: '○',
      historicalNo: '0x0002',
      abilityNo: '0x0101',
      horseNo: '0x0101',
      baseName: 'テストウマ002',
    },
    {
      name: '[地]テストウマ003',
      country: '欧',
      age: '12',
      sp: '78',
      st: '75',
      ...SUB_PARAMS,
      subParamTotal: '38',
      kodashi: '5',
      turf: '◎',
      dirt: '△',
      distance: '長距離',
      sireSystem: 'マッチェム系',
      sire: 'テストウマ902',
      dam: 'テストメス902',
      bredCountry: '欧',
      farm: '260',
      active: '○',
      historical: '○',
      historicalNo: '0x0003',
      abilityNo: '0x0202',
      horseNo: '0x0202',
      baseName: 'テストウマ003',
    },
  ],
};

const TARGET_STALLION: SyntheticSample = {
  id: 'targetStallion',
  // 目標種牡馬 TXT 由使用者命名，檔名解析不出年與時點（IMP-03）。
  fileName: '目標種牡馬_テストウマ004.txt',
  formatId: 'stallion',
  importType: 'targetStallion',
  columns: STALLION_COLUMNS,
  rows: [
    {
      name: 'テストウマ004',
      country: '日',
      age: '6',
      sp: '90',
      st: '84',
      ...SUB_PARAMS,
      subParamTotal: '42',
      kodashi: '7',
      turf: '◎',
      dirt: '○',
      distance: '中距離',
      sireSystem: 'ヘロド系',
      studFee: '980',
      sire: '(外)テストウマ002',
      dam: 'テストメス903',
      bredCountry: '日',
      farm: '20',
      active: '○',
      historical: '○',
      historicalNo: '0x0004',
      abilityNo: '0x0303',
      horseNo: '0x0303',
      baseName: 'テストウマ004',
    },
  ],
};

interface HerdMare {
  readonly name: string;
  readonly baseName: string;
  readonly age: string;
  readonly farm: string;
  readonly abilityNo: string;
  readonly horseNo: string;
  readonly sireSystem?: string;
  readonly sire?: string;
}

const HERD_001: HerdMare = {
  name: 'テストメス001',
  baseName: 'テストメス001',
  age: '6',
  farm: '32',
  abilityNo: '0x1001',
  horseNo: '0x2001',
  sireSystem: 'エクリプス系',
  sire: 'テストウマ001',
};

const HERD_002: HerdMare = {
  name: 'テストメス002',
  baseName: 'テストメス002',
  age: '9',
  farm: '33',
  abilityNo: '0x1002',
  horseNo: '0x2002',
  sireSystem: 'ヘロド系',
  sire: '(外)テストウマ002',
};

/** 父馬與父系空白：匯入只補空白欄，不覆寫既有值（需求規格 11.5）。 */
const HERD_003: HerdMare = {
  name: '(外)テストメス003',
  baseName: 'テストメス003',
  age: '4',
  farm: '35',
  abilityNo: '0x1003',
  horseNo: '0x2003',
};

function mareRow(
  mare: HerdMare,
  extra: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return {
    name: mare.name,
    country: '日',
    age: mare.age,
    sp: '70',
    st: '72',
    ...SUB_PARAMS,
    subParamTotal: '36',
    kodashi: '7',
    turf: '○',
    dirt: '△',
    distance: '中距離',
    breedingYears: '3',
    breedingCount: '2',
    ...(mare.sire === undefined ? {} : { sire: mare.sire }),
    ...(mare.sireSystem === undefined ? {} : { sireSystem: mare.sireSystem }),
    dam: 'テストメス900',
    femaleLine: 'テスト牝系',
    farm: mare.farm,
    historicalNo: '0x7FFF',
    abilityNo: mare.abilityNo,
    horseNo: mare.horseNo,
    baseName: mare.baseName,
    ...extra,
  };
}

const MAY_MARES: SyntheticSample = {
  id: 'mayMares',
  fileName: '1968年 5月1週_繁殖牝馬.txt',
  formatId: 'broodmare',
  importType: 'mayMares',
  columns: BROODMARE_COLUMNS,
  rows: [
    // 活力帶前置 * 表示増強中（附錄 A.3）。
    mareRow(HERD_001, { vitality: '*13', status: '空胎' }),
    mareRow(HERD_002, { vitality: '88', status: '空胎' }),
    mareRow(HERD_003, { vitality: '100', status: '空胎' }),
  ],
};

/** 同一匹母馬在五月與七月的能力番号與馬番号相同（附錄 A.3）。 */
const JULY_MARES: SyntheticSample = {
  id: 'julMares',
  fileName: '1968年 7月1週_繁殖牝馬.txt',
  formatId: 'broodmare',
  importType: 'julMares',
  columns: BROODMARE_COLUMNS,
  rows: [
    mareRow(HERD_001, { vitality: '62', status: '受胎', matedStallion: 'テストウマ001' }),
    mareRow(HERD_002, { vitality: '54', status: '不受胎' }),
    mareRow(HERD_003, { vitality: '71', status: '受胎', matedStallion: '(外)テストウマ002' }),
  ],
};

const OCT_WORLD_MARES: SyntheticSample = {
  id: 'octWorldMares',
  fileName: '1968年10月1週_繁殖牝馬.txt',
  formatId: 'broodmare',
  importType: 'octWorldMares',
  columns: BROODMARE_COLUMNS,
  rows: [
    // 自家牧場的列由五月總表負責，十月一律略過（需求規格 11.10）。
    mareRow(HERD_001, { vitality: '60', status: '受胎' }),
    {
      // 在其他牧場成為繁殖牝馬的自家產駒：能力番号接得上四月與一月樣本。
      name: 'テストメス010',
      country: '日',
      age: '4',
      sp: '68',
      st: '70',
      ...SUB_PARAMS,
      subParamTotal: '35',
      kodashi: '6',
      farm: '150',
      status: '受胎',
      historicalNo: '0x7FFF',
      abilityNo: '0x3002',
      horseNo: '0x8001',
      baseName: 'テストメス010',
    },
    {
      // 牧場 0 在十月總表是有效值，不套用範圍檢查（需求規格 11.10）。
      name: 'テストメス020',
      country: '日',
      age: '7',
      sp: '66',
      st: '64',
      ...SUB_PARAMS,
      subParamTotal: '33',
      farm: '0',
      status: '空胎',
      historicalNo: '0x7FFF',
      abilityNo: '0x9001',
      horseNo: '0x9101',
      baseName: 'テストメス020',
    },
    {
      name: '(外)テストメス021',
      country: '米',
      age: '11',
      sp: '74',
      st: '69',
      ...SUB_PARAMS,
      subParamTotal: '37',
      farm: '240',
      status: '受胎',
      historicalNo: '0x7FFF',
      abilityNo: '0x9002',
      horseNo: '0x9102',
      baseName: 'テストメス021',
    },
  ],
};

/** 候選 TXT 的預覽要分頁，所以樣本筆數超過一頁（階段 2 的清單每頁 24 筆）。 */
const CANDIDATE_COUNT = 30;

function hexNo(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(4, '0')}`;
}

const CANDIDATES: SyntheticSample = {
  id: 'candidateFile',
  // 候選 TXT 由使用者命名，檔名解析不出年與時點（IMP-03）。
  fileName: '候補繁殖牝馬.txt',
  formatId: 'broodmare',
  importType: 'candidateFile',
  columns: BROODMARE_COLUMNS,
  rows: Array.from({ length: CANDIDATE_COUNT }, (_, index) => {
    const serial = String(index + 1).padStart(3, '0');
    return {
      name: index === 0 ? `(外)テスト候補${serial}` : `テスト候補${serial}`,
      country: '日',
      age: String(3 + (index % 10)),
      sp: String(60 + (index % 30)),
      st: String(58 + (index % 25)),
      ...SUB_PARAMS,
      subParamTotal: String(30 + (index % 12)),
      kodashi: String(index % 11),
      turf: '○',
      dirt: '△',
      distance: '中距離',
      vitality: index % 5 === 0 ? `*${String(10 + (index % 20))}` : String(50 + (index % 50)),
      breedingYears: '0',
      breedingCount: '0',
      sire: index % 3 === 0 ? 'テストウマ001' : `テストウマ9${String(10 + (index % 20))}`,
      sireSystem: index % 3 === 0 ? 'エクリプス系' : 'ヘロド系',
      dam: `テストメス9${String(10 + (index % 20))}`,
      // 空白的牝系欄：不屬於具名牝系與未取得的差別由匯入決定（需求規格 8.8）。
      femaleLine: index % 4 === 0 ? '' : `テスト牝系${String(index % 4)}`,
      farm: String(60 + (index % 40)),
      status: '空胎',
      historicalNo: '0x7FFF',
      abilityNo: hexNo(0x5000 + index),
      horseNo: hexNo(0x6000 + index),
      baseName: `テスト候補${serial}`,
    };
  }),
};

const APR_FOALS: SyntheticSample = {
  id: 'aprFoals',
  fileName: '1968年 4月1週_幼駒誕生.txt',
  formatId: 'aprFoals',
  importType: 'aprFoals',
  columns: APR_FOALS_COLUMNS,
  rows: [
    {
      name: 'テストメス001の0歳',
      age: '0',
      sex: '牡',
      // SP 與 サ 帶括號附加值（附錄 A.2）。
      sp: '72(72)',
      st: '68',
      ...SUB_PARAMS,
      subParamTotal: '42( +0)',
      turf: '◎',
      dirt: '○',
      distance: '中距離',
      kodashi: '7',
      sire: 'テストウマ001',
      sireSystem: 'エクリプス系',
      dam: 'テストメス001',
      femaleLine: 'テスト牝系',
      bredFarm: '32',
      owner: '46',
      farm: '32',
      historicalNo: '0x7FFF',
      abilityNo: '0x3001',
      horseNo: '0x4001',
      baseName: 'テストメス001の0歳',
    },
    {
      name: 'テストメス002の0歳',
      age: '0',
      sex: '牝',
      sp: '66(66)',
      st: '71',
      ...SUB_PARAMS,
      subParamTotal: '38( +0)',
      turf: '○',
      dirt: '△',
      distance: '長距離',
      kodashi: '6',
      sire: '(外)テストウマ002',
      sireSystem: 'ヘロド系',
      dam: 'テストメス002',
      femaleLine: 'テスト牝系',
      bredFarm: '33',
      owner: '47',
      farm: '33',
      historicalNo: '0x7FFF',
      abilityNo: '0x3002',
      horseNo: '0x4002',
      baseName: 'テストメス002の0歳',
    },
  ],
};

/** 1970 年的二歲馬＝1968 年誕生的幼駒，接得上四月樣本；也用來測年份推進（IMP-14、IMP-15）。 */
const JAN_2YO: SyntheticSample = {
  id: 'jan2yo',
  fileName: '1970年 1月1週._二歲新馬.txt',
  formatId: 'jan2yo',
  importType: 'jan2yo',
  columns: JAN2YO_COLUMNS,
  rows: [
    {
      name: 'テストウマ010',
      country: '日',
      age: '2',
      sex: '牡',
      sp: '74',
      st: '70',
      ...SUB_PARAMS,
      subParamTotal: '43',
      turf: '◎',
      dirt: '○',
      distance: '中距離',
      sireSystem: 'エクリプス系',
      kodashi: '7',
      sire: 'テストウマ001',
      dam: 'テストメス001',
      femaleLine: 'テスト牝系',
      bredCountry: '日',
      bredFarm: '32',
      owner: '46',
      farm: '32',
      historicalNo: '0x7FFF',
      abilityNo: '0x3001',
      horseNo: '0x7001',
      baseName: 'テストウマ010',
    },
    {
      name: 'テストメス010',
      country: '日',
      age: '2',
      sex: '牝',
      sp: '68',
      st: '72',
      ...SUB_PARAMS,
      subParamTotal: '39',
      turf: '○',
      dirt: '△',
      distance: '長距離',
      sireSystem: 'ヘロド系',
      kodashi: '6',
      sire: '(外)テストウマ002',
      dam: 'テストメス002',
      femaleLine: 'テスト牝系',
      bredCountry: '日',
      bredFarm: '33',
      owner: '47',
      farm: '33',
      historicalNo: '0x7FFF',
      abilityNo: '0x3002',
      horseNo: '0x7002',
      baseName: 'テストメス010',
    },
    {
      // 非管理馬：不是自家牧場生產，一月匯入略過（需求規格 11.3）。
      name: '[地]テストウマ011',
      country: '日',
      age: '2',
      sex: '牡',
      sp: '60',
      st: '62',
      ...SUB_PARAMS,
      subParamTotal: '30',
      sireSystem: 'マッチェム系',
      sire: '[地]テストウマ003',
      dam: 'テストメス905',
      bredCountry: '日',
      bredFarm: '90',
      owner: '5',
      farm: '90',
      historicalNo: '0x7FFF',
      abilityNo: '0x3003',
      horseNo: '0x7003',
      baseName: 'テストウマ011',
    },
  ],
};

export const SYNTHETIC_SAMPLES: readonly SyntheticSample[] = [
  JAN_2YO,
  APR_FOALS,
  MAY_MARES,
  JULY_MARES,
  CANDIDATES,
  STALLIONS,
  TARGET_STALLION,
  OCT_WORLD_MARES,
];

export function syntheticSample(id: string): SyntheticSample {
  const sample = SYNTHETIC_SAMPLES.find((item) => item.id === id);
  if (sample === undefined) {
    throw new Error(`沒有合成樣本 ${id}`);
  }
  return sample;
}
