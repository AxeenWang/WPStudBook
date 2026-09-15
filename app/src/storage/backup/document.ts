import type { JsonValue } from '../../domain/json.ts';
import { BACKUP_COLLECTIONS, type BackupCollection } from '../schema.ts';
import { canonicalJson, compareCodeUnits } from './canonical-json.ts';
import { sha256Hex } from './digest.ts';
import { canCompress, gzip } from './gzip.ts';

export const BACKUP_FORMAT = 'WPStudBook-backup';

export type BackupRecord = Readonly<Record<string, JsonValue>>;

export type BackupCollections = Readonly<Record<BackupCollection, readonly BackupRecord[]>>;

export type BackupCounts = Readonly<Record<BackupCollection, number>>;

export interface BackupGameSummary {
  readonly name: string;
  readonly startYear: number;
  readonly currentYear: number;
}

export interface BackupDocument {
  readonly format: typeof BACKUP_FORMAT;
  readonly schemaVersion: number;
  readonly appVersion: string;
  readonly exportedAt: string;
  readonly game: BackupGameSummary;
  readonly counts: BackupCounts;
  readonly sha256: string;
  readonly collections: BackupCollections;
}

export function emptyCollections(): BackupCollections {
  const entries = BACKUP_COLLECTIONS.map((name): [BackupCollection, readonly BackupRecord[]] => [
    name,
    [],
  ]);
  return Object.fromEntries(entries) as BackupCollections;
}

export function countCollections(collections: BackupCollections): BackupCounts {
  return Object.fromEntries(
    BACKUP_COLLECTIONS.map((name) => [name, collections[name].length]),
  ) as BackupCounts;
}

function recordId(record: unknown): string {
  const id: unknown =
    typeof record === 'object' && record !== null ? Reflect.get(record, 'id') : undefined;
  return typeof id === 'string' ? id : '';
}

export function sortRecordsById(records: readonly unknown[]): unknown[] {
  return [...records].sort((a, b) => compareCodeUnits(recordId(a), recordId(b)));
}

/** 設計決策 5.4 節：以 { collections, game } 的標準化 JSON 計算，各資料表的紀錄依 id 排序。 */
export async function computeBackupHash(
  game: unknown,
  collections: Readonly<Record<string, unknown>>,
): Promise<string> {
  const sorted = Object.fromEntries(
    Object.entries(collections).map(([name, records]) => [
      name,
      Array.isArray(records) ? sortRecordsById(records) : records,
    ]),
  );
  return sha256Hex(canonicalJson({ collections: sorted, game }));
}

export interface BuildBackupInput {
  readonly schemaVersion: number;
  readonly appVersion: string;
  readonly exportedAt: string;
  readonly game: BackupGameSummary;
  readonly collections: BackupCollections;
}

export async function buildBackupDocument(input: BuildBackupInput): Promise<BackupDocument> {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: input.schemaVersion,
    appVersion: input.appVersion,
    exportedAt: input.exportedAt,
    game: input.game,
    counts: countCollections(input.collections),
    sha256: await computeBackupHash(input.game, input.collections),
    collections: input.collections,
  };
}

export interface EncodedBackup {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly compressed: boolean;
}

export async function encodeBackupDocument(document: BackupDocument): Promise<EncodedBackup> {
  const json = new TextEncoder().encode(JSON.stringify(document));
  if (canCompress()) {
    return { bytes: await gzip(json), compressed: true };
  }
  return { bytes: json, compressed: false };
}
