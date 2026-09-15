import type { Breeding } from '../domain/breeding.ts';
import type { Foal } from '../domain/foal.ts';
import type { Game } from '../domain/game.ts';
import type { HistoryEvent } from '../domain/history-event.ts';
import type { Horse } from '../domain/horse.ts';
import type { Line } from '../domain/line.ts';
import type { Mare } from '../domain/mare.ts';
import type { PlannedDuty, StallionDuty } from '../domain/stallion-duty.ts';
import { toBreeding } from './breedings.ts';
import type { AppDatabase } from './database.ts';
import { readSireRecords, toFoal, type SireRecords } from './foals.ts';
import { readGameForWrite, type GameTouch } from './games.ts';
import { toHorse, withHorseNameKeys } from './horses.ts';
import { readLineAt } from './lines.ts';
import { toMare } from './mares.ts';
import {
  completeTransaction,
  gameKeyRange,
  isPlainRecord,
  withGameId,
  withoutGameId,
  type ReadableStore,
} from './records.ts';

export function toStallionDuty(value: unknown): StallionDuty | undefined {
  // 本機資料由本程式寫入；備份匯入的任期由 validateCollections 驗證。
  return isPlainRecord(value) ? (withoutGameId(value) as unknown as StallionDuty) : undefined;
}

export async function listStallionDuties(
  database: AppDatabase,
  gameId: string,
): Promise<StallionDuty[]> {
  const values: unknown[] = await database.getAll('stallionDuties', gameKeyRange(gameId));
  return values.map(toStallionDuty).filter((duty) => duty !== undefined);
}

export async function getStallionDuty(
  database: AppDatabase,
  gameId: string,
  dutyId: string,
): Promise<StallionDuty | undefined> {
  const value: unknown = await database.get('stallionDuties', [gameId, dutyId]);
  return toStallionDuty(value);
}

const STALLION_STORES = [
  'horses',
  'foals',
  'mares',
  'lines',
  'stallionDuties',
  'breedings',
] as const;

type StallionStoreOf = (name: (typeof STALLION_STORES)[number]) => ReadableStore;

/** 要成為種牡馬或預定後繼的馬，與核對系與代數所需的父母紀錄（需求規格 9.6）。 */
export interface CandidateRecords {
  readonly horse: Horse | undefined;
  readonly foal: Foal | undefined;
  /** 母馬的繁殖牝馬紀錄。 */
  readonly dam: Mare | undefined;
  readonly sire: SireRecords | undefined;
}

/** 尚未誕生的預定後繼所指的配種，與核對系與代數所需的父母紀錄。 */
export interface PlannedBirthRecords {
  readonly breeding: Breeding | undefined;
  readonly dam: Mare | undefined;
  readonly sire: SireRecords | undefined;
  /** 產駒已出生時的紀錄。 */
  readonly born: CandidateRecords | undefined;
}

export interface StallionState {
  readonly line: Line | undefined;
  /** 這個系位置的全部任期（現任與預定後繼，含已結束者）。 */
  readonly duties: readonly StallionDuty[];
  readonly candidate: CandidateRecords | undefined;
  /** 指定的配種，或進行中的預定後繼所指的配種。 */
  readonly birth: PlannedBirthRecords | undefined;
}

export interface StallionRequest {
  readonly position: number;
  readonly horseId?: string | undefined;
  readonly breedingId?: string | undefined;
}

async function readCandidate(
  objectStore: StallionStoreOf,
  gameId: string,
  horseId: string,
): Promise<CandidateRecords> {
  const [horseValue, foalValue] = await Promise.all([
    objectStore('horses').get([gameId, horseId]),
    objectStore('foals').get([gameId, horseId]),
  ]);
  const horse = toHorse(horseValue);
  const [dam, sire] = await Promise.all([
    horse?.damId === undefined ? undefined : objectStore('mares').get([gameId, horse.damId]),
    horse?.sireId === undefined ? undefined : readSireRecords(objectStore, gameId, horse.sireId),
  ]);
  return { horse, foal: toFoal(foalValue), dam: toMare(dam), sire };
}

async function readPlannedBirth(
  objectStore: StallionStoreOf,
  gameId: string,
  breedingId: string,
): Promise<PlannedBirthRecords> {
  const breeding = toBreeding(await objectStore('breedings').get([gameId, breedingId]));
  const [dam, sire, born] = await Promise.all([
    breeding === undefined ? undefined : objectStore('mares').get([gameId, breeding.mareId]),
    breeding?.stallionId === undefined
      ? undefined
      : readSireRecords(objectStore, gameId, breeding.stallionId),
    breeding?.foalId === undefined
      ? undefined
      : readCandidate(objectStore, gameId, breeding.foalId),
  ]);
  return { breeding, dam: toMare(dam), sire, born };
}

async function readStallionState(
  objectStore: StallionStoreOf,
  gameId: string,
  request: StallionRequest,
): Promise<StallionState> {
  const [line, dutyValues, candidate] = await Promise.all([
    readLineAt(objectStore, gameId, request.position),
    objectStore('stallionDuties')
      .index('position+generation')
      .getAll(
        IDBKeyRange.bound(
          [gameId, request.position, Number.NEGATIVE_INFINITY],
          [gameId, request.position, Number.POSITIVE_INFINITY],
        ),
      ),
    request.horseId === undefined ? undefined : readCandidate(objectStore, gameId, request.horseId),
  ]);
  const duties = dutyValues.map(toStallionDuty).filter((duty) => duty !== undefined);
  const plannedBreedingId = duties.find(
    (duty): duty is PlannedDuty => duty.role === 'planned' && duty.endYear === undefined,
  )?.breedingId;
  const breedingId = request.breedingId ?? plannedBreedingId;
  const birth =
    breedingId === undefined ? undefined : await readPlannedBirth(objectStore, gameId, breedingId);
  return { line, duties, candidate, birth };
}

/** 以唯讀交易讀出一個系位置的任期與要核對的馬匹、配種。 */
export async function loadStallionState(
  database: AppDatabase,
  gameId: string,
  request: StallionRequest,
): Promise<StallionState> {
  const transaction = database.transaction(STALLION_STORES, 'readonly');
  return completeTransaction(transaction, () =>
    readStallionState((name) => transaction.objectStore(name), gameId, request),
  );
}

/** 只寫回有變更的紀錄。 */
export interface StallionChange {
  readonly duties: readonly StallionDuty[];
  readonly horses: readonly Horse[];
  readonly events: readonly HistoryEvent[];
}

export interface StallionModification {
  readonly gameId: string;
  readonly request: StallionRequest;
  readonly touch: GameTouch;
  /** 以寫入交易內讀出的資料產生變更；只能做同步運算，丟出錯誤時整筆交易中止。 */
  readonly apply: (game: Game, state: StallionState) => StallionChange;
}

/** 種牡馬任期變更：單一交易讀出系位置、任期與相關馬匹，寫回任期、馬匹、事件與遊戲局更新時間。 */
export async function modifyStallionDuties(
  database: AppDatabase,
  modification: StallionModification,
): Promise<StallionChange> {
  const { gameId } = modification;
  const transaction = database.transaction(['games', ...STALLION_STORES, 'events'], 'readwrite');
  const games = transaction.objectStore('games');
  return completeTransaction(transaction, async () => {
    const [game, state] = await Promise.all([
      readGameForWrite(games, gameId),
      readStallionState((name) => transaction.objectStore(name), gameId, modification.request),
    ]);
    const change = modification.apply(game, state);
    await Promise.all([
      games.put({ ...game, ...modification.touch }),
      ...change.duties.map((duty) =>
        transaction.objectStore('stallionDuties').put(withGameId(gameId, duty)),
      ),
      ...change.horses.map((horse) =>
        transaction.objectStore('horses').put(withHorseNameKeys(gameId, horse)),
      ),
      ...change.events.map((event) =>
        transaction.objectStore('events').add(withGameId(gameId, event)),
      ),
    ]);
    return change;
  });
}
