import type { ImportBatch } from '../domain/import-batch.ts';
import type { ImportType } from '../domain/import-type.ts';
import { listImports } from '../storage/imports.ts';
import type { ServiceContext } from './context.ts';
import { requireCurrentGame } from './games.ts';

/**
 * 年度工作清單的順序（需求規格 13.2、UI-03）：一月、四月、五月繁殖牝馬、五月種牡馬、七月。
 * 十月全世界繁殖牝馬總表是選用的，不列入清單，沒有匯入也不算未完成（11.10）。
 */
export const ANNUAL_WORK_TYPES: readonly ImportType[] = [
  'jan2yo',
  'aprFoals',
  'mayMares',
  'mayStallions',
  'julMares',
];

export interface AnnualWorkItem {
  readonly type: ImportType;
  readonly done: boolean;
  /** 完成時的那一次匯入；同年同時點重複匯入時取最後套用的一次（資料更正）。 */
  readonly batch: ImportBatch | undefined;
}

export interface AnnualWork {
  readonly gameYear: number;
  readonly items: readonly AnnualWorkItem[];
}

/**
 * 依匯入紀錄自動標示完成（需求規格 13.2）。清單的每一項都是那一年的年度總表，
 * 所以沒有待建立新系的年份，五月種牡馬總表照樣列在清單裡（STL-02）。
 */
export function buildAnnualWork(batches: readonly ImportBatch[], gameYear: number): AnnualWork {
  const items = ANNUAL_WORK_TYPES.map((type): AnnualWorkItem => {
    const batch = batches
      .filter((item) => item.type === type && item.gameYear === gameYear)
      .sort((a, b) => a.appliedAt.localeCompare(b.appliedAt))
      .at(-1);
    return { type, done: batch !== undefined, batch };
  });
  return { gameYear, items };
}

export async function loadAnnualWork(context: ServiceContext): Promise<AnnualWork> {
  const game = await requireCurrentGame(context);
  return buildAnnualWork(await listImports(context.database, game.id), game.currentYear);
}
