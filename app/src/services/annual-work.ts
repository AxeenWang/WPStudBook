import type { AnnualWorkCorrection, GameSettings } from '../domain/game.ts';
import { GAME_SUBJECT_ID } from '../domain/history-event.ts';
import type { ImportBatch } from '../domain/import-batch.ts';
import type { ImportType } from '../domain/import-type.ts';
import { modifyGameSettings, readGameSettings } from '../storage/games.ts';
import { listImports } from '../storage/imports.ts';
import { trackWrite, type ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import { userEvent } from './events.ts';
import { gameTouch, requireCurrentGame } from './games.ts';

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
  /** 目前的完成狀態：有人工更正時取更正，否則依匯入紀錄。 */
  readonly done: boolean;
  /** 依匯入紀錄推導的完成狀態。 */
  readonly importedDone: boolean;
  /** 人工更正過，完成狀態與匯入紀錄推導的不同（需求規格 13.2「可人工更正」）。 */
  readonly corrected: boolean;
  /** 完成時的那一次匯入；同年同時點重複匯入時取最後套用的一次（資料更正）。 */
  readonly batch: ImportBatch | undefined;
}

export interface AnnualWork {
  readonly gameYear: number;
  readonly items: readonly AnnualWorkItem[];
}

function sameSlot(correction: AnnualWorkCorrection, gameYear: number, type: ImportType): boolean {
  return correction.gameYear === gameYear && correction.type === type;
}

/**
 * 依匯入紀錄自動標示完成並顯示摘要，人工更正優先（需求規格 13.2）。清單的每一項都是那一年的
 * 年度總表，所以沒有待建立新系的年份，五月種牡馬總表照樣列在清單裡（STL-02）。
 */
export function buildAnnualWork(
  batches: readonly ImportBatch[],
  gameYear: number,
  corrections: readonly AnnualWorkCorrection[] = [],
): AnnualWork {
  const items = ANNUAL_WORK_TYPES.map((type): AnnualWorkItem => {
    const batch = batches
      .filter((item) => item.type === type && item.gameYear === gameYear)
      .sort((a, b) => a.appliedAt.localeCompare(b.appliedAt))
      .at(-1);
    const importedDone = batch !== undefined;
    const correction = corrections.find((item) => sameSlot(item, gameYear, type));
    const done = correction?.done ?? importedDone;
    return { type, done, importedDone, corrected: done !== importedDone, batch };
  });
  return { gameYear, items };
}

export async function loadAnnualWork(context: ServiceContext): Promise<AnnualWork> {
  const game = await requireCurrentGame(context);
  const [batches, settings] = await Promise.all([
    listImports(context.database, game.id),
    readGameSettings(context.database, game.id),
  ]);
  return buildAnnualWork(batches, game.currentYear, settings?.annualWorkCorrections);
}

export interface AnnualWorkCorrectionInput {
  readonly type: ImportType;
  readonly done: boolean;
}

/**
 * 人工更正目前遊戲年的一項年度工作（需求規格 13.2）：例如那一年不需要匯入，或匯入後發現要重做。
 * 更正成與匯入紀錄相同的狀態時刪掉更正，清單回到依匯入紀錄自動標示。
 */
export async function correctAnnualWork(
  context: ServiceContext,
  input: AnnualWorkCorrectionInput,
): Promise<AnnualWork> {
  if (!ANNUAL_WORK_TYPES.includes(input.type)) {
    throw new ServiceError('invalidInput', '這一項不在年度工作清單裡');
  }
  const game = await requireCurrentGame(context);
  const batches = await listImports(context.database, game.id);
  const now = context.now().toISOString();
  const saved = await trackWrite(context, () =>
    modifyGameSettings(context.database, {
      gameId: game.id,
      touch: gameTouch(context, now),
      apply: ({ game: stored, settings }) => {
        const gameYear = stored.currentYear;
        const { annualWorkCorrections: current = [], ...others } = settings;
        const item = buildAnnualWork(batches, gameYear, current).items.find(
          (entry) => entry.type === input.type,
        );
        if (item === undefined || item.done === input.done) {
          throw new ServiceError('invalidInput', '年度工作的完成狀態沒有變更');
        }
        const rest = current.filter((entry) => !sameSlot(entry, gameYear, input.type));
        const next =
          input.done === item.importedDone
            ? rest
            : [...rest, { gameYear, type: input.type, done: input.done }];
        const updated: GameSettings = {
          ...others,
          ...(next.length === 0 ? {} : { annualWorkCorrections: next }),
        };
        const event = userEvent(context, {
          subjectId: GAME_SUBJECT_ID,
          type: 'annualWorkCorrected',
          gameYear,
          occurredAt: now,
          before: { type: input.type, done: item.done },
          after: { type: input.type, done: input.done },
        });
        return { settings: updated, event };
      },
    }),
  );
  const refreshed = await requireCurrentGame(context);
  return buildAnnualWork(batches, refreshed.currentYear, saved.annualWorkCorrections);
}
