import type { DutyStatus, StallionRole } from '../../domain/stallion-duty.ts';
import type { HistoryEventSource, HistoryEventType } from '../../domain/history-event.ts';
import type { BreedingType, Conception } from '../../domain/breeding.ts';
import type { Aptitude, Disposition, SubParamGrade, SubParamKey } from '../../domain/foal.ts';
import type { AliasKind, LifeStage, RecordSource, Sex } from '../../domain/horse.ts';
import type { ImportType } from '../../domain/import-type.ts';
import type {
  AssignedGroupKind,
  LeftReason,
  MareOrigin,
  MareSite,
  MareStatus,
  Succession,
  YearPlan,
} from '../../domain/mare.ts';
import type { Vitality } from '../../domain/mare-yearly.ts';
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
  mareAdded: true,
  mareSold: true,
  mareTransferred: true,
  mareYearlyChanged: true,
  settingsChanged: true,
  breedingRecorded: true,
  foalBorn: true,
  foalChanged: true,
  horseNamed: true,
  successionChanged: true,
  lineGenerationEstablished: true,
});
const EVENT_SOURCES = enumSet<HistoryEventSource>({ user: true, migration: true });
const MARE_GROUP_KINDS = enumSet<AssignedGroupKind | 'unassigned'>({
  own: true,
  substitute: true,
  starter: true,
  unassigned: true,
});
const MARE_ORIGINS = enumSet<MareOrigin>({
  marketFound: true,
  marketReplenish: true,
  marketMixed: true,
  marketRecovery: true,
  ownRetired: true,
  other: true,
});
const MARE_STATUSES = enumSet<MareStatus>({ producing: true, left: true });
const LEFT_REASONS = enumSet<LeftReason>({ sold: true, retired: true });
const SUCCESSIONS = enumSet<Succession>({
  provisional: true,
  sisterCandidate: true,
  confirmed: true,
  replaced: true,
  sold: true,
});
const YEAR_PLANS = enumSet<YearPlan>({
  undecided: true,
  designated: true,
  free: true,
  waitVitality: true,
  rest: true,
});
const VITALITY_STATES = enumSet<Vitality['state']>({
  notApplicable: true,
  pending: true,
  confirmed: true,
});
const CONCEPTION_VALUES = enumSet<Conception>({
  空胎: true,
  受胎: true,
  不受胎: true,
  未確認: true,
});
const BREEDING_TYPE_VALUES = enumSet<BreedingType>({ designated: true, free: true });
const DISPOSITION_VALUES = enumSet<Disposition>({ keep: true, forSale: true, sold: true });
const APTITUDE_VALUES = enumSet<Aptitude>({ '◎': true, '○': true, '△': true, '×': true });
const SUB_PARAM_KEY_VALUES = enumSet<SubParamKey>({
  power: true,
  quickness: true,
  guts: true,
  flexibility: true,
  spirit: true,
  wisdom: true,
  health: true,
});
const SUB_PARAM_GRADE_VALUES = enumSet<SubParamGrade>({
  G: true,
  'G+': true,
  F: true,
  'F+': true,
  E: true,
  'E+': true,
  D: true,
  'D+': true,
  C: true,
  'C+': true,
  B: true,
  'B+': true,
  A: true,
  'A+': true,
  S: true,
  'S+': true,
});
/** 以型別確保與 domain 的據點一致；鍵是數字，比對時轉成字串。 */
const MARE_SITE_FLAGS: Readonly<Record<MareSite, true>> = {
  32: true,
  33: true,
  34: true,
  35: true,
};

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

function checkMareGroup(group: unknown): string | undefined {
  if (!isPlainRecord(group) || !isOneOf(MARE_GROUP_KINDS, group.kind)) {
    return 'group.kind 必須是 own、substitute、starter 或 unassigned';
  }
  if (group.kind === 'unassigned') {
    return undefined;
  }
  if (!isIntegerIn(group.position, 1, 8)) {
    return 'group.position 必須是 1～8 的整數';
  }
  if (group.kind === 'starter') {
    return group.position === 1 && group.generation === 0
      ? undefined
      : '起點母馬群必須是第 1 系、代數 0';
  }
  return isIntegerIn(group.generation, 1, 9999)
    ? undefined
    : 'group.generation 必須是 1 以上的整數';
}

function isMareSiteValue(value: unknown): boolean {
  return isInteger(value) && String(value) in MARE_SITE_FLAGS;
}

function isYearPlanValue(value: unknown): boolean {
  return isPlainRecord(value) && isOneOf(YEAR_PLANS, value.plan) && isYear(value.gameYear);
}

function checkMare(record: StoredRecord): string | undefined {
  const groupProblem = checkMareGroup(record.group);
  const left = record.status === 'left';
  return firstProblem([
    [groupProblem === undefined, groupProblem ?? ''],
    [isOneOf(MARE_ORIGINS, record.origin), 'origin 不是有效的來源'],
    [optional(record, 'originNote', isNonEmptyString), 'originNote 必須是非空字串'],
    [isOneOf(MARE_STATUSES, record.status), 'status 必須是 producing 或 left'],
    left
      ? [isOneOf(LEFT_REASONS, record.leftReason), 'leftReason 必須是 sold 或 retired']
      : [!('leftReason' in record), '生產中的母馬不可有 leftReason'],
    [isMareSiteValue(record.site), 'site 必須是 32～35 的整數'],
    [
      optional(record, 'succession', (value) => isOneOf(SUCCESSIONS, value)),
      'succession 不是有效的姊妹接替狀態',
    ],
    [optional(record, 'yearPlan', isYearPlanValue), 'yearPlan 必須含有效的 plan 與 gameYear'],
  ]);
}

function isVitality(value: unknown): boolean {
  if (!isPlainRecord(value) || !isOneOf(VITALITY_STATES, value.state)) {
    return false;
  }
  return (
    value.state !== 'confirmed' ||
    (isIntegerIn(value.value, 0, 100) && typeof value.boosted === 'boolean')
  );
}

function checkMareYearly(record: StoredRecord): string | undefined {
  return firstProblem([
    [isNonEmptyString(record.horseId), 'horseId 必須是非空字串'],
    [isYear(record.gameYear), 'gameYear 必須是 1000～9999 的整數'],
    [optional(record, 'vitalityMay', isVitality), 'vitalityMay 不是有效的活力'],
    [optional(record, 'vitalityJuly', isVitality), 'vitalityJuly 不是有效的活力'],
    [
      optional(record, 'kodashi', (value) => isIntegerIn(value, 0, 15)),
      'kodashi 必須是 0～15 的整數',
    ],
    [
      optional(record, 'breedingYears', (value) => isIntegerIn(value, 0, 99)),
      'breedingYears 必須是 0～99 的整數',
    ],
    [
      optional(record, 'breedingCount', (value) => isIntegerIn(value, 0, 99)),
      'breedingCount 必須是 0～99 的整數',
    ],
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

function checkBreeding(record: StoredRecord): string | undefined {
  const { gameYear, expectedBirthYear } = record;
  const conceived = record.conception === '受胎';
  return firstProblem([
    [isNonEmptyString(record.mareId), 'mareId 必須是非空字串'],
    [isYear(gameYear), 'gameYear 必須是 1000～9999 的整數'],
    [isOneOf(BREEDING_TYPE_VALUES, record.breedingType), 'breedingType 必須是 designated 或 free'],
    [optional(record, 'stallionId', isNonEmptyString), 'stallionId 必須是非空字串'],
    [optional(record, 'stallionName', isNonEmptyString), 'stallionName 必須是非空字串'],
    [
      optional(record, 'conception', (value) => isOneOf(CONCEPTION_VALUES, value)),
      'conception 必須是 空胎、受胎、不受胎 或 未確認',
    ],
    conceived
      ? [
          isInteger(gameYear) && expectedBirthYear === gameYear + 1,
          '受胎時 expectedBirthYear 必須是 gameYear 加 1',
        ]
      : [!('expectedBirthYear' in record), '未受胎時不可有 expectedBirthYear'],
    [optional(record, 'foalId', isNonEmptyString), 'foalId 必須是非空字串'],
    [!('foalId' in record) || conceived, '只有受胎的紀錄可以連結產駒'],
  ]);
}

function isSubParams(value: unknown): boolean {
  if (!isPlainRecord(value)) {
    return false;
  }
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.every(
      ([key, grade]) =>
        isOneOf(SUB_PARAM_KEY_VALUES, key) && isOneOf(SUB_PARAM_GRADE_VALUES, grade),
    )
  );
}

function isLineage(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    isIntegerIn(value.position, 1, 8) &&
    isIntegerIn(value.generation, 1, 9999)
  );
}

function checkFoal(record: StoredRecord): string | undefined {
  const { freeBred } = record;
  const isAbility = (value: unknown) => isIntegerIn(value, 0, 999);
  const isAptitude = (value: unknown) => isOneOf(APTITUDE_VALUES, value);
  return firstProblem([
    [isNonEmptyString(record.damId), 'damId 必須是非空字串'],
    [isYear(record.birthYear), 'birthYear 必須是 1000～9999 的整數'],
    [typeof freeBred === 'boolean', 'freeBred 必須是布林值'],
    freeBred === true
      ? [!('lineage' in record), '自由配種產駒不可有 lineage']
      : [isLineage(record.lineage), 'lineage 必須含 1～8 的 position 與 1 以上的 generation'],
    [isOneOf(DISPOSITION_VALUES, record.disposition), 'disposition 必須是 keep、forSale 或 sold'],
    [freeBred !== true || record.disposition !== 'keep', '自由配種產駒不可保留'],
    [optional(record, 'sp', isAbility), 'sp 必須是 0～999 的整數'],
    [optional(record, 'st', isAbility), 'st 必須是 0～999 的整數'],
    [optional(record, 'subParams', isSubParams), 'subParams 必須是有效的副能力等級'],
    [optional(record, 'turf', isAptitude), 'turf 必須是 ◎、○、△ 或 ×'],
    [optional(record, 'dirt', isAptitude), 'dirt 必須是 ◎、○、△ 或 ×'],
    [optional(record, 'distanceText', isNonEmptyString), 'distanceText 必須是非空字串'],
    [
      optional(record, 'kodashi', (value) => isIntegerIn(value, 0, 15)),
      'kodashi 必須是 0～15 的整數',
    ],
    [optional(record, 'note', isNonEmptyString), 'note 必須是非空字串'],
  ]);
}

/** 各資料表的欄位規則（設計決策 5.4 節）；未列出的資料表只檢查通用規則。 */
export const RECORD_RULES: Readonly<Partial<Record<RecordCollection, RecordRule>>> = {
  horses: checkHorse,
  lines: checkLine,
  systemMap: checkSystemMapEntry,
  stallionDuties: checkStallionDuty,
  mares: checkMare,
  mareYearly: checkMareYearly,
  breedings: checkBreeding,
  foals: checkFoal,
  events: checkEvent,
};
