import {
  DEFAULT_GAME_SETTINGS,
  checkGameName,
  checkGameYears,
  type Game,
  type GameInputIssue,
  type GameSettings,
} from '../domain/game.ts';
import { GAME_SUBJECT_ID, type HistoryEvent } from '../domain/history-event.ts';
import { listArchives } from '../storage/archives.ts';
import {
  clearAllData,
  countCheckpointsAfterYear,
  countGameRecords,
  deleteGame as deleteGameData,
  getCurrentGameId,
  getGame,
  insertGame,
  listGames,
  readGameSettings,
  setCurrentGameId,
  sumRecordCounts,
  updateCurrentYear,
  type GameTouch,
} from '../storage/games.ts';
import { readRecords, type StoredRecord } from '../storage/records.ts';
import { trackWrite, type ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';

const INPUT_MESSAGES: Readonly<Record<GameInputIssue, string>> = {
  nameBlank: '請輸入遊戲局名稱',
  yearInvalid: '年份必須是 1000～9999 的整數',
  currentBeforeStart: '目前遊戲年不可早於起始年',
};

export interface NewGameInput {
  readonly name: string;
  readonly startYear: number;
  /** 指定時只複製該局的系統對照表與顯示設定（需求規格 12.1）。 */
  readonly copySettingsFromGameId?: string | undefined;
}

export function checkNewGameInput(input: Pick<NewGameInput, 'name' | 'startYear'>): string[] {
  return [checkGameName(input.name), checkGameYears(input.startYear, input.startYear)]
    .filter((issue) => issue !== undefined)
    .map((issue) => INPUT_MESSAGES[issue]);
}

export async function listAllGames(context: ServiceContext): Promise<Game[]> {
  const games = await listGames(context.database);
  return games.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getCurrentGame(context: ServiceContext): Promise<Game | undefined> {
  const gameId = await getCurrentGameId(context.database);
  return gameId === undefined ? undefined : getGame(context.database, gameId);
}

export async function requireCurrentGame(context: ServiceContext): Promise<Game> {
  const game = await getCurrentGame(context);
  if (game === undefined) {
    throw new ServiceError('noCurrentGame', '尚未選擇遊戲局');
  }
  return game;
}

/**
 * 寫入遊戲局資料時一併更新的遊戲局欄位：更新時間與最後寫入的程式版本（需求規格 12.1）。
 * storage 在寫入交易內讀出遊戲局後合併，不以操作開始時讀到的舊紀錄覆蓋（設計決策 5.1 節）。
 */
export function gameTouch(context: ServiceContext, now: string): GameTouch {
  return { updatedAt: now, appVersion: context.appVersion };
}

async function requireGame(context: ServiceContext, gameId: string): Promise<Game> {
  const game = await getGame(context.database, gameId);
  if (game === undefined) {
    throw new ServiceError('gameNotFound', '找不到這個遊戲局');
  }
  return game;
}

export async function createGame(context: ServiceContext, input: NewGameInput): Promise<Game> {
  const issues = checkNewGameInput(input);
  if (issues.length > 0) {
    throw new ServiceError('invalidInput', issues.join('；'));
  }
  let settings: GameSettings = DEFAULT_GAME_SETTINGS;
  let systemMap: StoredRecord[] = [];
  if (input.copySettingsFromGameId !== undefined) {
    const source = await requireGame(context, input.copySettingsFromGameId);
    const sourceSettings = await readGameSettings(context.database, source.id);
    settings = { ...DEFAULT_GAME_SETTINGS, display: sourceSettings?.display ?? {} };
    systemMap = await readRecords(context.database, source.id, 'systemMap');
  }
  const now = context.now().toISOString();
  const game: Game = {
    id: context.newId(),
    name: input.name,
    startYear: input.startYear,
    currentYear: input.startYear,
    createdAt: now,
    updatedAt: now,
    appVersion: context.appVersion,
  };
  await trackWrite(context, () => insertGame(context.database, { game, settings, systemMap }));
  return game;
}

export async function switchGame(context: ServiceContext, gameId: string): Promise<void> {
  await requireGame(context, gameId);
  await trackWrite(context, () => setCurrentGameId(context.database, gameId));
}

export interface YearChangePreview {
  readonly gameName: string;
  readonly fromYear: number;
  readonly toYear: number;
  /** 遊戲年晚於新年份的檢查點數；改回較早年份時不會移除它們，回到過去的資料要用回溯。 */
  readonly checkpointsAfterTarget: number;
}

function checkYearChange(game: Game, toYear: number): void {
  const issue = checkGameYears(game.startYear, toYear);
  if (issue !== undefined) {
    throw new ServiceError('invalidInput', INPUT_MESSAGES[issue]);
  }
  if (toYear === game.currentYear) {
    throw new ServiceError('invalidInput', `目前遊戲年已經是 ${String(toYear)} 年`);
  }
}

export async function previewYearChange(
  context: ServiceContext,
  toYear: number,
): Promise<YearChangePreview> {
  const game = await requireCurrentGame(context);
  checkYearChange(game, toYear);
  return {
    gameName: game.name,
    fromYear: game.currentYear,
    toYear,
    checkpointsAfterTarget: await countCheckpointsAfterYear(context.database, game.id, toYear),
  };
}

/**
 * 目前遊戲年只由使用者更新（需求規格 12.1、DATA-11）。操作開始時先檢查一次以便提早回報；
 * 寫入交易內再以讀出的遊戲局檢查並產生事件前值，不以操作開始時的舊紀錄判斷。
 */
export async function changeCurrentYear(context: ServiceContext, toYear: number): Promise<Game> {
  const game = await requireCurrentGame(context);
  checkYearChange(game, toYear);
  const now = context.now().toISOString();
  return trackWrite(context, () =>
    updateCurrentYear(context.database, {
      gameId: game.id,
      touch: gameTouch(context, now),
      apply: (stored) => {
        checkYearChange(stored, toYear);
        const event: HistoryEvent = {
          id: context.newId(),
          subjectId: GAME_SUBJECT_ID,
          type: 'gameYearChanged',
          gameYear: toYear,
          before: { currentYear: stored.currentYear },
          after: { currentYear: toYear },
          source: 'user',
          occurredAt: now,
        };
        return { currentYear: toYear, event };
      },
    }),
  );
}

export interface GameDeletionPreview {
  readonly game: Game;
  readonly recordCount: number;
  readonly checkpointCount: number;
}

export async function previewGameDeletion(
  context: ServiceContext,
  gameId: string,
): Promise<GameDeletionPreview> {
  const game = await requireGame(context, gameId);
  const counts = await countGameRecords(context.database, gameId);
  return { game, recordCount: sumRecordCounts(counts), checkpointCount: counts.checkpoints };
}

export async function deleteGame(
  context: ServiceContext,
  gameId: string,
  typedName: string,
): Promise<void> {
  const game = await requireGame(context, gameId);
  if (typedName !== game.name) {
    throw new ServiceError('confirmationMismatch', '輸入的局名不符，沒有刪除任何資料');
  }
  const nextCurrentGameId = await nextCurrentGameAfterRemoving(context, gameId);
  await trackWrite(context, () => deleteGameData(context.database, gameId, nextCurrentGameId));
}

/**
 * 移除一局（刪除或封存）後的目前遊戲局：移除的是目前遊戲局時改為最近更新的另一局，
 * 沒有其他局時為 undefined；否則不變。
 */
export async function nextCurrentGameAfterRemoving(
  context: ServiceContext,
  gameId: string,
): Promise<string | undefined> {
  const [currentGameId, games] = await Promise.all([
    getCurrentGameId(context.database),
    listGames(context.database),
  ]);
  const others = games
    .filter((item) => item.id !== gameId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return currentGameId === gameId ? others[0]?.id : currentGameId;
}

export interface DeleteAllPreview {
  readonly gameCount: number;
  readonly recordCount: number;
  readonly checkpointCount: number;
  /** 封存索引也一併清除；封存檔本身不在瀏覽器內，不受影響。 */
  readonly archiveCount: number;
}

export async function previewDeleteAll(context: ServiceContext): Promise<DeleteAllPreview> {
  const [games, archives] = await Promise.all([
    listGames(context.database),
    listArchives(context.database),
  ]);
  const counts = await Promise.all(
    games.map((game) => countGameRecords(context.database, game.id)),
  );
  return {
    gameCount: games.length,
    recordCount: counts.reduce((total, item) => total + sumRecordCounts(item), 0),
    checkpointCount: counts.reduce((total, item) => total + item.checkpoints, 0),
    archiveCount: archives.length,
  };
}

/** 「刪除全部存檔」：要求輸入目前遊戲局名稱；第二次確認由介面負責（需求規格 12.1）。 */
export async function deleteAllData(context: ServiceContext, typedName: string): Promise<void> {
  const current = await requireCurrentGame(context);
  if (typedName !== current.name) {
    throw new ServiceError('confirmationMismatch', '輸入的局名不符，沒有刪除任何資料');
  }
  await trackWrite(context, () => clearAllData(context.database));
}
