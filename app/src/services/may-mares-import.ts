import type { Foal } from '../domain/foal.ts';
import { establishGeneration, type Line } from '../domain/line.ts';
import type { MareYearly } from '../domain/mare-yearly.ts';
import type { HistoryEvent } from '../domain/history-event.ts';
import type { JsonValue } from '../domain/json.ts';
import type { Horse } from '../domain/horse.ts';
import { DEFAULT_GAME_SETTINGS } from '../domain/game.ts';
import { inferBirthYear } from '../domain/identity.ts';
import type { PreviewIssue, PreviewOutcome, PreviewRow } from '../domain/import-batch.ts';
import {
  isMareSite,
  MARE_SITES,
  reachesRetirementAge,
  type Mare,
  type MareSite,
} from '../domain/mare.ts';
import { readBroodmareRow, type BroodmareValues } from '../import/broodmare.ts';
import { isPrefixOnlyName } from '../import/values.ts';
import type { ParsedFile } from '../import/parse.ts';
import { readGameSettings } from '../storage/games.ts';
import { getHorsesByIds } from '../storage/horses.ts';
import { listFoals } from '../storage/foals.ts';
import { listImports } from '../storage/imports.ts';
import { listMares } from '../storage/mares.ts';
import { listMareYearly } from '../storage/mare-yearly.ts';
import { listLines } from '../storage/lines.ts';
import { listSystemMapEntries } from '../storage/system-map.ts';
import { loadOwnMareState } from '../storage/succession.ts';
import type { CollectionRecord } from '../storage/imports.ts';
import { withStageNumber, toBaseName } from '../domain/horse.ts';
import { userEvent } from './events.ts';
import { importedStageNumber } from './import-identity.ts';
import { planConversion, type ConvertPreview } from './succession.ts';
import type { ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import {
  duplicateAbilityNosIn,
  resolveIdentities,
  type IdentityResolution,
  type IdentityRow,
} from './import-identity.ts';
import type { ImportChoice, ImportHandler } from './imports.ts';

/**
 * 預覽的處置（需求規格 11.5、MAY-02）。轉場是「繼續在圈」的附加狀態而不是另一種處置，
 * 所以另外用 `transferred` 標示；摘要把它算在繼續在圈之內，再單獨列一個轉場筆數。
 */
export type MayDisposition =
  | 'continuing'
  | 'newOwnFoal'
  | 'newOther'
  | 'returning'
  | 'retired'
  | 'sold'
  | 'unmatched'
  | 'conflict';

export interface MayMareRow extends PreviewRow {
  readonly disposition: MayDisposition;
  /** 檔案列才有；缺席的母馬沒有。 */
  readonly values: BroodmareValues | undefined;
  readonly birthYear: number | undefined;
  /** 配對到的既有馬匹。 */
  readonly horseId: string | undefined;
  /** 據點變更（需求規格 11.5「轉場」）。 */
  readonly transferred: boolean;
  /** 自家產駒的系與代數（MAY-09）；自由配種所生沒有。 */
  readonly lineage: { readonly position: number; readonly generation: number } | undefined;
  /** 自由配種所生：生產中並標示不可成為後繼，不入八系母馬群（MAY-10）。 */
  readonly freeBred: boolean;
  /** 只補空白欄；與既有不同的欄位列在這裡並略過該筆（MAY-05）。 */
  readonly fills: BloodFills;
  readonly site: MareSite | undefined;
  /** 套用時要更新的既有紀錄；預覽時一次讀出來，套用在單一交易內只做同步運算。 */
  readonly horse: Horse | undefined;
  readonly mare: Mare | undefined;
  /** 這個匯入年已有的年度資料；有的話沿用同一筆的 id（`[gameId, horseId, gameYear]` 唯一）。 */
  readonly yearly: MareYearly | undefined;
  /** 新進自家產駒依 8.9 算出的母馬群與接替狀態（MAY-09）；走 succession 的同一套規則。 */
  readonly conversion: ConvertPreview | undefined;
  readonly foal: Foal | undefined;
  /** 轉入會讓該代成立時要更新的系位置（需求規格 8.2）。 */
  readonly line: Line | undefined;
  /** 父系在系統對照表裡查不到（LINE-05）：預覽可補登親系統，未補登仍可匯入。 */
  readonly subsystemUnregistered: boolean;
}

export interface BloodFills {
  readonly sireName?: string;
  readonly damName?: string;
  readonly sireSubsystem?: string;
  readonly femaleLine?: string;
}

export interface MayMaresOverview {
  readonly total: number;
  /** 據點分布（MAY-02）。 */
  readonly sites: Readonly<Record<MareSite, number>>;
  readonly continuing: number;
  /** 轉場筆數，已含在 continuing 之內。 */
  readonly transferred: number;
  readonly newOwnFoal: number;
  readonly newOther: number;
  readonly returning: number;
  readonly retired: number;
  readonly sold: number;
  readonly unmatched: number;
  readonly conflict: number;
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
  conceptionPending: {
    code: 'conceptionPending',
    message: '五月不建立正式受胎結果，待 7 月確認',
    handling: 'confirm',
  },
  unassignedPurpose: {
    code: 'unassignedPurpose',
    message: '待指定用途，指定前不進入任務',
    handling: 'confirm',
  },
  subsystemUnregistered: {
    code: 'subsystemUnregistered',
    message: '父系尚未登錄在系統對照表，可在預覽補登親系統；未補登仍會匯入',
    handling: 'confirm',
  },
  freeBredFoal: {
    code: 'freeBredFoal',
    message: '自由配種所生，不入八系母馬群且不可成為後繼',
    handling: 'confirm',
  },
} as const satisfies Readonly<Record<string, PreviewIssue>>;

/** 五月總表只含據點 32～35 的自家母馬；出現其他或缺少繋養牧場番号就整份停止（MAY-01）。 */
function checkSites(rows: readonly BroodmareValues[]): void {
  const bad = rows.filter((row) => row.farmNo === undefined || !isMareSite(row.farmNo));
  if (bad.length === 0) {
    return;
  }
  const detail = bad
    .slice(0, 5)
    .map(
      (row) =>
        `第 ${String(row.lineNumber)} 行${row.farmNo === undefined ? '缺少繋養牧場番号' : `為 ${String(row.farmNo)}`}`,
    )
    .join('、');
  throw new ServiceError(
    'importHalted',
    `五月繁殖牝馬總表只含據點 32～35 的自家母馬，共 ${String(bad.length)} 筆超出範圍：${detail}`,
  );
}

function toIdentityRow(values: BroodmareValues, birthYear: number | undefined): IdentityRow {
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

/**
 * 父馬、母馬、父系與牝系只補空白；與既有不同為衝突（MAY-05）。父系保存原文，不寫成替代系。
 *
 * 已經連到內部馬匹的父母不補也不比對：`sireId`／`damId` 是這一局裡的事實，總表的父馬欄只是
 * 遊戲當下的顯示名稱。拿名稱去覆蓋或推翻一個已連結的父母，只會讓資料互相矛盾。
 */
function compareBlood(
  values: BroodmareValues,
  horse: Horse | undefined,
): { readonly fills: BloodFills; readonly conflict: boolean } {
  const fills: Record<string, string> = {};
  let conflict = false;
  const fields = [
    ['sireName', values.sireName, horse?.sireName, horse?.sireId !== undefined],
    ['damName', values.damName, horse?.damName, horse?.damId !== undefined],
    ['sireSubsystem', values.sireSubsystem, horse?.sireSubsystem, false],
    ['femaleLine', values.femaleLine, horse?.femaleLine, false],
  ] as const;
  for (const [field, incoming, existing, linked] of fields) {
    if (incoming === undefined || linked) {
      continue;
    }
    if (existing === undefined) {
      fills[field] = incoming;
    } else if (existing.trim() !== incoming.trim()) {
      conflict = true;
    }
  }
  return { fills, conflict };
}

interface Classified {
  readonly disposition: MayDisposition;
  readonly outcome: PreviewOutcome;
  readonly issues: readonly PreviewIssue[];
  readonly horseId: string | undefined;
  readonly transferred: boolean;
  readonly lineage: MayMareRow['lineage'];
  readonly freeBred: boolean;
  readonly fills: BloodFills;
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

function classifyFileRow(
  values: BroodmareValues,
  resolution: IdentityResolution,
  site: MareSite,
  mares: ReadonlyMap<string, Mare>,
  foals: ReadonlyMap<string, Foal>,
  horses: ReadonlyMap<string, Horse>,
): Classified {
  const base = {
    transferred: false,
    lineage: undefined,
    freeBred: false,
    fills: {},
  } as const;
  if (isPrefixOnlyName(values.fullName)) {
    return {
      ...base,
      disposition: 'unmatched',
      outcome: 'skip',
      issues: [ISSUES.prefixOnlyName],
      horseId: undefined,
    };
  }
  if (resolution.kind === 'ambiguous') {
    return {
      ...base,
      disposition: 'unmatched',
      outcome: 'review',
      issues: [ISSUES.identityAmbiguous],
      horseId: undefined,
    };
  }
  if (resolution.kind === 'conflict') {
    return {
      ...base,
      disposition: 'conflict',
      outcome: 'review',
      issues: [ISSUES.identityConflict],
      horseId: resolution.horse.id,
    };
  }
  const horseId = matchedHorseId(resolution);
  const horse = horseId === undefined ? undefined : horses.get(horseId);
  const { fills, conflict } = compareBlood(values, horse);
  const pending = values.status === undefined ? [] : [ISSUES.conceptionPending];
  if (conflict) {
    return {
      ...base,
      disposition: 'conflict',
      outcome: 'review',
      issues: [ISSUES.bloodConflict],
      horseId,
    };
  }
  const mare = horseId === undefined ? undefined : mares.get(horseId);
  if (mare !== undefined) {
    return mare.status === 'producing'
      ? {
          ...base,
          disposition: 'continuing',
          outcome: 'apply',
          issues: pending,
          horseId,
          transferred: mare.site !== site,
          fills,
        }
      : {
          ...base,
          disposition: 'returning',
          outcome: 'apply',
          issues: pending,
          horseId,
          fills,
        };
  }
  const foal = horseId === undefined ? undefined : foals.get(horseId);
  if (foal !== undefined) {
    return {
      ...base,
      disposition: 'newOwnFoal',
      outcome: 'apply',
      issues: [...pending, ...(foal.freeBred ? [ISSUES.freeBredFoal] : [])],
      horseId,
      lineage: foal.freeBred ? undefined : foal.lineage,
      freeBred: foal.freeBred,
      fills,
    };
  }
  return {
    ...base,
    disposition: 'newOther',
    outcome: 'apply',
    issues: [...pending, ISSUES.unassignedPurpose],
    horseId,
    fills,
  };
}

/**
 * 上年在圈、今年缺席（需求規格 11.5、MARE-09）：依上次五月的馬齡判斷，
 * 達定年預設定年引退，否則售出。定年取目前設定，所以改設定會影響下一次匯入（MARE-10）。
 */
function classifyAbsent(
  mare: Mare,
  horse: Horse | undefined,
  lastMayYear: number,
  retirementAge: number,
): MayDisposition {
  const age = horse?.birthYear === undefined ? undefined : lastMayYear - horse.birthYear;
  return reachesRetirementAge(age, retirementAge) ? 'retired' : 'sold';
}

/**
 * 缺席者的處置逐匹更正（需求規格 11.5、MARE-09）：預設值由上次五月的馬齡決定，
 * 使用者在預覽改過的以這裡為準。回傳新的列，不改原本的預覽。
 */
export function withAbsentOverrides(
  rows: readonly MayMareRow[],
  overrides: ReadonlyMap<string, 'retired' | 'sold'>,
): MayMareRow[] {
  return rows.map((row) => {
    const next = overrides.get(row.key);
    if (next === undefined || (row.disposition !== 'retired' && row.disposition !== 'sold')) {
      return row;
    }
    return { ...row, disposition: next };
  });
}

/** 檔案裡出現、但系統對照表沒有的子系統（LINE-05）；預覽用來提供補登入口。 */
export function unknownSubsystemsOf(rows: readonly MayMareRow[]): string[] {
  return [
    ...new Set(
      rows
        .filter((row) => row.subsystemUnregistered)
        .map((row) => row.values?.sireSubsystem)
        .filter((name): name is string => name !== undefined),
    ),
  ];
}

export function summariseMayRows(rows: readonly MayMareRow[]): MayMaresOverview {
  // 據點分布講的是這份檔案裡的繁殖牝馬圈，缺席的母馬不在檔案裡，不計入（需求規格 11.5）。
  const fileRows = rows.filter((row) => row.values !== undefined);
  const sites: Record<MareSite, number> = { 32: 0, 33: 0, 34: 0, 35: 0 };
  for (const site of MARE_SITES) {
    sites[site] = fileRows.filter((row) => row.site === site).length;
  }
  const count = (disposition: MayDisposition) =>
    rows.filter((row) => row.disposition === disposition).length;
  return {
    total: fileRows.length,
    sites,
    continuing: count('continuing'),
    transferred: rows.filter((row) => row.transferred).length,
    newOwnFoal: count('newOwnFoal'),
    newOther: count('newOther'),
    returning: count('returning'),
    retired: count('retired'),
    sold: count('sold'),
    unmatched: count('unmatched'),
    conflict: count('conflict'),
  };
}

/** 最近一次五月繁殖牝馬總表的年份；還沒有匯入過時用這次匯入年減 1。 */
function lastMayYearOf(imports: readonly { type: string; gameYear: number }[], gameYear: number) {
  const years = imports
    .filter((batch) => batch.type === 'mayMares' && batch.gameYear < gameYear)
    .map((batch) => batch.gameYear);
  return years.length === 0 ? gameYear - 1 : Math.max(...years);
}

export async function previewMayMares(
  context: ServiceContext,
  gameId: string,
  file: ParsedFile,
  choice: ImportChoice,
): Promise<MayMareRow[]> {
  const values = file.rows.map(readBroodmareRow);
  checkSites(values);
  const identityRows = values.map((item) =>
    toIdentityRow(item, inferBirthYear('mayMares', choice.gameYear, item.age)),
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

  const [resolutions, mareList, foalList, settings, imports, yearlyList, lineList, systemMap] =
    await Promise.all([
      resolveIdentities(context.database, gameId, identityRows),
      listMares(context.database, gameId),
      listFoals(context.database, gameId),
      readGameSettings(context.database, gameId),
      listImports(context.database, gameId),
      listMareYearly(context.database, gameId),
      listLines(context.database, gameId),
      listSystemMapEntries(context.database, gameId),
    ]);
  const mares = new Map(mareList.map((mare) => [mare.id, mare]));
  const foals = new Map(foalList.map((foal) => [foal.id, foal]));
  const matchedIds = new Set(
    resolutions
      .map((resolution) => matchedHorseId(resolution))
      .filter((id): id is string => id !== undefined),
  );
  const horses = await getHorsesByIds(context.database, gameId, [
    ...new Set([...matchedIds, ...mareList.map((mare) => mare.id)]),
  ]);

  const linesByPosition = new Map(lineList.map((line) => [line.position, line]));
  const registeredSubsystems = new Set(systemMap.map((entry) => entry.subsystem));
  const yearlyByHorse = new Map(
    yearlyList
      .filter((record) => record.gameYear === choice.gameYear)
      .map((record) => [record.horseId, record]),
  );

  // 新進自家產駒走 succession 的同一套規則（需求規格 11.5、MAY-09）：預覽先算，套用只組紀錄。
  const conversions = new Map<string, ConvertPreview | undefined>();
  const conversionIssues = new Map<string | undefined, readonly string[]>();
  for (const [index, item] of values.entries()) {
    const horseId = matchedHorseId(resolutions[index] ?? { kind: 'new' });
    const foal = horseId === undefined ? undefined : foals.get(horseId);
    if (horseId === undefined || foal === undefined || foal.freeBred || mares.has(horseId)) {
      continue;
    }
    const state = await loadOwnMareState(context.database, gameId, horseId);
    const plan = planConversion(state, { foalId: horseId, site: item.farmNo ?? Number.NaN });
    conversions.set(horseId, plan.preview);
    conversionIssues.set(horseId, plan.issues);
  }

  const fileRows = values.map((item, index): MayMareRow => {
    const resolution = resolutions[index] ?? { kind: 'new' as const };
    // checkSites 已經確認過每一列的據點都在 32～35。
    const site = isMareSite(item.farmNo ?? Number.NaN) ? (item.farmNo as MareSite) : 32;
    const classified = classifyFileRow(item, resolution, site, mares, foals, horses);
    const conversion =
      classified.horseId === undefined ? undefined : conversions.get(classified.horseId);
    const blocked =
      classified.disposition === 'newOwnFoal' && !classified.freeBred && conversion === undefined;
    const blockIssues = blocked
      ? [
          {
            code: 'conversionBlocked',
            message: `不能轉入母馬群：${(conversionIssues.get(classified.horseId) ?? []).join('；')}`,
            handling: 'confirm' as const,
          },
        ]
      : [];
    const unregistered =
      item.sireSubsystem !== undefined && !registeredSubsystems.has(item.sireSubsystem);
    return {
      key: String(item.lineNumber),
      lineNumber: item.lineNumber,
      label: item.fullName ?? `第 ${String(item.lineNumber)} 行`,
      outcome: blocked ? 'review' : classified.outcome,
      issues: [
        ...classified.issues,
        ...blockIssues,
        ...(unregistered ? [ISSUES.subsystemUnregistered] : []),
      ],
      disposition: classified.disposition,
      values: item,
      birthYear: identityRows[index]?.birthYear,
      horseId: classified.horseId,
      transferred: classified.transferred,
      lineage: classified.lineage,
      freeBred: classified.freeBred,
      fills: classified.fills,
      site,
      horse: classified.horseId === undefined ? undefined : horses.get(classified.horseId),
      mare: classified.horseId === undefined ? undefined : mares.get(classified.horseId),
      yearly: classified.horseId === undefined ? undefined : yearlyByHorse.get(classified.horseId),
      conversion,
      foal: classified.horseId === undefined ? undefined : foals.get(classified.horseId),
      line: conversion === undefined ? undefined : linesByPosition.get(conversion.group.position),
      subsystemUnregistered: unregistered,
    };
  });

  const retirementAge = settings?.retirementAge ?? DEFAULT_GAME_SETTINGS.retirementAge;
  const lastMayYear = lastMayYearOf(imports, choice.gameYear);
  const absentRows = mareList
    .filter((mare) => mare.status === 'producing' && !matchedIds.has(mare.id))
    .map((mare): MayMareRow => {
      const horse = horses.get(mare.id);
      const disposition = classifyAbsent(mare, horse, lastMayYear, retirementAge);
      return {
        key: `mare:${mare.id}`,
        label: horse?.fullName ?? horse?.officialName ?? mare.id,
        outcome: 'apply',
        issues: [
          {
            code: disposition === 'retired' ? 'absentRetired' : 'absentSold',
            message:
              disposition === 'retired'
                ? `上次五月（${String(lastMayYear)} 年）已達定年 ${String(retirementAge)} 歲，預設定年引退`
                : '五月總表沒有這匹母馬，預設售出',
            handling: 'confirm',
          },
        ],
        disposition,
        values: undefined,
        birthYear: horse?.birthYear,
        horseId: mare.id,
        transferred: false,
        lineage: undefined,
        freeBred: false,
        fills: {},
        site: mare.site,
        horse,
        mare,
        yearly: yearlyByHorse.get(mare.id),
        conversion: undefined,
        foal: undefined,
        line: undefined,
        subsystemUnregistered: false,
      };
    });

  return [...fileRows, ...absentRows];
}

interface BuildContext {
  readonly gameYear: number;
  readonly newId: () => string;
  readonly occurredAt: string;
}

function groupValue(group: Mare['group']): JsonValue {
  return group.kind === 'unassigned'
    ? { kind: group.kind }
    : { kind: group.kind, position: group.position, generation: group.generation };
}

/** 補齊空白的父母與父系，並記下這一階段的馬番号（需求規格 6.4、MAY-06）。 */
function updatedHorse(row: MayMareRow, build: BuildContext): Horse {
  const { values } = row;
  const fullName = values?.fullName ?? row.label;
  const base: Horse = row.horse ?? {
    id: build.newId(),
    sex: 'female',
    ...(values?.abilityNo === undefined ? {} : { abilityNo: values.abilityNo }),
    ...(row.birthYear === undefined ? {} : { birthYear: row.birthYear }),
    fullName,
    baseName: values?.baseName ?? toBaseName(fullName),
    stageNumbers: [],
    aliases: [],
  };
  const filled: Horse = { ...base, ...row.fills };
  return values?.horseNo === undefined
    ? filled
    : withStageNumber(filled, importedStageNumber('mayMares', values.horseNo, build.gameYear));
}

/** 5 月活力快照、仔出、繁殖年數與頭數（需求規格 11.5、MAY-07、MAY-08、MARE-14、MARE-15）。 */
function yearlyRecord(row: MayMareRow, horseId: string, build: BuildContext): MareYearly {
  const { values } = row;
  return {
    // 同一年已有紀錄就沿用同一筆：[gameId, horseId, gameYear] 是唯一索引。
    id: row.yearly?.id ?? build.newId(),
    horseId,
    gameYear: build.gameYear,
    // 7 月的快照不因為重匯五月而消失（MARE-15）。
    ...(row.yearly?.vitalityJuly === undefined ? {} : { vitalityJuly: row.yearly.vitalityJuly }),
    ...(values?.vitality === undefined ? {} : { vitalityMay: values.vitality }),
    ...(values?.kodashi === undefined ? {} : { kodashi: values.kodashi }),
    ...(values?.breedingYears === undefined ? {} : { breedingYears: values.breedingYears }),
    ...(values?.breedingCount === undefined ? {} : { breedingCount: values.breedingCount }),
  };
}

interface Written {
  readonly records: CollectionRecord[];
  readonly events: HistoryEvent[];
}

function applyRow(row: MayMareRow, build: BuildContext): Written {
  const records: CollectionRecord[] = [];
  const events: HistoryEvent[] = [];
  const event = (type: HistoryEvent['type'], payload: Partial<HistoryEvent>) =>
    userEvent(
      { newId: build.newId },
      { subjectId: '', type, gameYear: build.gameYear, occurredAt: build.occurredAt, ...payload },
    );

  if (row.disposition === 'retired' || row.disposition === 'sold') {
    const mare = row.mare;
    if (mare === undefined) {
      return { records, events };
    }
    const leftReason = row.disposition === 'retired' ? 'retired' : 'sold';
    records.push({
      collection: 'mares',
      record: { ...mare, status: 'left' as const, leftReason },
    });
    events.push(
      event(row.disposition === 'retired' ? 'mareRetired' : 'mareSold', {
        subjectId: mare.id,
        before: { status: 'producing' },
        after: { status: 'left', leftReason },
      }),
    );
    return { records, events };
  }

  const horse = updatedHorse(row, build);
  records.push({ collection: 'horses', record: horse });
  records.push({ collection: 'mareYearly', record: yearlyRecord(row, horse.id, build) });

  switch (row.disposition) {
    case 'continuing': {
      const mare = row.mare;
      if (mare === undefined) {
        break;
      }
      records.push({ collection: 'mares', record: { ...mare, site: row.site ?? mare.site } });
      if (row.transferred) {
        events.push(
          event('mareTransferred', {
            subjectId: mare.id,
            before: { site: mare.site },
            after: { site: row.site ?? mare.site },
          }),
        );
      }
      break;
    }
    case 'returning': {
      const mare = row.mare;
      if (mare === undefined) {
        break;
      }
      // 沿用原識別、血緣、自身父系、母馬群與代數；只恢復在圈狀態與據點（需求規格 11.5）。
      // 回到生產中就不該再有離圈原因，所以是重建而不是覆寫。
      const revived: Mare = {
        id: mare.id,
        group: mare.group,
        origin: mare.origin,
        ...(mare.originNote === undefined ? {} : { originNote: mare.originNote }),
        status: 'producing',
        site: row.site ?? mare.site,
        ...(mare.succession === undefined ? {} : { succession: mare.succession }),
        ...(mare.yearPlan === undefined ? {} : { yearPlan: mare.yearPlan }),
      };
      records.push({ collection: 'mares', record: revived });
      events.push(
        event('mareReturned', {
          subjectId: mare.id,
          before: {
            status: 'left',
            ...(mare.leftReason === undefined ? {} : { leftReason: mare.leftReason }),
          },
          after: {
            status: 'producing',
            site: row.site ?? mare.site,
            group: groupValue(mare.group),
          },
        }),
      );
      break;
    }
    case 'newOwnFoal': {
      const { conversion } = row;
      const group: Mare['group'] = conversion?.group ?? { kind: 'unassigned' };
      const mare: Mare = {
        id: horse.id,
        group,
        origin: 'ownRetired',
        status: 'producing',
        site: row.site ?? 32,
        ...(conversion === undefined ? {} : { succession: conversion.succession }),
      };
      records.push({ collection: 'mares', record: mare });
      events.push(
        event('mareAdded', {
          subjectId: horse.id,
          after: {
            group: groupValue(group),
            origin: mare.origin,
            site: mare.site,
            ...(conversion === undefined ? {} : { succession: conversion.succession }),
          },
        }),
      );
      // 轉入後產駒的處置固定為保留（需求規格 8.9，與手動轉入同一套規則）。
      if (row.foal !== undefined && row.foal.disposition !== 'keep' && conversion !== undefined) {
        records.push({
          collection: 'foals',
          record: { ...row.foal, disposition: 'keep' as const },
        });
        events.push(
          event('foalChanged', {
            subjectId: row.foal.id,
            before: { disposition: row.foal.disposition },
            after: { disposition: 'keep' },
          }),
        );
      }
      const established =
        conversion?.establishes === true && row.line !== undefined
          ? establishGeneration(row.line, conversion.group.generation, build.gameYear)
          : undefined;
      if (established !== undefined) {
        records.push({ collection: 'lines', record: established });
        events.push(
          event('lineGenerationEstablished', {
            subjectId: established.id,
            after: { generation: conversion?.group.generation ?? 0, mareId: horse.id },
          }),
        );
      }
      break;
    }
    case 'newOther': {
      // 不猜測系、代數或自身父系：生產中、待指定用途（需求規格 11.5、MAY-03）。
      const mare: Mare = {
        id: horse.id,
        group: { kind: 'unassigned' },
        origin: 'other',
        status: 'producing',
        site: row.site ?? 32,
      };
      records.push({ collection: 'mares', record: mare });
      events.push(
        event('mareAdded', {
          subjectId: horse.id,
          after: { group: groupValue(mare.group), origin: mare.origin, site: mare.site },
        }),
      );
      break;
    }
    default:
      break;
  }
  return { records, events };
}

/** 這次匯入會寫到的資料表。 */
export const MAY_MARES_COLLECTIONS = ['horses', 'mares', 'mareYearly', 'foals', 'lines'] as const;

export function buildMayMares(
  rows: readonly MayMareRow[],
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
 * 五月繁殖牝馬總表（需求規格 11.5）：繁殖牝馬圈對帳、據點、活力快照、仔出、繁殖年數與頭數、
 * 補齊父母與父系、繁殖牝馬馬番号。不建立正式受胎結果，也不把父系寫成替代系（11.2）。
 */
export function mayMaresImportHandler(): ImportHandler<MayMareRow> {
  return {
    type: 'mayMares',
    collections: [...MAY_MARES_COLLECTIONS],
    preview: (context, game, file, choice) => previewMayMares(context, game.id, file, choice),
    build: ({ rows, choice, newId, occurredAt }) =>
      buildMayMares(rows, { gameYear: choice.gameYear, newId, occurredAt }),
  };
}
