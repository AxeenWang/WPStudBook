import type { Lineage } from '../domain/lineage.ts';

/** 代數文字（需求規格 3 章）：任務標題沿用規格的「第 2 系零代」、「第 1 系 1 代」寫法。 */
function generationText(generation: number): string {
  return generation === 0 ? '零代' : ` ${String(generation)} 代`;
}

export function formatLineage(lineage: Lineage): string {
  return `第 ${String(lineage.position)} 系${generationText(lineage.generation)}`;
}

/** 確認紀錄的介面文字（需求規格 10.2）。 */
export const PEDIGREE_WARNING_LABELS: Readonly<Record<string, string | undefined>> = {
  activationBelowFull: '活血少於 8 種',
  duplicateAncestors: '4 代內有重複的馬',
  insufficientPedigree: '血統資料不足',
};
