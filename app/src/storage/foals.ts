import type { Breeding } from '../domain/breeding.ts';
import type { Foal } from '../domain/foal.ts';
import type { Game } from '../domain/game.ts';
import type { HistoryEvent } from '../domain/history-event.ts';
import type { Horse } from '../domain/horse.ts';
import type { Mare } from '../domain/mare.ts';
import type { StallionDuty } from '../domain/stallion-duty.ts';
import { toBreeding } from './breedings.ts';
import type { AppDatabase } from './database.ts';
import { readGameForWrite, type GameTouch } from './games.ts';
import { toHorse, withHorseNameKeys } from './horses.ts';
import { toMare } from './mares.ts';
import {
  completeTransaction,
  gameKeyRange,
  isPlainRecord,
  withGameId,
  withoutGameId,
  type ReadableStore,
} from './records.ts';

export function toFoal(value: unknown): Foal | undefined {
  // 本機資料由本程式寫入；備份匯入的產駒由 validateCollections 驗證。
  return isPlainRecord(value) ? (withoutGameId(value) as unknown as Foal) : undefined;
}

export async function listFoals(database: AppDatabase, gameId: string): Promise<Foal[]> {
  const values: unknown[] = await database.getAll('foals', gameKeyRange(gameId));
  return values.map(toFoal).filter((foal) => foal !== undefined);
}

export async function getFoal(
  database: AppDatabase,
  gameId: string,
  foalId: string,
): Promise<Foal | undefined> {
  const value: unknown = await database.get('foals', [gameId, foalId]);
  return toFoal(value);
}

/** 以單一唯讀交易讀出多筆產駒；找不到的 id 不列入。 */
export async function getFoalsByIds(
  database: AppDatabase,
  gameId: string,
  foalIds: readonly string[],
): Promise<Map<string, Foal>> {
  const transaction = database.transaction('foals', 'readonly');
  const requests: Promise<unknown>[] = foalIds.map((id) => transaction.store.get([gameId, id]));
  const [values] = await Promise.all([Promise.all(requests), transaction.done]);
  return new Map(
    values
      .map(toFoal)
      .filter((foal) => foal !== undefined)
      .map((foal) => [foal.id, foal]),
  );
}

/** 一匹母馬的全部產駒（出生年由小到大）。 */
export async function listFoalsForDam(
  database: AppDatabase,
  gameId: string,
  damId: string,
): Promise<Foal[]> {
  const values: unknown[] = await database.getAllFromIndex(
    'foals',
    'damId+birthYear',
    IDBKeyRange.bound(
      [gameId, damId, Number.NEGATIVE_INFINITY],
      [gameId, damId, Number.POSITIVE_INFINITY],
    ),
  );
  return values.map(toFoal).filter((foal) => foal !== undefined);
}

const BIRTH_STORES = ['mares', 'horses', 'foals', 'breedings', 'stallionDuties'] as const;

type ObjectStoreOf = (name: (typeof BIRTH_STORES)[number]) => ReadableStore;

/** 種牡馬的系與代數來源：任期與他本身的產駒紀錄。 */
export interface SireRecords {
  readonly horse: Horse | undefined;
  readonly duties: readonly StallionDuty[];
  readonly foal: Foal | undefined;
}

export async function readSireRecords(
  objectStore: (name: 'horses' | 'stallionDuties' | 'foals') => ReadableStore,
  gameId: string,
  sireId: string,
): Promise<SireRecords> {
  const [horse, duties, foal] = await Promise.all([
    objectStore('horses').get([gameId, sireId]),
    objectStore('stallionDuties').index('horseId').getAll([gameId, sireId]),
    objectStore('foals').get([gameId, sireId]),
  ]);
  return {
    horse: toHorse(horse),
    // 本機資料由本程式寫入；備份匯入的任期由 validateCollections 驗證。
    duties: duties
      .filter(isPlainRecord)
      .map((duty) => withoutGameId(duty) as unknown as StallionDuty),
    foal: toFoal(foal),
  };
}

/** 登記產駒時需要核對的資料（需求規格 9.1、9.3）。 */
export interface FoalBirthState {
  readonly dam: Mare | undefined;
  readonly damHorse: Horse | undefined;
  /** 同一母馬同一出生年已有的產駒與其馬匹。 */
  readonly existingFoal: Foal | undefined;
  readonly existingFoalHorse: Horse | undefined;
  /** 出生年前一年的繁殖紀錄。 */
  readonly breeding: Breeding | undefined;
  /** 繁殖紀錄有內部種牡馬時才有。 */
  readonly sire: SireRecords | undefined;
}

async function readBirthState(
  objectStore: ObjectStoreOf,
  gameId: string,
  damId: string,
  birthYear: number,
): Promise<FoalBirthState> {
  const [dam, damHorse, existing, breedingValue] = await Promise.all([
    objectStore('mares').get([gameId, damId]),
    objectStore('horses').get([gameId, damId]),
    objectStore('foals').index('damId+birthYear').get([gameId, damId, birthYear]),
    objectStore('breedings')
      .index('mareId+gameYear')
      .get([gameId, damId, birthYear - 1]),
  ]);
  const existingFoal = toFoal(existing);
  const breeding = toBreeding(breedingValue);
  const stallionId = breeding?.stallionId;
  const [existingFoalHorse, sire] = await Promise.all([
    existingFoal === undefined
      ? undefined
      : objectStore('horses').get([gameId, existingFoal.id]).then(toHorse),
    stallionId === undefined ? undefined : readSireRecords(objectStore, gameId, stallionId),
  ]);
  return {
    dam: toMare(dam),
    damHorse: toHorse(damHorse),
    existingFoal,
    existingFoalHorse,
    breeding,
    sire,
  };
}

/** 以唯讀交易讀出登記產駒前要核對的資料。 */
export async function loadFoalBirthState(
  database: AppDatabase,
  gameId: string,
  damId: string,
  birthYear: number,
): Promise<FoalBirthState> {
  const transaction = database.transaction(BIRTH_STORES, 'readonly');
  return completeTransaction(transaction, () =>
    readBirthState((name) => transaction.objectStore(name), gameId, damId, birthYear),
  );
}

export interface NewFoalRecords {
  readonly horse: Horse;
  readonly foal: Foal;
  /** 連結產駒後的繁殖紀錄；沒有相符受胎紀錄時為 undefined。 */
  readonly breeding: Breeding | undefined;
  readonly events: readonly HistoryEvent[];
}

export interface FoalInsert {
  readonly gameId: string;
  readonly damId: string;
  readonly birthYear: number;
  readonly touch: GameTouch;
  /** 以寫入交易內讀出的資料產生紀錄與事件；只能做同步運算，丟出錯誤時整筆交易中止。 */
  readonly build: (game: Game, state: FoalBirthState) => NewFoalRecords;
}

/** 登記產駒：單一交易讀出母馬、既有產駒與前一年繁殖紀錄，寫入馬匹、產駒、繁殖紀錄連結與事件。 */
export async function insertFoal(
  database: AppDatabase,
  insert: FoalInsert,
): Promise<NewFoalRecords> {
  const { gameId } = insert;
  const transaction = database.transaction(['games', ...BIRTH_STORES, 'events'], 'readwrite');
  const games = transaction.objectStore('games');
  return completeTransaction(transaction, async () => {
    const [game, state] = await Promise.all([
      readGameForWrite(games, gameId),
      readBirthState(
        (name) => transaction.objectStore(name),
        gameId,
        insert.damId,
        insert.birthYear,
      ),
    ]);
    const records = insert.build(game, state);
    await Promise.all([
      games.put({ ...game, ...insert.touch }),
      transaction.objectStore('horses').add(withHorseNameKeys(gameId, records.horse)),
      transaction.objectStore('foals').add(withGameId(gameId, records.foal)),
      ...(records.breeding === undefined
        ? []
        : [transaction.objectStore('breedings').put(withGameId(gameId, records.breeding))]),
      ...records.events.map((event) =>
        transaction.objectStore('events').add(withGameId(gameId, event)),
      ),
    ]);
    return records;
  });
}

export interface FoalWriteState {
  readonly game: Game;
  readonly foal: Foal;
  readonly horse: Horse;
  /** 已轉入為繁殖牝馬時的紀錄。 */
  readonly mare: Mare | undefined;
}

/** 只寫回有變更的紀錄（需求規格 12.2、DATA-01）。 */
export interface FoalChange {
  readonly foal?: Foal | undefined;
  readonly horse?: Horse | undefined;
  readonly events: readonly HistoryEvent[];
}

export interface FoalModification {
  readonly gameId: string;
  readonly foalId: string;
  readonly touch: GameTouch;
  /** 只能做同步運算；丟出錯誤時整筆交易中止。 */
  readonly apply: (current: FoalWriteState) => FoalChange;
}

/** 修改一匹產駒：單一交易讀出遊戲局、產駒與馬匹，只寫回有變更的紀錄、事件與遊戲局更新時間。 */
export async function modifyFoal(
  database: AppDatabase,
  modification: FoalModification,
): Promise<FoalWriteState> {
  const { gameId, foalId } = modification;
  const transaction = database.transaction(
    ['games', 'foals', 'horses', 'mares', 'events'],
    'readwrite',
  );
  const games = transaction.objectStore('games');
  const foals = transaction.objectStore('foals');
  const horses = transaction.objectStore('horses');
  return completeTransaction(transaction, async () => {
    const foalRequest: Promise<unknown> = foals.get([gameId, foalId]);
    const horseRequest: Promise<unknown> = horses.get([gameId, foalId]);
    const mareRequest: Promise<unknown> = transaction.objectStore('mares').get([gameId, foalId]);
    const [game, storedFoal, storedHorse, storedMare] = await Promise.all([
      readGameForWrite(games, gameId),
      foalRequest,
      horseRequest,
      mareRequest,
    ]);
    const mare = toMare(storedMare);
    const foal = toFoal(storedFoal);
    const horse = toHorse(storedHorse);
    if (foal === undefined || horse === undefined) {
      throw new Error(`找不到產駒 ${foalId}`);
    }
    const change = modification.apply({ game, foal, horse, mare });
    await Promise.all([
      games.put({ ...game, ...modification.touch }),
      ...(change.foal === undefined ? [] : [foals.put(withGameId(gameId, change.foal))]),
      ...(change.horse === undefined ? [] : [horses.put(withHorseNameKeys(gameId, change.horse))]),
      ...change.events.map((event) =>
        transaction.objectStore('events').add(withGameId(gameId, event)),
      ),
    ]);
    return { game, foal: change.foal ?? foal, horse: change.horse ?? horse, mare };
  });
}
