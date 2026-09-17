import type { Foal } from '../domain/foal.ts';
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
import type { ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import {
  duplicateAbilityNosIn,
  resolveIdentities,
  type IdentityResolution,
  type IdentityRow,
} from './import-identity.ts';
import type { ImportChoice } from './imports.ts';

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

/** 父馬、母馬、父系與牝系只補空白；與既有不同為衝突（MAY-05）。父系保存原文，不寫成替代系。 */
function compareBlood(
  values: BroodmareValues,
  horse: Horse | undefined,
): { readonly fills: BloodFills; readonly conflict: boolean } {
  const fills: Record<string, string> = {};
  let conflict = false;
  const fields = [
    ['sireName', values.sireName, horse?.sireName],
    ['damName', values.damName, horse?.damName],
    ['sireSubsystem', values.sireSubsystem, horse?.sireSubsystem],
    ['femaleLine', values.femaleLine, horse?.femaleLine],
  ] as const;
  for (const [field, incoming, existing] of fields) {
    if (incoming === undefined) {
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

  const [resolutions, mareList, foalList, settings, imports] = await Promise.all([
    resolveIdentities(context.database, gameId, identityRows),
    listMares(context.database, gameId),
    listFoals(context.database, gameId),
    readGameSettings(context.database, gameId),
    listImports(context.database, gameId),
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

  const fileRows = values.map((item, index): MayMareRow => {
    const resolution = resolutions[index] ?? { kind: 'new' as const };
    // checkSites 已經確認過每一列的據點都在 32～35。
    const site = isMareSite(item.farmNo ?? Number.NaN) ? (item.farmNo as MareSite) : 32;
    const classified = classifyFileRow(item, resolution, site, mares, foals, horses);
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
      transferred: classified.transferred,
      lineage: classified.lineage,
      freeBred: classified.freeBred,
      fills: classified.fills,
      site,
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
      };
    });

  return [...fileRows, ...absentRows];
}
