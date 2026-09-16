export const LINE_POSITIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export type LinePosition = (typeof LINE_POSITIONS)[number];

export function isLinePosition(value: number): value is LinePosition {
  return Number.isInteger(value) && value >= 1 && value <= 8;
}

export interface LineBranch {
  /** 開啟分支時的產出代數；第 1 系起點為 1（需求規格 7.3）。 */
  readonly targetGeneration: number;
  readonly openedYear: number;
}

export interface EstablishedGeneration {
  readonly generation: number;
  readonly gameYear: number;
}

/** 設計決策 5.2 節 `lines`。目前子系統與親系統可隨遊戲更新，位置與 id 固定（需求規格 7.1）。 */
export interface Line {
  readonly id: string;
  readonly position: LinePosition;
  readonly subsystem: string;
  readonly parentSystem: string;
  readonly color: string;
  readonly branch: LineBranch;
  /** 已成立的母馬世代；成立後不可回溯（需求規格 8.2）。 */
  readonly establishedGenerations: readonly EstablishedGeneration[];
}

/** 世代成立後不可回溯（需求規格 8.2）：已成立時回傳 undefined，否則回傳加入成立紀錄後的系位置。 */
export function establishGeneration(
  line: Line,
  generation: number,
  gameYear: number,
): Line | undefined {
  if (line.establishedGenerations.some((item) => item.generation === generation)) {
    return undefined;
  }
  return {
    ...line,
    establishedGenerations: [...line.establishedGenerations, { generation, gameYear }].sort(
      (a, b) => a.generation - b.generation,
    ),
  };
}

export interface LineColor {
  readonly value: string;
  readonly label: string;
}

export const DEFAULT_LINE_COLOR = '#c62828';

export const LINE_COLORS: readonly LineColor[] = [
  { value: DEFAULT_LINE_COLOR, label: '紅' },
  { value: '#ef6c00', label: '橙' },
  { value: '#9e7c00', label: '金' },
  { value: '#2e7d32', label: '綠' },
  { value: '#00838f', label: '青' },
  { value: '#1565c0', label: '藍' },
  { value: '#6a1b9a', label: '紫' },
  { value: '#6d4c41', label: '褐' },
];

/** 代表色自動分配（需求規格 7.1）：依序取第一個尚未使用的顏色，全部用過時取預設代表色。 */
export function pickLineColor(usedColors: readonly string[]): string {
  const used = new Set(usedColors.map((color) => color.toLowerCase()));
  return LINE_COLORS.find((color) => !used.has(color.value))?.value ?? DEFAULT_LINE_COLOR;
}

/** 同一個親系統出現在兩個以上的系位置（需求規格 7.2、13.2、LINE-03、LINE-04）。 */
export interface DuplicateParentSystem {
  readonly parentSystem: string;
  readonly positions: readonly LinePosition[];
}

/** 八系親系統狀態（需求規格 13.2）：種類數與重複的系。 */
export interface ParentSystemStatus {
  readonly parentSystemCount: number;
  readonly duplicates: readonly DuplicateParentSystem[];
}

export interface LineParentSystemEntry {
  readonly position: LinePosition;
  readonly parentSystem: string;
}

/**
 * 八系親系統種類數與重複的系（需求規格 4.3、13.2）：只計已開啟的系，空白親系統不計入。
 * 八種互不相同才能維持 8 種活血（4.3）。
 */
export function parentSystemStatus(lines: readonly LineParentSystemEntry[]): ParentSystemStatus {
  const byParentSystem = new Map<string, LinePosition[]>();
  for (const line of lines) {
    if (line.parentSystem === '') {
      continue;
    }
    const positions = byParentSystem.get(line.parentSystem);
    if (positions === undefined) {
      byParentSystem.set(line.parentSystem, [line.position]);
    } else {
      positions.push(line.position);
    }
  }
  const duplicates = [...byParentSystem.entries()]
    .filter(([, positions]) => positions.length > 1)
    .map(([parentSystem, positions]) => ({
      parentSystem,
      positions: [...positions].sort((a, b) => a - b),
    }))
    .sort((a, b) => (a.positions[0] ?? 0) - (b.positions[0] ?? 0));
  return { parentSystemCount: byParentSystem.size, duplicates };
}
