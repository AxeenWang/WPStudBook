import type { Foal } from '../domain/foal.ts';
import type { HistoryEvent } from '../domain/history-event.ts';
import { isStallionHorse, toBaseName, withStageNumber, type Horse } from '../domain/horse.ts';
import { inferBirthYear } from '../domain/identity.ts';
import type { PreviewIssue, PreviewOutcome, PreviewRow } from '../domain/import-batch.ts';
import { isActivePlanned, isOnDuty, type StallionDuty } from '../domain/stallion-duty.ts';
import {
  sameSnapshot,
  type StallionSnapshot,
  type StallionYearly,
} from '../domain/stallion-yearly.ts';
import type { ParsedFile } from '../import/parse.ts';
import { readStallionRow, type StallionValues } from '../import/stallion.ts';
import { isPrefixOnlyName } from '../import/values.ts';
import { getFoalsByIds } from '../storage/foals.ts';
import { getHorsesByIds, listHorses } from '../storage/horses.ts';
import { listLines } from '../storage/lines.ts';
import type { CollectionRecord } from '../storage/imports.ts';
import { listImports } from '../storage/imports.ts';
import { listStallionDuties } from '../storage/stallion-duties.ts';
import { listStallionYearly } from '../storage/stallion-yearly.ts';
import type { ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import { userEvent } from './events.ts';
import { compareBlood, type BloodFills } from './import-blood.ts';
import {
  duplicateAbilityNosIn,
  importedStageNumber,
  resolveIdentities,
  type IdentityResolution,
  type IdentityRow,
} from './import-identity.ts';
import type { ImportChoice, ImportHandler } from './imports.ts';

/**
 * 預覽的處置（需求規格 11.8）。
 *
 * `becameStallion` 是配對到自家產駒的第一次，要沿用內部識別並留下去向（STL-09）；
 * 之後的年份就是一般的 `continuing`。缺席分成兩種：八系的現任或建系用零代種牡馬預設
 * 標示已引退，其餘只標示非現役（STL-10），兩者都可以逐匹更正。
 */
export type StallionDisposition =
  | 'continuing'
  | 'newStallion'
  | 'becameStallion'
  | 'inactive'
  | 'retired'
  | 'conflict'
  | 'unmatched';

/** 缺席者可以改成的處置（需求規格 11.8「可逐匹更正」）。 */
export type AbsentDisposition = Extract<StallionDisposition, 'inactive' | 'retired'>;

export interface MayStallionRow extends PreviewRow {
  readonly disposition: StallionDisposition;
  /** 檔案列才有；缺席的種牡馬沒有。 */
  readonly values: StallionValues | undefined;
  readonly birthYear: number | undefined;
  /** 配對到的既有馬匹。 */
  readonly horseId: string | undefined;
  readonly horse: Horse | undefined;
  /** 配對到自家產駒時才有（STL-09）。 */
  readonly foal: Foal | undefined;
  /** 只補空白欄；與既有不同的欄位列在這裡並略過該筆（STL-13）。 */
  readonly fills: BloodFills;
  /** 這一份的年度快照；缺席的列沒有。 */
  readonly snapshot: StallionSnapshot | undefined;
  /** 這個匯入年已有的年度資料；有的話沿用同一筆的 id（`[gameId, horseId, gameYear]` 唯一）。 */
  readonly yearly: StallionYearly | undefined;
  /** 這個匯入年以前最近的一份快照；相同時不重複保存（STL-11）。 */
  readonly previousYearly: StallionYearly | undefined;
  /** 缺席時要結束的八系任期（現任或進行中的預定後繼）。 */
  readonly duty: StallionDuty | undefined;
  /** 預定後繼的事件以系位置為對象（設計決策 5.2），所以帶著那一系的 id。 */
  readonly lineId: string | undefined;
}

export interface MayStallionsOverview {
  readonly total: number;
  readonly continuing: number;
  readonly newStallion: number;
  readonly becameStallion: number;
  readonly inactive: number;
  readonly retired: number;
  readonly conflict: number;
  readonly unmatched: number;
  /** 年度資料與前一份相同、這次不會寫入的筆數（STL-11）。 */
  readonly unchangedYearly: number;
}

const ISSUES = {
  identityConflict: {
    code: 'identityConflict',
    message: '與既有紀錄的身分不符，略過這一筆',
    handling: 'confirm',
  },
  identityAmbiguous: {
    code: 'identityAmbiguous',
    message: '有多筆名稱相符的既有紀錄，無法唯一配對',
    handling: 'confirm',
  },
  bloodConflict: {
    code: 'bloodConflict',
    message: '父馬、母馬或父系與既有紀錄不同，略過這一筆',
    handling: 'confirm',
  },
  prefixOnlyName: {
    code: 'prefixOnlyName',
    message: '只有 (外) 或 [地] 前綴、沒有馬名，略過這一筆',
    handling: 'confirm',
  },
  notMale: {
    code: 'notMale',
    message: '配對到的既有紀錄是牝馬，略過這一筆',
    handling: 'confirm',
  },
  absentInactive: {
    code: 'absentInactive',
    message: '今年的種牡馬總表沒有這匹馬，標示為非現役',
    handling: 'confirm',
  },
  absentRetired: {
    code: 'absentRetired',
    message: '八系的種牡馬今年缺席，預設標示已引退並結束任期',
    handling: 'confirm',
  },
} as const satisfies Record<string, PreviewIssue>;

function toIdentityRow(values: StallionValues, birthYear: number | undefined): IdentityRow {
  return {
    lineNumber: values.lineNumber,
    abilityNo: values.abilityNo,
    birthYear,
    fullName: values.fullName,
    baseName: values.baseName,
    sireName: values.sireName,
    damName: values.damName,
  };
}

function snapshotOf(values: StallionValues): StallionSnapshot {
  const hasSubParams = Object.keys(values.subParams).length > 0;
  const hasRecord = Object.keys(values.record).length > 0;
  return {
    ...(values.sp === undefined ? {} : { sp: values.sp }),
    ...(values.st === undefined ? {} : { st: values.st }),
    ...(hasSubParams ? { subParams: values.subParams } : {}),
    ...(values.subParamTotal === undefined ? {} : { subParamTotal: values.subParamTotal }),
    ...(values.kodashi === undefined ? {} : { kodashi: values.kodashi }),
    ...(values.studFee === undefined ? {} : { studFee: values.studFee }),
    ...(hasRecord ? { record: values.record } : {}),
  };
}

/** 唯一配對到的既有馬匹；多筆候選（ambiguous）與新馬都沒有。 */
function matchedHorseId(resolution: IdentityResolution): string | undefined {
  switch (resolution.kind) {
    case 'new':
    case 'ambiguous':
      return undefined;
    default:
      return resolution.horse.id;
  }
}

interface Classified {
  readonly disposition: StallionDisposition;
  readonly outcome: PreviewOutcome;
  readonly issues: readonly PreviewIssue[];
  readonly horseId: string | undefined;
  readonly fills: BloodFills;
}

function classifyFileRow(
  values: StallionValues,
  resolution: IdentityResolution,
  horses: ReadonlyMap<string, Horse>,
  foals: ReadonlyMap<string, Foal>,
): Classified {
  if (isPrefixOnlyName(values.fullName)) {
    return {
      disposition: 'unmatched',
      outcome: 'skip',
      issues: [ISSUES.prefixOnlyName],
      horseId: undefined,
      fills: {},
    };
  }
  if (resolution.kind === 'ambiguous') {
    return {
      disposition: 'unmatched',
      outcome: 'review',
      issues: [ISSUES.identityAmbiguous],
      horseId: undefined,
      fills: {},
    };
  }
  if (resolution.kind === 'conflict') {
    return {
      disposition: 'conflict',
      outcome: 'skip',
      issues: [ISSUES.identityConflict],
      horseId: resolution.horse.id,
      fills: {},
    };
  }
  const horse =
    resolution.kind === 'new' ? undefined : (horses.get(resolution.horse.id) ?? resolution.horse);
  // 種牡馬總表裡的馬一定是公馬；配對到牝馬代表身分撞號，不替牠寫種牡馬資料。
  if (horse !== undefined && horse.sex !== 'male') {
    return {
      disposition: 'conflict',
      outcome: 'skip',
      issues: [ISSUES.notMale],
      horseId: horse.id,
      fills: {},
    };
  }
  // 新建的種牡馬紀錄沒有既有值，四個欄位都是要補的空白。
  const { fills, conflict } = compareBlood(values, horse);
  if (horse === undefined) {
    return {
      disposition: 'newStallion',
      outcome: 'apply',
      issues: [],
      horseId: undefined,
      fills,
    };
  }
  if (conflict) {
    return {
      disposition: 'conflict',
      outcome: 'skip',
      issues: [ISSUES.bloodConflict],
      horseId: horse.id,
      fills: {},
    };
  }
  // 自家產駒第一次出現在種牡馬總表：沿用內部識別並留下去向（需求規格 9.7、11.8、STL-09）。
  const becomes = foals.has(horse.id) && !isStallionHorse(horse);
  return {
    disposition: becomes ? 'becameStallion' : 'continuing',
    outcome: 'apply',
    issues: [],
    horseId: horse.id,
    fills,
  };
}

/** 最近一次同類型匯入的年份；沒有就當作匯入年的前一年（同 11.5 的缺席判斷）。 */
function lastStallionYearOf(
  imports: readonly { readonly type: string; readonly gameYear: number }[],
  gameYear: number,
): number {
  const years = imports
    .filter((batch) => batch.type === 'mayStallions' && batch.gameYear < gameYear)
    .map((batch) => batch.gameYear);
  return years.length === 0 ? gameYear - 1 : Math.max(...years);
}

/**
 * 缺席者的預設處置（需求規格 11.8、STL-10）：八系的現任、建系用零代種牡馬或進行中的
 * 預定後繼標示已引退，其餘只標示非現役。已引退會結束任期，缺少現任與缺少目標種牡馬
 * 由既有的任務規則自己推導出來（7.7）。
 */
function dutyOfAbsent(horseId: string, duties: readonly StallionDuty[]): StallionDuty | undefined {
  return duties.find(
    (duty) => duty.horseId === horseId && (isOnDuty(duty) || isActivePlanned(duty)),
  );
}

export interface PreviewMayStallionsInput {
  readonly gameId: string;
  readonly file: ParsedFile;
  readonly choice: ImportChoice;
}

export async function previewMayStallions(
  context: ServiceContext,
  input: PreviewMayStallionsInput,
): Promise<MayStallionRow[]> {
  const { gameId, file, choice } = input;
  const values = file.rows.map(readStallionRow);
  const identityRows = values.map((item) =>
    toIdentityRow(item, inferBirthYear('mayStallions', choice.gameYear, item.age)),
  );
  const duplicates = duplicateAbilityNosIn(identityRows);
  if (duplicates.length > 0) {
    throw new ServiceError(
      'importHalted',
      `檔案內有重複的能力番号，整份不套用：${duplicates
        .map((no) => `0x${no.toString(16).toUpperCase().padStart(4, '0')}`)
        .join('、')}`,
    );
  }

  const [resolutions, allHorses, yearlyList, imports, duties, lines] = await Promise.all([
    resolveIdentities(context.database, gameId, identityRows),
    listHorses(context.database, gameId),
    listStallionYearly(context.database, gameId),
    listImports(context.database, gameId),
    listStallionDuties(context.database, gameId),
    listLines(context.database, gameId),
  ]);
  const lineIdByPosition = new Map(lines.map((line) => [line.position, line.id]));
  const matchedIds = new Set(
    resolutions
      .map((resolution) => matchedHorseId(resolution))
      .filter((id): id is string => id !== undefined),
  );
  const [horses, foals] = await Promise.all([
    getHorsesByIds(context.database, gameId, [...matchedIds]),
    getFoalsByIds(context.database, gameId, [...matchedIds]),
  ]);

  const yearlyByHorse = new Map<string, StallionYearly[]>();
  for (const record of yearlyList) {
    yearlyByHorse.set(record.horseId, [...(yearlyByHorse.get(record.horseId) ?? []), record]);
  }
  const previousOf = (horseId: string | undefined): StallionYearly | undefined => {
    const records = (horseId === undefined ? [] : (yearlyByHorse.get(horseId) ?? [])).filter(
      (record) => record.gameYear < choice.gameYear,
    );
    return records.sort((a, b) => a.gameYear - b.gameYear).at(-1);
  };
  const thisYearOf = (horseId: string | undefined): StallionYearly | undefined =>
    horseId === undefined
      ? undefined
      : yearlyByHorse.get(horseId)?.find((record) => record.gameYear === choice.gameYear);

  const fileRows = values.map((item, index): MayStallionRow => {
    const resolution = resolutions[index] ?? { kind: 'new' as const };
    const classified = classifyFileRow(item, resolution, horses, foals);
    const writes = classified.outcome === 'apply';
    return {
      key: String(item.lineNumber),
      lineNumber: item.lineNumber,
      label: item.fullName ?? `第 ${String(item.lineNumber)} 行`,
      outcome: classified.outcome,
      issues: classified.issues,
      disposition: classified.disposition,
      values: item,
      birthYear: identityRows[index]?.birthYear,
      horseId: classified.horseId,
      horse: classified.horseId === undefined ? undefined : horses.get(classified.horseId),
      foal: classified.horseId === undefined ? undefined : foals.get(classified.horseId),
      fills: classified.fills,
      snapshot: writes ? snapshotOf(item) : undefined,
      yearly: thisYearOf(classified.horseId),
      previousYearly: previousOf(classified.horseId),
      duty: undefined,
      lineId: undefined,
    };
  });

  const lastYear = lastStallionYearOf(imports, choice.gameYear);
  const absentRows = allHorses
    .filter(
      (horse) =>
        horse.stallionListing !== undefined &&
        horse.stallionListing.inactiveSince === undefined &&
        horse.stallionListing.lastSeenYear >= lastYear &&
        !matchedIds.has(horse.id),
    )
    .map((horse): MayStallionRow => {
      const duty = dutyOfAbsent(horse.id, duties);
      const retiring = duty !== undefined;
      return {
        key: `horse:${horse.id}`,
        label: horse.fullName ?? horse.officialName ?? horse.id,
        // 標示非現役只是一個旗標；結束八系任期要使用者確認過才做（需求規格 11.8、STL-10）。
        outcome: retiring ? 'warn' : 'apply',
        issues: [retiring ? ISSUES.absentRetired : ISSUES.absentInactive],
        disposition: retiring ? 'retired' : 'inactive',
        values: undefined,
        birthYear: horse.birthYear,
        horseId: horse.id,
        horse,
        foal: undefined,
        fills: {},
        snapshot: undefined,
        yearly: undefined,
        previousYearly: undefined,
        duty,
        lineId: duty === undefined ? undefined : lineIdByPosition.get(duty.position),
      };
    });

  return [...fileRows, ...absentRows];
}

/**
 * 逐匹更正缺席者的處置（需求規格 11.8）。只改處置，其他欄位照舊；更正成非現役時
 * 不結束任期，所以連任期一起拿掉。
 */
export function withAbsentOverrides(
  rows: readonly MayStallionRow[],
  overrides: ReadonlyMap<string, AbsentDisposition>,
): MayStallionRow[] {
  return rows.map((row) => {
    const override = overrides.get(row.key);
    if (
      override === undefined ||
      (row.disposition !== 'inactive' && row.disposition !== 'retired')
    ) {
      return row;
    }
    const retiring = override === 'retired' && row.duty !== undefined;
    return {
      ...row,
      outcome: retiring ? 'warn' : 'apply',
      disposition: retiring ? 'retired' : 'inactive',
      issues: [retiring ? ISSUES.absentRetired : ISSUES.absentInactive],
      duty: retiring ? row.duty : undefined,
    };
  });
}

/** 年度資料與前一份相同時這次不寫（需求規格 11.8、STL-11）。 */
function keepsYearly(row: MayStallionRow): boolean {
  if (row.snapshot === undefined) {
    return false;
  }
  if (row.yearly !== undefined) {
    return true;
  }
  return row.previousYearly === undefined || !sameSnapshot(row.previousYearly, row.snapshot);
}

export function summariseStallionRows(rows: readonly MayStallionRow[]): MayStallionsOverview {
  const count = (disposition: StallionDisposition) =>
    rows.filter((row) => row.disposition === disposition).length;
  return {
    total: rows.length,
    continuing: count('continuing'),
    newStallion: count('newStallion'),
    becameStallion: count('becameStallion'),
    inactive: count('inactive'),
    retired: count('retired'),
    conflict: count('conflict'),
    unmatched: count('unmatched'),
    unchangedYearly: rows.filter((row) => row.snapshot !== undefined && !keepsYearly(row)).length,
  };
}

interface BuildContext {
  readonly gameYear: number;
  readonly newId: () => string;
  readonly occurredAt: string;
}

/** 補齊空白的父母與父系，記下這一階段的馬番号，並更新在表紀錄（需求規格 6.4、11.8）。 */
function updatedHorse(row: MayStallionRow, build: BuildContext): Horse {
  const { values } = row;
  const fullName = values?.fullName ?? row.label;
  const base: Horse = row.horse ?? {
    id: build.newId(),
    sex: 'male',
    ...(values?.abilityNo === undefined ? {} : { abilityNo: values.abilityNo }),
    ...(row.birthYear === undefined ? {} : { birthYear: row.birthYear }),
    fullName,
    baseName: values?.baseName ?? toBaseName(fullName),
    stageNumbers: [],
    aliases: [],
  };
  // 手動新增的舊紀錄可能沒有能力番号或出生年，唯一配對到就補上（需求規格 6.2、ID-07）。
  const filled: Horse = {
    ...base,
    ...(base.abilityNo === undefined && values?.abilityNo !== undefined
      ? { abilityNo: values.abilityNo }
      : {}),
    ...(base.birthYear === undefined && row.birthYear !== undefined
      ? { birthYear: row.birthYear }
      : {}),
    ...row.fills,
    stallionListing: { lastSeenYear: build.gameYear },
    ...(row.disposition === 'becameStallion'
      ? { fate: { kind: 'becameStallion' as const, gameYear: build.gameYear } }
      : {}),
  };
  return values?.horseNo === undefined
    ? filled
    : withStageNumber(filled, importedStageNumber('mayStallions', values.horseNo, build.gameYear));
}

function yearlyRecord(row: MayStallionRow, horseId: string, build: BuildContext): StallionYearly {
  return {
    // 同一年已有紀錄就沿用同一筆：[gameId, horseId, gameYear] 是唯一索引。
    id: row.yearly?.id ?? build.newId(),
    horseId,
    gameYear: build.gameYear,
    ...row.snapshot,
  };
}

interface Written {
  readonly records: CollectionRecord[];
  readonly events: HistoryEvent[];
}

function applyRow(row: MayStallionRow, build: BuildContext): Written {
  const records: CollectionRecord[] = [];
  const events: HistoryEvent[] = [];
  // 衝突與未配對不寫入（需求規格 11.8）。selectRows 已經依預覽分類濾掉，這裡是第二道，
  // 免得之後有人改了分類卻忘了這裡。
  if (row.disposition === 'conflict' || row.disposition === 'unmatched') {
    return { records, events };
  }
  const event = (type: HistoryEvent['type'], payload: Partial<HistoryEvent>) =>
    userEvent(
      { newId: build.newId },
      { subjectId: '', type, gameYear: build.gameYear, occurredAt: build.occurredAt, ...payload },
    );

  if (row.disposition === 'inactive' || row.disposition === 'retired') {
    const horse = row.horse;
    if (horse === undefined) {
      return { records, events };
    }
    const listing = {
      lastSeenYear: horse.stallionListing?.lastSeenYear ?? build.gameYear - 1,
      inactiveSince: build.gameYear,
    };
    records.push({ collection: 'horses', record: { ...horse, stallionListing: listing } });
    events.push(
      event('stallionListingChanged', {
        subjectId: horse.id,
        before: { ...horse.stallionListing },
        after: { ...listing },
      }),
    );
    const { duty } = row;
    if (row.disposition === 'retired' && duty !== undefined) {
      const ended: StallionDuty =
        duty.role === 'current'
          ? { ...duty, dutyStatus: 'retired', endYear: build.gameYear }
          : { ...duty, endYear: build.gameYear };
      records.push({ collection: 'stallionDuties', record: ended });
      events.push(
        duty.role === 'current'
          ? event('stallionDutyChanged', {
              subjectId: horse.id,
              before: { dutyStatus: duty.dutyStatus },
              after: { dutyStatus: 'retired', endYear: build.gameYear },
            })
          : event('plannedSuccessorChanged', {
              subjectId: row.lineId ?? horse.id,
              before: { readiness: duty.readiness },
              after: { endYear: build.gameYear },
            }),
      );
    }
    return { records, events };
  }

  const horse = updatedHorse(row, build);
  records.push({ collection: 'horses', record: horse });
  // 非現役的馬重新出現在總表：標示消失也是狀態轉換，留一筆事件（需求規格 11.8）。
  if (row.horse?.stallionListing?.inactiveSince !== undefined) {
    events.push(
      event('stallionListingChanged', {
        subjectId: horse.id,
        before: { ...row.horse.stallionListing },
        after: { lastSeenYear: build.gameYear },
      }),
    );
  }
  if (row.disposition === 'becameStallion') {
    events.push(
      event('becameStallion', {
        subjectId: horse.id,
        after: row.values?.horseNo === undefined ? {} : { stallionNo: row.values.horseNo },
      }),
    );
  }
  if (keepsYearly(row)) {
    records.push({ collection: 'stallionYearly', record: yearlyRecord(row, horse.id, build) });
  }
  return { records, events };
}

/** 這次匯入會寫到的資料表。 */
export const MAY_STALLIONS_COLLECTIONS = ['horses', 'stallionYearly', 'stallionDuties'] as const;

export function buildMayStallions(
  rows: readonly MayStallionRow[],
  build: BuildContext,
): { readonly records: readonly CollectionRecord[]; readonly events: readonly HistoryEvent[] } {
  const records: CollectionRecord[] = [];
  const events: HistoryEvent[] = [];
  for (const row of rows) {
    const written = applyRow(row, build);
    records.push(...written.records);
    events.push(...written.events);
  }
  return { records, events };
}

/**
 * 五月種牡馬總表（需求規格 11.8）：身分配對、年度快照、自家生產種牡馬連結、離場偵測，
 * 父母與父系只補空白。不建立八系位置，不更換現任，也不指定預定後繼（5.1、11.2）。
 */
export function mayStallionsImportHandler(): ImportHandler<MayStallionRow> {
  return {
    type: 'mayStallions',
    collections: [...MAY_STALLIONS_COLLECTIONS],
    preview: (context, game, file, choice) =>
      previewMayStallions(context, { gameId: game.id, file, choice }),
    build: ({ rows, choice, newId, occurredAt }) =>
      buildMayStallions(rows, { gameYear: choice.gameYear, newId, occurredAt }),
  };
}
