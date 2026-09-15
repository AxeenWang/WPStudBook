import type { Game } from '../domain/game.ts';
import { countGameRecords, sumRecordCounts } from '../storage/games.ts';
import type { PersistenceState, ServiceContext, WriteStatus } from './context.ts';
import { getCurrentGame, listAllGames } from './games.ts';

export interface AppStatus {
  readonly currentGame: Game | undefined;
  readonly games: readonly Game[];
  readonly recordCount: number;
  readonly write: WriteStatus;
  readonly persistence: PersistenceState;
}

export async function loadAppStatus(context: ServiceContext): Promise<AppStatus> {
  const [games, currentGame] = await Promise.all([listAllGames(context), getCurrentGame(context)]);
  const recordCount =
    currentGame === undefined
      ? 0
      : sumRecordCounts(await countGameRecords(context.database, currentGame.id));
  return {
    currentGame,
    games,
    recordCount,
    write: context.status.write,
    persistence: context.status.persistence,
  };
}
