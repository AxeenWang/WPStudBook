import { sortCheckpointsByCreation, type Checkpoint } from '../domain/checkpoint.ts';
import type { Game } from '../domain/game.ts';
import { listCheckpoints } from '../storage/checkpoints.ts';
import { countGameRecords, sumRecordCounts } from '../storage/games.ts';
import type { PersistenceState, ServiceContext, WriteStatus } from './context.ts';
import { getCurrentGame, listAllGames } from './games.ts';

/** 供 UI 首頁一次性讀取的應用程式狀態快照 */
export interface AppStatus {
  readonly currentGame: Game | undefined;
  readonly games: readonly Game[];
  readonly recordCount: number;
  readonly lastCheckpoint: Checkpoint | undefined;
  readonly write: WriteStatus;
  readonly persistence: PersistenceState;
}

/** 平行載入所有遊戲清單與當前遊戲，無當前遊戲時提前回傳空狀態 */
export async function loadAppStatus(context: ServiceContext): Promise<AppStatus> {
  const [games, currentGame] = await Promise.all([listAllGames(context), getCurrentGame(context)]);
  if (currentGame === undefined) {
    return {
      currentGame,
      games,
      recordCount: 0,
      lastCheckpoint: undefined,
      write: context.status.write,
      persistence: context.status.persistence,
    };
  }
  /** 平行取得各資料表筆數與存檔點，避免序列查詢拖慢載入 */
  const [counts, checkpoints] = await Promise.all([
    countGameRecords(context.database, currentGame.id),
    listCheckpoints(context.database, currentGame.id),
  ]);
  return {
    currentGame,
    games,
    recordCount: sumRecordCounts(counts),
    lastCheckpoint: sortCheckpointsByCreation(checkpoints).at(-1),
    write: context.status.write,
    persistence: context.status.persistence,
  };
}
