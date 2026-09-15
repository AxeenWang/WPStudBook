import { sortCheckpointsByCreation, type Checkpoint } from '../domain/checkpoint.ts';
import type { Game } from '../domain/game.ts';
import { listCheckpoints } from '../storage/checkpoints.ts';
import { countGameRecords, sumRecordCounts } from '../storage/games.ts';
import type { PersistenceState, ServiceContext, WriteStatus } from './context.ts';
import { getCurrentGame, listAllGames } from './games.ts';

export interface AppStatus {
  readonly currentGame: Game | undefined;
  readonly games: readonly Game[];
  readonly recordCount: number;
  readonly lastCheckpoint: Checkpoint | undefined;
  readonly write: WriteStatus;
  readonly persistence: PersistenceState;
}

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
