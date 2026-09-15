import type { JsonObject } from '../domain/json.ts';
import {
  OVERALL_GRADES,
  isExplosivePower,
  type MatingRating,
  type OverallGrade,
} from '../domain/mating-rating.ts';
import { getHorsesByIds } from '../storage/horses.ts';
import { getMare } from '../storage/mares.ts';
import { listMatingRatingsForMare, writeMatingRating } from '../storage/mating-ratings.ts';
import { listStallionOptions, type StallionOption } from './breedings.ts';
import { trackWrite, type ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import { userEvent } from './events.ts';
import { gameTouch, requireCurrentGame } from './games.ts';

/** 介面用的選項（ui 不能引用 domain 的值）。 */
export const OVERALL_GRADE_OPTIONS: readonly OverallGrade[] = OVERALL_GRADES;

export interface MatingRatingInput {
  readonly mareId: string;
  /** 未選擇時為空字串。 */
  readonly stallionId: string;
  readonly overallGrade: OverallGrade | undefined;
  readonly explosivePower: number | undefined;
}

function ratingValue(rating: MatingRating): JsonObject {
  return {
    stallionId: rating.stallionId,
    gameYear: rating.gameYear,
    ...(rating.overallGrade === undefined ? {} : { overallGrade: rating.overallGrade }),
    ...(rating.explosivePower === undefined ? {} : { explosivePower: rating.explosivePower }),
  };
}

/**
 * 新增或編輯總合評價與爆發力（需求規格 9.2、BRD-17）：記錄在目前遊戲年；同年同組合直接更新，
 * 跨年各自保存，舊值可查。兩者屬於種牡馬＋繁殖牝馬組合，不是母馬固定能力。
 */
export async function saveMatingRating(
  context: ServiceContext,
  input: MatingRatingInput,
): Promise<MatingRating> {
  const game = await requireCurrentGame(context);
  const issues: string[] = [];
  if (input.stallionId === '') {
    issues.push('請選擇種牡馬');
  }
  const { overallGrade, explosivePower } = input;
  if (overallGrade !== undefined && !OVERALL_GRADES.includes(overallGrade)) {
    issues.push('總合評價必須是 S、A、B、C 或 D');
  }
  if (explosivePower !== undefined && !isExplosivePower(explosivePower)) {
    issues.push('爆發力必須是 0～99 的整數');
  }
  if (overallGrade === undefined && explosivePower === undefined) {
    issues.push('請輸入總合評價或爆發力');
  }
  if (issues.length > 0) {
    throw new ServiceError('invalidInput', issues.join('；'));
  }
  const now = context.now().toISOString();
  return trackWrite(context, () =>
    writeMatingRating(context.database, {
      gameId: game.id,
      mareId: input.mareId,
      stallionId: input.stallionId,
      touch: gameTouch(context, now),
      apply: ({ game: stored, mare, stallion, existing }) => {
        if (mare === undefined) {
          throw new ServiceError('invalidInput', '找不到這匹繁殖牝馬');
        }
        if (stallion?.sex !== 'male') {
          throw new ServiceError('invalidInput', '找不到這匹種牡馬');
        }
        const rating: MatingRating = {
          id: existing?.id ?? context.newId(),
          stallionId: stallion.id,
          mareId: mare.id,
          gameYear: stored.currentYear,
          ...(overallGrade === undefined ? {} : { overallGrade }),
          ...(explosivePower === undefined ? {} : { explosivePower }),
        };
        const before = existing === undefined ? undefined : ratingValue(existing);
        const after = ratingValue(rating);
        if (JSON.stringify(before) === JSON.stringify(after)) {
          throw new ServiceError('invalidInput', '配種評價沒有變更');
        }
        const event = userEvent(context, {
          subjectId: mare.id,
          type: 'matingRatingRecorded',
          gameYear: stored.currentYear,
          occurredAt: now,
          before,
          after,
        });
        return { rating, events: [event] };
      },
    }),
  );
}

export interface MatingRatingRow {
  readonly id: string;
  readonly stallionId: string;
  readonly stallionName: string;
  readonly gameYear: number;
  readonly overallGrade: OverallGrade | undefined;
  readonly explosivePower: number | undefined;
}

export interface MareMatingRatings {
  readonly currentYear: number;
  /** 遊戲年新到舊，同年依種牡馬馬名。 */
  readonly rows: readonly MatingRatingRow[];
  readonly stallionOptions: readonly StallionOption[];
}

/** 詳情欄配種頁籤的評價紀錄：各年各組合的總合評價與爆發力。 */
export async function loadMareMatingRatings(
  context: ServiceContext,
  mareId: string,
): Promise<MareMatingRatings> {
  const game = await requireCurrentGame(context);
  if ((await getMare(context.database, game.id, mareId)) === undefined) {
    throw new ServiceError('invalidInput', '找不到這匹繁殖牝馬');
  }
  const [ratings, stallionOptions] = await Promise.all([
    listMatingRatingsForMare(context.database, game.id, mareId),
    listStallionOptions(context),
  ]);
  const horses = await getHorsesByIds(context.database, game.id, [
    ...new Set(ratings.map((rating) => rating.stallionId)),
  ]);
  const rows = ratings
    .map((rating): MatingRatingRow => {
      const horse = horses.get(rating.stallionId);
      return {
        id: rating.id,
        stallionId: rating.stallionId,
        stallionName:
          horse?.fullName ?? horse?.officialName ?? horse?.baseName ?? rating.stallionId,
        gameYear: rating.gameYear,
        overallGrade: rating.overallGrade,
        explosivePower: rating.explosivePower,
      };
    })
    .sort((a, b) => b.gameYear - a.gameYear || a.stallionName.localeCompare(b.stallionName, 'ja'));
  return { currentYear: game.currentYear, rows, stallionOptions };
}
