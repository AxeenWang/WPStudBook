import type { DutyStatus, StallionRole } from '../../domain/stallion-duty.ts';
import type { HistoryEventSource, HistoryEventType } from '../../domain/history-event.ts';
import type { AliasKind, LifeStage, RecordSource, Sex } from '../../domain/horse.ts';
import type { ImportType } from '../../domain/import-type.ts';
import { isPlainRecord, type StoredRecord } from '../records.ts';
import type { RecordCollection } from '../schema.ts';

/** 回傳第一個問題的說明；紀錄合格時回傳 undefined。 */
export type RecordRule = (record: StoredRecord) => string | undefined;

/**
 * storage 對 domain 只能 import type（設計決策第 4 節），所以列舉值在此列出。
 * 參數型別 Record<T, true> 讓少列或多列都成為型別錯誤，與 domain 的型別保持一致。
 */
function enumSet<T extends string>(values: Readonly<Record<T, true>>): ReadonlySet<T> {
  return new Set(Object.keys(values) as T[]);
}

function isOneOf<T extends string>(values: ReadonlySet<T>, value: unknown): value is T {
  return typeof value === 'string' && (values as ReadonlySet<string>).has(value);
}

const IMPORT_TYPES: Readonly<Record<ImportType, true>> = {
  jan2yo: true,
  aprFoals: true,
  mayMares: true,
  julMares: true,
  candidateFile: true,
  mayStallions: true,
  targetStallion: true,
  octWorldMares: true,
};

const SEXES = enumSet<Sex>({ male: true, female: true });
const LIFE_STAGES = enumSet<LifeStage>({
  foal: true,
  racehorse: true,
  broodmare: true,
  stallion: true,
});
const RECORD_SOURCES = enumSet<RecordSource>({ manual: true, ...IMPORT_TYPES });
const ALIAS_KINDS = enumSet<AliasKind>({ manual: true, imported: true });
const STALLION_ROLES = enumSet<StallionRole>({ current: true, planned: true });
const DUTY_STATUSES = enumSet<DutyStatus>({
  onDuty: true,
  replaced: true,
  outOfService: true,
  retired: true,
});
const EVENT_TYPES = enumSet<HistoryEventType>({
  gameYearChanged: true,
  schemaMigrated: true,
  systemMapChanged: true,
  horseCreated: true,
  lineOpened: true,
  stallionDutyStarted: true,
});
const EVENT_SOURCES = enumSet<HistoryEventSource>({ user: true, migration: true });

const LINE_COLOR = /^#[0-9a-f]{6}$/;

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isIntegerIn(value: unknown, min: number, max: number): boolean {
  return isInteger(value) && value >= min && value <= max;
}

/** 與 domain/game.ts 的年份範圍相同；storage 不能引用 domain 的值。 */
function isYear(value: unknown): boolean {
  return isIntegerIn(value, 1000, 9999);
}

/** 能力番号與馬番号：0～65535（設計決策 5.3 節）。 */
function isHorseNumber(value: unknown): boolean {
  return isIntegerIn(value, 0, 0xffff);
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value !== '';
}

function isArrayOf(value: unknown, test: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every((item: unknown) => test(item));
}

function optional(record: StoredRecord, field: string, test: (value: unknown) => boolean): boolean {
  return !(field in record) || test(record[field]);
}

function firstProblem(checks: readonly (readonly [boolean, string])[]): string | undefined {
  return checks.find(([ok]) => !ok)?.[1];
}

function isStageNumber(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    isOneOf(LIFE_STAGES, value.stage) &&
    isHorseNumber(value.number) &&
    isYear(value.gameYear) &&
    isOneOf(RECORD_SOURCES, value.source)
  );
}

function isAlias(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    isOneOf(ALIAS_KINDS, value.kind) &&
    isNonEmptyString(value.name) &&
    isYear(value.gameYear)
  );
}

const HORSE_TEXT_FIELDS = [
  'fullName',
  'baseName',
  'officialName',
  'sireId',
  'sireName',
  'damId',
  'damName',
  'sireSubsystem',
] as const;

function checkHorse(record: StoredRecord): string | undefined {
  return firstProblem([
    [isOneOf(SEXES, record.sex), 'sex 必須是 male 或 female'],
    [optional(record, 'abilityNo', isHorseNumber), 'abilityNo 必須是 0～65535 的整數'],
    [optional(record, 'birthYear', isYear), 'birthYear 必須是 1000～9999 的整數'],
    ...HORSE_TEXT_FIELDS.map(
      (field) => [optional(record, field, isNonEmptyString), `${field} 必須是非空字串`] as const,
    ),
    [optional(record, 'femaleLine', (value) => typeof value === 'string'), 'femaleLine 必須是字串'],
    [record.sireId !== record.id && record.damId !== record.id, '父母不可是自己'],
    [isArrayOf(record.stageNumbers, isStageNumber), 'stageNumbers 必須是階段馬番号陣列'],
    [isArrayOf(record.aliases, isAlias), 'aliases 必須是名稱別名陣列'],
  ]);
}

function isEstablishedGeneration(value: unknown): boolean {
  return isPlainRecord(value) && isIntegerIn(value.generation, 1, 9999) && isYear(value.gameYear);
}

function hasUniqueGenerations(value: unknown): boolean {
  if (!isArrayOf(value, isEstablishedGeneration)) {
    return false;
  }
  const generations = (value as readonly StoredRecord[]).map((item) => item.generation);
  return new Set(generations).size === generations.length;
}

function checkLine(record: StoredRecord): string | undefined {
  const { branch } = record;
  return firstProblem([
    [isIntegerIn(record.position, 1, 8), 'position 必須是 1～8 的整數'],
    [isNonEmptyString(record.subsystem), 'subsystem 必須是非空字串'],
    [isNonEmptyString(record.parentSystem), 'parentSystem 必須是非空字串'],
    [
      typeof record.color === 'string' && LINE_COLOR.test(record.color),
      'color 必須是 #rrggbb 格式',
    ],
    [
      isPlainRecord(branch) &&
        isIntegerIn(branch.targetGeneration, 1, 9999) &&
        isYear(branch.openedYear),
      'branch 必須含 1 以上的 targetGeneration 與 openedYear',
    ],
    [
      hasUniqueGenerations(record.establishedGenerations),
      'establishedGenerations 必須是代數不重複的成立紀錄陣列',
    ],
  ]);
}

function checkSystemMapEntry(record: StoredRecord): string | undefined {
  return firstProblem([
    [isNonEmptyString(record.subsystem), 'subsystem 必須是非空字串'],
    [isNonEmptyString(record.parentSystem), 'parentSystem 必須是非空字串'],
  ]);
}

function checkStallionDuty(record: StoredRecord): string | undefined {
  return firstProblem([
    [isIntegerIn(record.position, 1, 8), 'position 必須是 1～8 的整數'],
    [isIntegerIn(record.generation, 0, 9999), 'generation 必須是 0 以上的整數'],
    [isNonEmptyString(record.horseId), 'horseId 必須是非空字串'],
    [isOneOf(STALLION_ROLES, record.role), 'role 必須是 current 或 planned'],
    [isOneOf(DUTY_STATUSES, record.dutyStatus), 'dutyStatus 不是有效的任期狀態'],
    [isYear(record.startYear), 'startYear 必須是 1000～9999 的整數'],
  ]);
}

function isTiming(value: unknown): boolean {
  return isPlainRecord(value) && isIntegerIn(value.month, 1, 12) && isIntegerIn(value.week, 1, 5);
}

function checkEvent(record: StoredRecord): string | undefined {
  const { occurredAt } = record;
  return firstProblem([
    [isNonEmptyString(record.subjectId), 'subjectId 必須是非空字串'],
    [isOneOf(EVENT_TYPES, record.type), 'type 不是有效的事件型別'],
    [isYear(record.gameYear), 'gameYear 必須是 1000～9999 的整數'],
    [optional(record, 'timing', isTiming), 'timing 必須是 1～12 月、1～5 週'],
    [isOneOf(EVENT_SOURCES, record.source), 'source 不是有效的事件來源'],
    [
      typeof occurredAt === 'string' && !Number.isNaN(Date.parse(occurredAt)),
      'occurredAt 必須是日期時間字串',
    ],
  ]);
}

/** 各資料表的欄位規則（設計決策 5.4 節）；未列出的資料表只檢查通用規則。 */
export const RECORD_RULES: Readonly<Partial<Record<RecordCollection, RecordRule>>> = {
  horses: checkHorse,
  lines: checkLine,
  systemMap: checkSystemMapEntry,
  stallionDuties: checkStallionDuty,
  events: checkEvent,
};
