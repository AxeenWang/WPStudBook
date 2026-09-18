import type { ImportType } from '../domain/import-type.ts';

export type ImportFormatId = 'jan2yo' | 'aprFoals' | 'broodmare' | 'stallion';

export interface HeaderExpectation {
  readonly position: number;
  readonly name: string;
}

export interface ImportFormat {
  readonly id: ImportFormatId;
  readonly columnCount: number;
  readonly headers: readonly HeaderExpectation[];
}

function headers(entries: Readonly<Record<number, string>>): HeaderExpectation[] {
  return Object.entries(entries).map(([position, name]) => ({ position: Number(position), name }));
}

export const IMPORT_FORMATS: Readonly<Record<ImportFormatId, ImportFormat>> = {
  jan2yo: {
    id: 'jan2yo',
    columnCount: 78,
    headers: headers({
      1: '馬名',
      2: '国',
      3: '年',
      4: '性',
      5: 'SP',
      6: 'ST',
      8: '力',
      9: '瞬',
      10: '勝',
      11: '柔',
      12: '精',
      13: '賢',
      14: '健',
      15: 'サ',
      17: '芝',
      18: 'ダ',
      19: '距離適性',
      32: '父系',
      35: '子出',
      51: '父馬',
      52: '母馬',
      53: '牝系',
      62: '生産国',
      63: '生牧',
      64: '馬主',
      65: '繋牧',
      71: '史実',
      73: '史実番号',
      74: '能力番号',
      75: '馬番号',
      77: '馬名',
      78: '',
    }),
  },
  aprFoals: {
    id: 'aprFoals',
    columnCount: 63,
    headers: headers({
      1: '馬名',
      3: '年',
      4: '性',
      5: 'SP',
      6: 'ST',
      8: '力',
      9: '瞬',
      10: '勝',
      11: '柔',
      12: '精',
      13: '賢',
      14: '健',
      15: 'サ',
      17: '芝',
      18: 'ダ',
      27: '距離適性',
      28: '子出',
      46: '父馬',
      47: '父系',
      48: '母馬',
      49: '牝系',
      51: '生牧',
      52: '馬主',
      53: '繋牧',
      57: '史実番号',
      58: '能力番号',
      59: '馬番号',
      61: '馬名',
      63: '',
    }),
  },
  broodmare: {
    id: 'broodmare',
    columnCount: 61,
    headers: headers({
      1: '馬名',
      3: '年',
      4: 'SP',
      5: 'ST',
      6: '力',
      7: '瞬',
      8: '勝',
      9: '柔',
      10: '精',
      11: '賢',
      12: '健',
      13: 'サ',
      16: '子出',
      18: '芝',
      19: 'ダ',
      23: '距離適性',
      27: '活力',
      37: '繁年',
      38: '繁頭',
      43: '父馬',
      44: '父系',
      45: '母馬',
      46: '牝系',
      48: '牧場',
      49: '状態',
      50: '種付け種牡馬',
      52: '特殊配合',
      56: '史実番号',
      57: '能力番号',
      58: '馬番号',
      59: '馬名',
      61: '',
    }),
  },
  stallion: {
    id: 'stallion',
    columnCount: 63,
    headers: headers({
      1: '馬名',
      2: '国',
      3: '年',
      4: 'SP',
      5: 'ST',
      6: '力',
      7: '瞬',
      8: '勝',
      9: '柔',
      10: '精',
      11: '賢',
      12: '健',
      13: 'サ',
      16: '子出',
      18: '芝',
      19: 'ダ',
      23: '距離適性',
      33: '父系',
      35: '戦',
      36: '勝',
      37: '種付料',
      42: '獲得賞金',
      43: '重賞勝',
      44: 'G1勝',
      49: '父馬',
      50: '母馬',
      51: '牝系',
      52: '生産国',
      53: '牧場',
      54: '特殊配合',
      56: '現役',
      57: '史実',
      58: '史実番号',
      59: '能力番号',
      60: '馬番号',
      62: '馬名',
      63: '',
    }),
  },
};

export const FORMAT_OF_IMPORT_TYPE = {
  jan2yo: 'jan2yo',
  aprFoals: 'aprFoals',
  mayMares: 'broodmare',
  julMares: 'broodmare',
  candidateFile: 'broodmare',
  octWorldMares: 'broodmare',
  mayStallions: 'stallion',
  targetStallion: 'stallion',
} as const satisfies Record<ImportType, ImportFormatId>;

export function findHeaderMismatches(format: ImportFormat, headerRow: readonly string[]): string[] {
  const problems: string[] = [];
  if (headerRow.length !== format.columnCount) {
    problems.push(`欄數應為 ${String(format.columnCount)}，實際為 ${String(headerRow.length)}`);
  }
  for (const { position, name } of format.headers) {
    const actual = headerRow[position - 1];
    if (actual !== name) {
      problems.push(
        `第 ${String(position)} 欄應為「${name}」，實際為「${actual ?? '（不存在）'}」`,
      );
    }
  }
  return problems;
}
