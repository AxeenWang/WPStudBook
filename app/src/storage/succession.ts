import type { Foal } from '../domain/foal.ts';
import type { Game } from '../domain/game.ts';
import type { HistoryEvent } from '../domain/history-event.ts';
import type { Horse } from '../domain/horse.ts';
import type { Line } from '../domain/line.ts';
import type { Mare } from '../domain/mare.ts';
import type { AppDatabase } from './database.ts';
import { readSireRecords, toFoal, type SireRecords } from './foals.ts';
import { readGameForWrite, type GameTouch } from './games.ts';
import { toHorse } from './horses.ts';
import { readLineAt } from './lines.ts';
import { toMare } from './mares.ts';
import { completeTransaction, withGameId, type ReadableStore } from './records.ts';

const SUCCESSION_STORES = ['mares', 'horses', 'foals', 'lines', 'stallionDuties'] as const;

type SuccessionStoreOf = (name: (typeof SUCCESSION_STORES)[number]) => ReadableStore;

/** 已轉入的姊妹：同父同母（兩者都是內部 id）的其他馬匹中有繁殖牝馬紀錄者（需求規格 8.9）。 */
export interface SisterRecord {
  readonly horse: Horse;
  readonly mare: Mare;
}

async function readSisters(
  objectStore: SuccessionStoreOf,
  gameId: string,
  horse: Horse,
): Promise<SisterRecord[]> {
  const { sireId, damId } = horse;
  if (sireId === undefined || damId === undefined) {
    return [];
  }
  const values = await objectStore('horses').index('sireId').getAll([gameId, sireId]);
  const siblings = values.flatMap((value) => {
    const item = toHorse(value);
    return item !== undefined && item.id !== horse.id && item.damId === damId ? [item] : [];
  });
  const mares = await Promise.all(
    siblings.map((sibling) => objectStore('mares').get([gameId, sibling.id])),
  );
  return siblings.flatMap((sibling, index) => {
    const mare = toMare(mares[index]);
    return mare === undefined ? [] : [{ horse: sibling, mare }];
  });
}

/** 從產駒轉入繁殖牝馬前要核對的資料（需求規格 8.4、9.6）。 */
export interface OwnMareState {
  readonly foal: Foal | undefined;
  readonly horse: Horse | undefined;
  /** 已轉入時的繁殖牝馬紀錄。 */
  readonly existingMare: Mare | undefined;
  readonly dam: Mare | undefined;
  readonly sire: SireRecords | undefined;
  readonly sisters: readonly SisterRecord[];
  /** 產駒所屬系位置；自由配種產駒沒有。 */
  readonly line: Line | undefined;
}

async function readOwnMareState(
  objectStore: SuccessionStoreOf,
  gameId: string,
  foalId: string,
): Promise<OwnMareState> {
  const [foalValue, horseValue, existing] = await Promise.all([
    objectStore('foals').get([gameId, foalId]),
    objectStore('horses').get([gameId, foalId]),
    objectStore('mares').get([gameId, foalId]),
  ]);
  const foal = toFoal(foalValue);
  const horse = toHorse(horseValue);
  const position = foal?.lineage?.position;
  const [dam, sire, sisters, line] = await Promise.all([
    horse?.damId === undefined ? undefined : objectStore('mares').get([gameId, horse.damId]),
    horse?.sireId === undefined ? undefined : readSireRecords(objectStore, gameId, horse.sireId),
    horse === undefined ? [] : readSisters(objectStore, gameId, horse),
    position === undefined ? undefined : readLineAt(objectStore, gameId, position),
  ]);
  return {
    foal,
    horse,
    existingMare: toMare(existing),
    dam: toMare(dam),
    sire,
    sisters,
    line,
  };
}

export async function loadOwnMareState(
  database: AppDatabase,
  gameId: string,
  foalId: string,
): Promise<OwnMareState> {
  const transaction = database.transaction(SUCCESSION_STORES, 'readonly');
  return completeTransaction(transaction, () =>
    readOwnMareState((name) => transaction.objectStore(name), gameId, foalId),
  );
}

export interface NewOwnMareRecords {
  readonly mare: Mare;
  /** 牧場處置改為保留時才有。 */
  readonly foal: Foal | undefined;
  /** 世代成立時才有。 */
  readonly line: Line | undefined;
  readonly events: readonly HistoryEvent[];
}

export interface OwnMareInsert {
  readonly gameId: string;
  readonly foalId: string;
  readonly touch: GameTouch;
  /** 以寫入交易內讀出的資料產生紀錄與事件；只能做同步運算，丟出錯誤時整筆交易中止。 */
  readonly build: (game: Game, state: OwnMareState) => NewOwnMareRecords;
}

/** 自家母駒轉入：單一交易寫入繁殖牝馬、產駒處置、世代成立、事件與遊戲局更新時間。 */
export async function insertOwnMare(
  database: AppDatabase,
  insert: OwnMareInsert,
): Promise<NewOwnMareRecords> {
  const { gameId } = insert;
  const transaction = database.transaction(['games', ...SUCCESSION_STORES, 'events'], 'readwrite');
  const games = transaction.objectStore('games');
  return completeTransaction(transaction, async () => {
    const [game, state] = await Promise.all([
      readGameForWrite(games, gameId),
      readOwnMareState((name) => transaction.objectStore(name), gameId, insert.foalId),
    ]);
    const records = insert.build(game, state);
    await Promise.all([
      games.put({ ...game, ...insert.touch }),
      transaction.objectStore('mares').add(withGameId(gameId, records.mare)),
      ...(records.foal === undefined
        ? []
        : [transaction.objectStore('foals').put(withGameId(gameId, records.foal))]),
      ...(records.line === undefined
        ? []
        : [transaction.objectStore('lines').put(withGameId(gameId, records.line))]),
      ...records.events.map((event) =>
        transaction.objectStore('events').add(withGameId(gameId, event)),
      ),
    ]);
    return records;
  });
}

export interface SuccessionState {
  readonly horse: Horse | undefined;
  readonly mare: Mare | undefined;
  readonly sisters: readonly SisterRecord[];
}

async function readSuccessionState(
  objectStore: SuccessionStoreOf,
  gameId: string,
  mareId: string,
): Promise<SuccessionState> {
  const [horseValue, mareValue] = await Promise.all([
    objectStore('horses').get([gameId, mareId]),
    objectStore('mares').get([gameId, mareId]),
  ]);
  const horse = toHorse(horseValue);
  return {
    horse,
    mare: toMare(mareValue),
    sisters: horse === undefined ? [] : await readSisters(objectStore, gameId, horse),
  };
}

/** 以唯讀交易讀出一匹母馬與她已轉入的姊妹。 */
export async function loadSuccessionState(
  database: AppDatabase,
  gameId: string,
  mareId: string,
): Promise<SuccessionState> {
  const transaction = database.transaction(SUCCESSION_STORES, 'readonly');
  return completeTransaction(transaction, () =>
    readSuccessionState((name) => transaction.objectStore(name), gameId, mareId),
  );
}

export interface SuccessionChange {
  readonly mares: readonly Mare[];
  readonly events: readonly HistoryEvent[];
}

export interface SuccessionModification {
  readonly gameId: string;
  readonly mareId: string;
  readonly touch: GameTouch;
  /** 只能做同步運算；丟出錯誤時整筆交易中止。 */
  readonly apply: (game: Game, state: SuccessionState) => SuccessionChange;
}

/** 姊妹接替狀態變更：單一交易讀出母馬與姊妹，寫回有變更的母馬、事件與遊戲局更新時間。 */
export async function modifySuccession(
  database: AppDatabase,
  modification: SuccessionModification,
): Promise<SuccessionChange> {
  const { gameId } = modification;
  const transaction = database.transaction(['games', ...SUCCESSION_STORES, 'events'], 'readwrite');
  const games = transaction.objectStore('games');
  return completeTransaction(transaction, async () => {
    const [game, state] = await Promise.all([
      readGameForWrite(games, gameId),
      readSuccessionState((name) => transaction.objectStore(name), gameId, modification.mareId),
    ]);
    const change = modification.apply(game, state);
    await Promise.all([
      games.put({ ...game, ...modification.touch }),
      ...change.mares.map((mare) => transaction.objectStore('mares').put(withGameId(gameId, mare))),
      ...change.events.map((event) =>
        transaction.objectStore('events').add(withGameId(gameId, event)),
      ),
    ]);
    return change;
  });
}
