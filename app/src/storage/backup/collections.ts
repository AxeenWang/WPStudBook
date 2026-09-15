import { isPlainRecord, type StoredRecord } from '../records.ts';
import {
  BACKUP_COLLECTIONS,
  RECORD_COLLECTIONS,
  STORE_DEFINITIONS,
  type BackupCollection,
  type RecordCollection,
} from '../schema.ts';
import type { BackupCollections, BackupGameSummary } from './document.ts';
import { findInvalidJsonValue } from './json-value.ts';
import { RECORD_RULES } from './record-rules.ts';

export type BackupIssueCode =
  | 'gzipUnsupported'
  | 'decompressFailed'
  | 'notUtf8'
  | 'invalidJson'
  | 'wrongFormat'
  | 'envelopeInvalid'
  | 'futureVersion'
  | 'countMismatch'
  | 'hashMismatch'
  | 'unsupportedVersion'
  | 'migrationFailed'
  | 'gameSummaryInvalid'
  | 'unknownCollection'
  | 'missingCollection'
  | 'settingsInvalid'
  | 'recordInvalid'
  | 'duplicateId'
  | 'uniqueConflict'
  | 'missingReference';

export interface BackupIssue {
  readonly code: BackupIssueCode;
  readonly message: string;
}

export const MAX_REPORTED_ISSUES = 20;

export interface Relation {
  readonly collection: RecordCollection;
  readonly field: string;
  readonly target: RecordCollection;
}

/** 已確定的內部 id 參照；欄位不存在時不檢查（例如父馬只有外部名稱）。階段 2 定義各資料表型別時補齊。 */
export const RELATIONS: readonly Relation[] = [
  { collection: 'horses', field: 'sireId', target: 'horses' },
  { collection: 'horses', field: 'damId', target: 'horses' },
  { collection: 'mares', field: 'id', target: 'horses' },
  { collection: 'foals', field: 'id', target: 'horses' },
  { collection: 'foals', field: 'damId', target: 'horses' },
  { collection: 'stallionDuties', field: 'horseId', target: 'horses' },
  { collection: 'mareYearly', field: 'horseId', target: 'horses' },
  { collection: 'stallionYearly', field: 'horseId', target: 'horses' },
  { collection: 'breedings', field: 'mareId', target: 'horses' },
  { collection: 'breedings', field: 'stallionId', target: 'horses' },
  { collection: 'matingRatings', field: 'stallionId', target: 'horses' },
  { collection: 'matingRatings', field: 'mareId', target: 'horses' },
];

/** 含 gameId 或可由其他欄位重建、不收錄於備份的欄位（設計決策 5.4 節）。 */
export const DERIVED_FIELDS: Readonly<Partial<Record<RecordCollection, readonly string[]>>> = {
  horses: ['nameKeys'],
};

const SETTINGS_POSITIVE_INTEGERS = [
  'retirementAge',
  'highAgeReminderAge',
  'stallionAgeReminderAge',
  'checkpointRetention',
] as const;

type RecordTables = Readonly<Record<BackupCollection, readonly StoredRecord[]>>;

function issue(code: BackupIssueCode, message: string): BackupIssue {
  return { code, message };
}

function idOf(record: StoredRecord): string {
  return typeof record.id === 'string' ? record.id : '';
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** 與 domain/game.ts 的年份規則相同；storage 不能引用 domain 的值，所以在此重寫。 */
function isGameYear(value: unknown): value is number {
  return isInteger(value) && value >= 1000 && value <= 9999;
}

export type GameSummaryResult =
  | { readonly ok: true; readonly game: BackupGameSummary }
  | { readonly ok: false; readonly issues: readonly BackupIssue[] };

export function readGameSummary(game: unknown): GameSummaryResult {
  if (!isPlainRecord(game)) {
    return { ok: false, issues: [issue('gameSummaryInvalid', 'game 摘要不是物件')] };
  }
  const { name, startYear, currentYear } = game;
  if (typeof name !== 'string' || name.trim() === '') {
    return { ok: false, issues: [issue('gameSummaryInvalid', 'game 摘要的局名必須是非空白文字')] };
  }
  if (!isGameYear(startYear) || !isGameYear(currentYear)) {
    return {
      ok: false,
      issues: [
        issue('gameSummaryInvalid', 'game 摘要的起始年與目前遊戲年必須是 1000～9999 的整數'),
      ],
    };
  }
  if (currentYear < startYear) {
    return { ok: false, issues: [issue('gameSummaryInvalid', 'game 摘要的目前遊戲年早於起始年')] };
  }
  return { ok: true, game: { name, startYear, currentYear } };
}

export type CollectionsValidation =
  | { readonly ok: true; readonly collections: BackupCollections }
  | {
      readonly ok: false;
      readonly stage: 'fields' | 'relations';
      readonly issues: readonly BackupIssue[];
    };

export function validateCollections(input: unknown): CollectionsValidation {
  if (!isPlainRecord(input)) {
    return failed('fields', [issue('recordInvalid', 'collections 不是物件')]);
  }
  const fieldIssues = checkFields(input);
  if (fieldIssues.length > 0) {
    return failed('fields', fieldIssues);
  }
  const tables = input as RecordTables;
  const relationIssues = [
    ...checkDuplicateIds(tables),
    ...checkUniqueIndexes(tables),
    ...checkRelations(tables),
  ];
  if (relationIssues.length > 0) {
    return failed('relations', relationIssues);
  }
  return { ok: true, collections: stripDerivedFields(tables) };
}

function failed(
  stage: 'fields' | 'relations',
  issues: readonly BackupIssue[],
): CollectionsValidation {
  return { ok: false, stage, issues: issues.slice(0, MAX_REPORTED_ISSUES) };
}

function checkFields(input: StoredRecord): BackupIssue[] {
  const issues: BackupIssue[] = [];
  const known = new Set<string>(BACKUP_COLLECTIONS);
  for (const name of Object.keys(input)) {
    if (!known.has(name)) {
      issues.push(issue('unknownCollection', `不認得的資料表 ${name}`));
    }
  }
  for (const name of BACKUP_COLLECTIONS) {
    const records = input[name];
    if (records === undefined) {
      issues.push(issue('missingCollection', `缺少資料表 ${name}`));
    } else if (!Array.isArray(records)) {
      issues.push(issue('recordInvalid', `資料表 ${name} 不是陣列`));
    } else if (name === 'gameSettings') {
      issues.push(...checkSettings(records));
    } else {
      records.forEach((record: unknown, index) => {
        const problem = checkRecord(name, record, index);
        if (problem !== undefined) {
          issues.push(issue('recordInvalid', problem));
        }
      });
    }
    if (issues.length >= MAX_REPORTED_ISSUES) {
      break;
    }
  }
  return issues;
}

function checkRecord(
  collection: RecordCollection,
  record: unknown,
  index: number,
): string | undefined {
  const path = `${collection}[${String(index)}]`;
  if (!isPlainRecord(record)) {
    return `${path} 不是物件`;
  }
  if (typeof record.id !== 'string' || record.id === '') {
    return `${path} 的 id 必須是非空字串`;
  }
  const label = `${path}（id ${record.id}）`;
  if ('gameId' in record) {
    return `${label} 不可包含 gameId`;
  }
  const jsonProblem = findInvalidJsonValue(record, label);
  if (jsonProblem !== undefined) {
    return jsonProblem;
  }
  const ruleProblem = RECORD_RULES[collection]?.(record);
  return ruleProblem === undefined ? undefined : `${label}：${ruleProblem}`;
}

function checkSettings(records: readonly unknown[]): BackupIssue[] {
  if (records.length !== 1) {
    return [
      issue('settingsInvalid', `gameSettings 必須剛好一筆，實際為 ${String(records.length)} 筆`),
    ];
  }
  const settings = records[0];
  if (!isPlainRecord(settings)) {
    return [issue('settingsInvalid', 'gameSettings 不是物件')];
  }
  const problems: string[] = [];
  if ('gameId' in settings || 'id' in settings) {
    problems.push('不可包含 gameId 或 id');
  }
  for (const field of SETTINGS_POSITIVE_INTEGERS) {
    const value = settings[field];
    if (!isInteger(value) || value < 1) {
      problems.push(`${field} 必須是正整數`);
    }
  }
  const threshold = settings.vitalityThreshold;
  if (threshold !== undefined && (!isInteger(threshold) || threshold < 0 || threshold > 100)) {
    problems.push('vitalityThreshold 必須是 0～100 的整數');
  }
  const display = settings.display;
  if (
    !isPlainRecord(display) ||
    Object.values(display).some((item) => !['string', 'number', 'boolean'].includes(typeof item))
  ) {
    problems.push('display 必須是只含文字、數值或布林的物件');
  }
  const jsonProblem = findInvalidJsonValue(settings, 'gameSettings[0]');
  if (jsonProblem !== undefined) {
    problems.push(jsonProblem);
  }
  return problems.map((problem) => issue('settingsInvalid', `gameSettings：${problem}`));
}

function checkDuplicateIds(tables: RecordTables): BackupIssue[] {
  const issues: BackupIssue[] = [];
  for (const name of RECORD_COLLECTIONS) {
    const seen = new Set<string>();
    for (const record of tables[name]) {
      const id = idOf(record);
      if (seen.has(id)) {
        issues.push(issue('duplicateId', `資料表 ${name} 有重複的 id：${id}`));
      }
      seen.add(id);
    }
  }
  return issues;
}

function valueAtPath(record: StoredRecord, path: string): unknown {
  let current: unknown = record;
  for (const part of path.split('.')) {
    if (!isPlainRecord(current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

/** IndexedDB 也會為陣列鍵建索引，因此陣列值只要每個元素都是可索引值就一併檢查。 */
function isIndexedValue(value: unknown): boolean {
  if (typeof value === 'string') {
    return true;
  }
  if (typeof value === 'number') {
    return !Number.isNaN(value);
  }
  return Array.isArray(value) && value.every(isIndexedValue);
}

/** IndexedDB 不為缺少索引欄位的紀錄建索引，所以只比對索引欄位齊全的紀錄（設計決策 5.1 節）。 */
function checkUniqueIndexes(tables: RecordTables): BackupIssue[] {
  const issues: BackupIssue[] = [];
  for (const name of RECORD_COLLECTIONS) {
    for (const index of STORE_DEFINITIONS[name].indexes) {
      if (!index.unique || typeof index.keyPath === 'string') {
        continue;
      }
      const fields = index.keyPath.filter((field) => field !== 'gameId');
      const owners = new Map<string, string>();
      for (const record of tables[name]) {
        const values = fields.map((field) => valueAtPath(record, field));
        if (!values.every(isIndexedValue)) {
          continue;
        }
        const key = JSON.stringify(values);
        const owner = owners.get(key);
        if (owner === undefined) {
          owners.set(key, idOf(record));
        } else {
          issues.push(
            issue(
              'uniqueConflict',
              `資料表 ${name} 的 ${index.name} 重複：${owner} 與 ${idOf(record)}`,
            ),
          );
        }
      }
    }
  }
  return issues;
}

function checkRelations(tables: RecordTables): BackupIssue[] {
  const idSets = new Map<RecordCollection, Set<string>>();
  const idsOf = (name: RecordCollection): Set<string> => {
    const existing = idSets.get(name);
    if (existing !== undefined) {
      return existing;
    }
    const created = new Set(tables[name].map(idOf));
    idSets.set(name, created);
    return created;
  };
  const issues: BackupIssue[] = [];
  for (const relation of RELATIONS) {
    for (const record of tables[relation.collection]) {
      const value = record[relation.field];
      if (value === undefined) {
        continue;
      }
      if (typeof value !== 'string' || !idsOf(relation.target).has(value)) {
        issues.push(
          issue(
            'missingReference',
            `${relation.collection} ${idOf(record)} 的 ${relation.field} 指向不存在的 ${relation.target}：${JSON.stringify(value)}`,
          ),
        );
      }
    }
  }
  return issues;
}

function stripDerivedFields(tables: RecordTables): BackupCollections {
  const entries = BACKUP_COLLECTIONS.map((name) => {
    const derived = name === 'gameSettings' ? undefined : DERIVED_FIELDS[name];
    const records =
      derived === undefined
        ? tables[name]
        : tables[name].map((record) =>
            Object.fromEntries(Object.entries(record).filter(([key]) => !derived.includes(key))),
          );
    return [name, records] as const;
  });
  // 通過 checkFields 後，每個值都已確認是資料契約的 JSON 值。
  return Object.fromEntries(entries) as BackupCollections;
}
