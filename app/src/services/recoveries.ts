import type { LinePosition } from '../domain/line.ts';
import {
  isRecoveryInProgress,
  recoveryTargetGeneration,
  RECOVERY_SIDES,
  type Recovery,
  type RecoverySide,
} from '../domain/recovery.ts';
import { listLines } from '../storage/lines.ts';
import { getRecovery, listRecoveries, writeRecovery } from '../storage/recoveries.ts';
import type { ServiceContext } from './context.ts';
import { trackWrite } from './context.ts';
import { ServiceError } from './errors.ts';
import { userEvent } from './events.ts';
import { gameTouch, requireCurrentGame } from './games.ts';

export const RECOVERY_SIDE_OPTIONS: readonly RecoverySide[] = RECOVERY_SIDES;

export interface DeclareRecoveryInput {
  readonly position: LinePosition;
  /** 斷血的代數；補系產出下一代（需求規格 7.6）。 */
  readonly generation: number | undefined;
  readonly side: RecoverySide;
  readonly reason: string;
  /** 採用其他系血統時的來源系位置。 */
  readonly bloodFromPosition?: LinePosition | undefined;
}

function recoveryValue(recovery: Recovery): Record<string, string | number> {
  const value: Record<string, string | number> = {
    position: recovery.position,
    generation: recovery.generation,
    side: recovery.side,
    status: recovery.status,
  };
  for (const field of ['sireId', 'damId', 'foalId', 'endYear', 'bloodFromPosition'] as const) {
    const item = recovery[field];
    if (item !== undefined) {
      value[field] = item;
    }
  }
  return value;
}

/**
 * 宣告斷血並開始補系（需求規格 7.6、LINE-19、LINE-20）：系統不代選，由使用者在重試、補血、
 * 補系三者中選了補系之後才走到這裡。同一局同時只能有一筆進行中的補系。
 */
export async function declareRecovery(
  context: ServiceContext,
  input: DeclareRecoveryInput,
): Promise<Recovery> {
  const game = await requireCurrentGame(context);
  const lines = await listLines(context.database, game.id);
  const line = lines.find((item) => item.position === input.position);
  const reason = input.reason.trim();
  const issues: string[] = [];
  if (line === undefined) {
    issues.push(`第 ${String(input.position)} 系尚未開啟`);
  }
  const { generation } = input;
  if (generation === undefined || !Number.isInteger(generation) || generation < 1) {
    issues.push('斷血的代數必須是 1 以上的整數');
  } else if (
    line !== undefined &&
    !line.establishedGenerations.some((item) => item.generation === generation)
  ) {
    issues.push(`第 ${String(input.position)} 系還沒有成立 ${String(generation)} 代`);
  }
  if (reason === '') {
    issues.push('請填寫斷血的原因');
  }
  if (issues.length > 0 || generation === undefined) {
    throw new ServiceError('invalidInput', issues.join('；'));
  }
  const now = context.now().toISOString();
  const id = context.newId();
  return trackWrite(context, () =>
    writeRecovery(context.database, {
      gameId: game.id,
      touch: gameTouch(context, now),
      build: ({ gameYear, recoveries }) => {
        const running = recoveries.find(isRecoveryInProgress);
        if (running !== undefined) {
          throw new ServiceError(
            'invalidInput',
            `第 ${String(running.position)} 系的補系還在進行中，完成或取消後才能宣告下一筆`,
          );
        }
        const recovery: Recovery = {
          id,
          position: input.position,
          generation,
          gameYear,
          side: input.side,
          reason,
          status: 'inProgress',
          ...(input.bloodFromPosition === undefined
            ? {}
            : { bloodFromPosition: input.bloodFromPosition }),
        };
        return {
          recovery,
          events: [
            userEvent(context, {
              subjectId: id,
              type: 'recoveryChanged',
              gameYear,
              occurredAt: now,
              after: recoveryValue(recovery),
            }),
          ],
        };
      },
    }),
  );
}

export interface RecoveryParentsInput {
  readonly recoveryId: string;
  /** 補入的零代市場種牡馬；不補公系時留空。 */
  readonly sireId?: string | undefined;
  /** 補入的零代市場母馬；不補母系時留空。 */
  readonly damId?: string | undefined;
}

/** 登記補入的市場親馬（需求規格 7.6）：補入親馬為零代，產駒承接下一代。 */
export async function setRecoveryParents(
  context: ServiceContext,
  input: RecoveryParentsInput,
): Promise<Recovery> {
  const game = await requireCurrentGame(context);
  const now = context.now().toISOString();
  return trackWrite(context, () =>
    writeRecovery(context.database, {
      gameId: game.id,
      touch: gameTouch(context, now),
      build: ({ gameYear, recoveries }) => {
        const stored = recoveries.find((item) => item.id === input.recoveryId);
        if (stored === undefined) {
          throw new ServiceError('invalidInput', '找不到這筆補系紀錄');
        }
        if (!isRecoveryInProgress(stored)) {
          throw new ServiceError('invalidInput', '這筆補系已經結束，不能再修改補入的親馬');
        }
        if (input.sireId === undefined && input.damId === undefined) {
          throw new ServiceError('invalidInput', '請至少補入一匹市場親馬');
        }
        const recovery: Recovery = {
          ...stored,
          ...(input.sireId === undefined ? {} : { sireId: input.sireId }),
          ...(input.damId === undefined ? {} : { damId: input.damId }),
        };
        return {
          recovery,
          events: [
            userEvent(context, {
              subjectId: stored.id,
              type: 'recoveryChanged',
              gameYear,
              occurredAt: now,
              before: recoveryValue(stored),
              after: recoveryValue(recovery),
            }),
          ],
        };
      },
    }),
  );
}

export interface FinishRecoveryInput {
  readonly recoveryId: string;
  /** 完成時連結重新加入的產駒；取消時留空。 */
  readonly foalId?: string | undefined;
  readonly cancelled?: boolean | undefined;
}

/**
 * 結束補系（需求規格 7.6）：完成時連結重新加入的產駒，取消時只記結束年。
 * 結束後任務的暫停解除（LINE-21）。
 */
export async function finishRecovery(
  context: ServiceContext,
  input: FinishRecoveryInput,
): Promise<Recovery> {
  const game = await requireCurrentGame(context);
  const now = context.now().toISOString();
  const cancelled = input.cancelled === true;
  return trackWrite(context, () =>
    writeRecovery(context.database, {
      gameId: game.id,
      touch: gameTouch(context, now),
      build: ({ gameYear, recoveries }) => {
        const stored = recoveries.find((item) => item.id === input.recoveryId);
        if (stored === undefined) {
          throw new ServiceError('invalidInput', '找不到這筆補系紀錄');
        }
        if (!isRecoveryInProgress(stored)) {
          throw new ServiceError('invalidInput', '這筆補系已經結束');
        }
        if (!cancelled && input.foalId === undefined) {
          throw new ServiceError('invalidInput', '完成補系要連結重新加入的產駒');
        }
        if (gameYear < stored.gameYear) {
          throw new ServiceError(
            'invalidInput',
            `目前遊戲年早於宣告斷血的 ${String(stored.gameYear)} 年，不能結束補系`,
          );
        }
        const recovery: Recovery = {
          ...stored,
          status: cancelled ? 'cancelled' : 'completed',
          endYear: gameYear,
          ...(input.foalId === undefined ? {} : { foalId: input.foalId }),
        };
        return {
          recovery,
          events: [
            userEvent(context, {
              subjectId: stored.id,
              type: 'recoveryChanged',
              gameYear,
              occurredAt: now,
              before: recoveryValue(stored),
              after: recoveryValue(recovery),
            }),
          ],
        };
      },
    }),
  );
}

export interface RecoveryView {
  readonly recovery: Recovery;
  /** 補系要產出的代數（需求規格 7.6）。 */
  readonly targetGeneration: number;
}

/** 目前進行中的補系（需求規格 7.6、LINE-21）；沒有時為 undefined。 */
export async function loadActiveRecovery(
  context: ServiceContext,
): Promise<RecoveryView | undefined> {
  const game = await requireCurrentGame(context);
  const recovery = (await listRecoveries(context.database, game.id)).find(isRecoveryInProgress);
  return recovery === undefined
    ? undefined
    : { recovery, targetGeneration: recoveryTargetGeneration(recovery) };
}

/** 一個系的補系歷程（需求規格 7.6）：原支線歷史保留，其餘七系不受影響。 */
export async function listLineRecoveries(
  context: ServiceContext,
  position: LinePosition,
): Promise<Recovery[]> {
  const game = await requireCurrentGame(context);
  const recoveries = await listRecoveries(context.database, game.id);
  return recoveries
    .filter((recovery) => recovery.position === position)
    .sort((a, b) => b.gameYear - a.gameYear || b.generation - a.generation);
}

export async function findRecovery(
  context: ServiceContext,
  recoveryId: string,
): Promise<Recovery | undefined> {
  const game = await requireCurrentGame(context);
  return getRecovery(context.database, game.id, recoveryId);
}
