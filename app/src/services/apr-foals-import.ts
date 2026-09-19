import type { Breeding } from '../domain/breeding.ts';
import type { Game } from '../domain/game.ts';
import { subParamTotal, type Foal } from '../domain/foal.ts';
import type { HistoryEvent } from '../domain/history-event.ts';
import { withStageNumber, type Horse } from '../domain/horse.ts';
import type { PreviewIssue, PreviewRow } from '../domain/import-batch.ts';
import { isMareSite } from '../domain/mare.ts';
import { readAprFoalRow, type AprFoalValues } from '../import/apr-foal.ts';
import type { ParsedFile } from '../import/parse.ts';
import { isPrefixOnlyName } from '../import/values.ts';
import { listBreedings } from '../storage/breedings.ts';
import { loadFoalBirthState, type FoalBirthState } from '../storage/foals.ts';
import { findHorsesByName, getHorsesByIds } from '../storage/horses.ts';
import type { CollectionRecord } from '../storage/imports.ts';
import { listMares } from '../storage/mares.ts';
import type { ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import { buildFoalRecords, planFoal, type FoalInput, type FoalPlan } from './foals.ts';
import { requireCurrentGame } from './games.ts';
import type { ImportChoice, ImportHandler } from './imports.ts';
import { importedStageNumber } from './import-identity.ts';
import { matchStallionNames } from './stallion-names.ts';

/** 自家牧場的馬主番号（需求規格 11.4、APR-04）。 */
export const OWNER_NUMBERS: readonly number[] = [46, 47];

/**
 * 預覽的處置（需求規格 11.4）。
 *
 * `review` 的兩種（待核對、未見產駒）預設不寫入；使用者逐匹確認後才比照自由配種產駒建立
 * （APR-03）。同母同年已有手動產駒時只補齊空白，不建第二匹（APR-07）。
 */
export type AprDisposition =
  /** 母馬、父馬與前一年受胎紀錄唯一相符 → 建立幼駒（APR-02）。 */
  | 'create'
  /** 母馬不在管理資料或沒有相符受胎紀錄 → 待核對（APR-03）。 */
  | 'review'
  /** 待核對經使用者確認 → 比照自由配種產駒建立。 */
  | 'confirmed'
  /** 同母同年已有手動產駒，可唯一確認 → 補齊空白（APR-07）。 */
  | 'fill'
  /** 前年受胎但檔案沒有對應幼駒 → 未見產駒，不改受胎結果（APR-05）。 */
  | 'missing'
  | 'conflict';

export interface AprFoalRow extends PreviewRow {
  readonly disposition: AprDisposition;
  /** 檔案列才有；未見產駒的列沒有。 */
  readonly values: AprFoalValues | undefined;
  readonly birthYear: number;
  /** 配對到的管理中母馬。 */
  readonly damId: string | undefined;
  readonly damName: string | undefined;
  /** 前一年的繁殖紀錄；沒有相符紀錄時為 undefined。 */
  readonly breeding: Breeding | undefined;
  /** 預覽時讀出的出生狀態；套用在單一交易內只做同步運算。 */
  readonly state: FoalBirthState | undefined;
  /** 由 `planFoal` 算出的登記計畫；待核對與衝突的列沒有。 */
  readonly plan: FoalPlan | undefined;
  /** 同母同年已有的產駒（補齊或衝突時才有）。 */
  readonly existing: Foal | undefined;
  /** `サ` 與七項副能力換算不符（BRD-11）。 */
  readonly subParamMismatch: boolean;
  /** 待核對的列能不能由使用者確認後建立（APR-03）。 */
  readonly confirmable: boolean;
}

export interface AprFoalsOverview {
  readonly total: number;
  readonly create: number;
  readonly review: number;
  readonly confirmed: number;
  readonly fill: number;
  readonly missing: number;
  readonly conflict: number;
  readonly male: number;
  readonly female: number;
}

const ISSUES = {
  prefixOnlyName: {
    code: 'prefixOnlyName',
    message: '只有 (外) 或 [地] 前綴、沒有馬名，略過這一筆',
    handling: 'confirm',
  },
  damNotFound: {
    code: 'damNotFound',
    message: '母馬不在管理資料裡，列為待核對；確認後比照自由配種產駒建立並連結母馬',
    handling: 'confirm',
  },
  damAmbiguous: {
    code: 'damAmbiguous',
    message: '有多匹同名的管理中母馬，無法唯一配對，列為待核對',
    handling: 'confirm',
  },
  noConception: {
    code: 'noConception',
    message: '前一年沒有相符的受胎紀錄（例如購入時已受胎），列為待核對',
    handling: 'confirm',
  },
  sireDiffers: {
    code: 'sireDiffers',
    message: '父馬與前一年受胎紀錄的種牡馬不同，列為待核對',
    handling: 'confirm',
  },
  missingFoal: {
    code: 'missingFoal',
    message: '前一年受胎，但這份檔案沒有對應的幼駒；不改受胎結果，請人工核對',
    handling: 'confirm',
  },
  existingFoal: {
    code: 'existingFoal',
    message: '同一母馬同一出生年已有產駒且父馬不一致，不建立第二匹',
    handling: 'confirm',
  },
  fill: {
    code: 'fillExistingFoal',
    message: '同一母馬同一出生年已有手動產駒，補齊空白欄位，不建立第二匹',
    handling: 'confirm',
  },
  subParamMismatch: {
    code: 'subParamMismatch',
    message: '`サ` 與七項副能力換算出來的值不同，仍照檔案保存',
    handling: 'confirm',
  },
  planBlocked: {
    code: 'planBlocked',
    message: '無法登記產駒',
    handling: 'confirm',
  },
} as const satisfies Record<string, PreviewIssue>;

function halted(problem: string): ServiceError {
  return new ServiceError('importHalted', `匯入停止，資料不變：${problem}`);
}

/** `年` 為 0、性別為牡／牝、馬主番号 46／47、牧場 32～35，否則整份停止（需求規格 11.4、APR-04）。 */
function checkRange(rows: readonly AprFoalValues[]): void {
  const problems: string[] = [];
  const ages = rows.filter((row) => row.age !== 0);
  if (ages.length > 0) {
    problems.push(`${String(ages.length)} 筆的 \`年\` 不是 0`);
  }
  const sexes = rows.filter((row) => row.sex === undefined);
  if (sexes.length > 0) {
    problems.push(`${String(sexes.length)} 筆的 \`性\` 不是 牡 或 牝`);
  }
  const owners = rows.filter(
    (row) => row.ownerNo === undefined || !OWNER_NUMBERS.includes(row.ownerNo),
  );
  if (owners.length > 0) {
    problems.push(
      `${String(owners.length)} 筆的馬主番号不是 ${OWNER_NUMBERS.join(' 或 ')}` +
        `（第 ${owners
          .slice(0, 5)
          .map((row) => String(row.lineNumber))
          .join('、')} 行）`,
    );
  }
  const farms = rows.filter((row) => row.farmNo === undefined || !isMareSite(row.farmNo));
  if (farms.length > 0) {
    problems.push(
      `${String(farms.length)} 筆的繋養牧場番号不在 32～35` +
        `（第 ${farms
          .slice(0, 5)
          .map((row) => String(row.lineNumber))
          .join('、')} 行）`,
    );
  }
  if (problems.length > 0) {
    throw halted(`四月誕生幼駒總表只含自家牧場誕生的 0 歲幼駒：${problems.join('；')}`);
  }
}

/** 繁殖紀錄上的種牡馬名稱（內部種牡馬取顯示名稱）。 */
function breedingSireName(
  breeding: Breeding | undefined,
  stallionNames: ReadonlyMap<string, string>,
): string | undefined {
  if (breeding === undefined) {
    return undefined;
  }
  if (breeding.stallionId !== undefined) {
    for (const [name, id] of stallionNames) {
      if (id === breeding.stallionId) {
        return name;
      }
    }
    return undefined;
  }
  return breeding.stallionName;
}

function foalInputFrom(values: AprFoalValues, birthYear: number, sireName: string): FoalInput {
  return {
    damId: '',
    birthYear,
    sex: values.sex,
    sireName,
    disposition: undefined,
    sp: values.sp,
    st: values.st,
    subParams: values.subParams,
    turf: values.turf,
    dirt: values.dirt,
    distanceText: values.distanceText ?? '',
    kodashi: values.kodashi,
    note: '',
  };
}

/**
 * 套用時的遊戲局：檔案年份晚於目前遊戲年時，套用會先推進年份再寫入（需求規格 11.1、IMP-14），
 * 所以預覽與逐匹確認都要以推進後的年份規劃產駒，否則「出生年不可晚於目前遊戲年」會把每一匹都擋掉。
 */
function atImportYear(game: Game, gameYear: number): Game {
  return gameYear > game.currentYear ? { ...game, currentYear: gameYear } : game;
}

export interface PreviewAprFoalsInput {
  readonly gameId: string;
  readonly file: ParsedFile;
  readonly choice: ImportChoice;
}

export async function previewAprFoals(
  context: ServiceContext,
  input: PreviewAprFoalsInput,
): Promise<AprFoalRow[]> {
  const { gameId, file, choice } = input;
  const game = atImportYear(await requireCurrentGame(context), choice.gameYear);
  const values = file.rows.map(readAprFoalRow);
  checkRange(values);
  // 出生年＝匯出年（需求規格 11.4）。
  const birthYear = choice.gameYear;

  const [mareList, breedingList, stallionNames] = await Promise.all([
    listMares(context.database, gameId),
    listBreedings(context.database, gameId),
    matchStallionNames(
      context.database,
      gameId,
      values.map((item) => item.sireName).filter((name): name is string => name !== undefined),
    ),
  ]);
  const managed = new Set(mareList.filter((mare) => mare.status === 'producing').map((m) => m.id));
  const damNames = await Promise.all(
    values.map((item) =>
      item.damName === undefined
        ? Promise.resolve<Horse[]>([])
        : findHorsesByName(context.database, gameId, item.damName),
    ),
  );

  const rows: AprFoalRow[] = [];
  const usedBreedings = new Set<string>();
  for (const [index, item] of values.entries()) {
    const candidates = (damNames[index] ?? []).filter((horse) => managed.has(horse.id));
    const base = {
      key: String(item.lineNumber),
      lineNumber: item.lineNumber,
      label: item.fullName ?? `第 ${String(item.lineNumber)} 行`,
      values: item,
      birthYear,
      damName: item.damName,
      subParamMismatch:
        item.subParamTotal !== undefined &&
        subParamTotal(item.subParams) !== undefined &&
        subParamTotal(item.subParams) !== item.subParamTotal,
    } as const;
    const extra = base.subParamMismatch ? [ISSUES.subParamMismatch] : [];

    const pending = (issue: PreviewIssue, damId?: string, state?: FoalBirthState): AprFoalRow => ({
      ...base,
      outcome: 'review',
      issues: [issue, ...extra],
      disposition: 'review',
      damId,
      breeding: state?.breeding,
      state,
      plan: undefined,
      existing: undefined,
      // 父馬與受胎紀錄不一致時不給確認：那要先決定哪一邊才對，不是匯入能替使用者選的。
      confirmable: issue.code !== ISSUES.sireDiffers.code && damId !== undefined,
    });

    if (isPrefixOnlyName(item.fullName)) {
      rows.push({
        ...base,
        outcome: 'skip',
        issues: [ISSUES.prefixOnlyName],
        disposition: 'conflict',
        damId: undefined,
        breeding: undefined,
        state: undefined,
        plan: undefined,
        existing: undefined,
        confirmable: false,
      });
      continue;
    }
    if (candidates.length !== 1 || candidates[0] === undefined) {
      rows.push(pending(candidates.length === 0 ? ISSUES.damNotFound : ISSUES.damAmbiguous));
      continue;
    }
    const damId = candidates[0].id;
    const state = await loadFoalBirthState(context.database, gameId, damId, birthYear);
    const conceived = state.breeding?.conception === '受胎';
    if (!conceived) {
      rows.push(pending(ISSUES.noConception, damId, state));
      continue;
    }
    // 這一列已經對應到那筆受胎紀錄，之後就不該再被列成「未見產駒」——即使它因為父馬不一致
    // 而停在待核對，同一匹母馬也不應該同時出現兩種說法。
    usedBreedings.add(state.breeding.id);
    const recorded = breedingSireName(state.breeding, stallionNames);
    if (recorded !== undefined && item.sireName !== undefined && recorded !== item.sireName) {
      rows.push(pending(ISSUES.sireDiffers, damId, state));
      continue;
    }
    if (state.existingFoal !== undefined) {
      // 父馬對得上就是同一匹，補齊空白；對不上不建第二匹（APR-07）。
      rows.push({
        ...base,
        outcome: 'warn',
        issues: [ISSUES.fill, ...extra],
        disposition: 'fill',
        damId,
        breeding: state.breeding,
        state,
        plan: undefined,
        existing: state.existingFoal,
        confirmable: false,
      });
      continue;
    }
    const plan = planFoal(game, state, {
      ...foalInputFrom(item, birthYear, item.sireName ?? ''),
      damId,
    });
    if (plan.issues.length > 0) {
      rows.push({
        ...base,
        outcome: 'skip',
        issues: [
          { ...ISSUES.planBlocked, message: `無法登記產駒：${plan.issues.join('；')}` },
          ...extra,
        ],
        disposition: 'conflict',
        damId,
        breeding: state.breeding,
        state,
        plan: undefined,
        existing: undefined,
        confirmable: false,
      });
      continue;
    }
    rows.push({
      ...base,
      outcome: extra.length > 0 ? 'warn' : 'apply',
      issues: extra,
      disposition: 'create',
      damId,
      breeding: state.breeding,
      state,
      plan,
      existing: undefined,
      confirmable: false,
    });
  }

  // 前年受胎但檔案沒有對應幼駒（APR-05）。
  const damHorses = await getHorsesByIds(context.database, gameId, [...managed]);
  const missing = breedingList
    .filter(
      (record) =>
        record.gameYear === birthYear - 1 &&
        record.conception === '受胎' &&
        record.foalId === undefined &&
        managed.has(record.mareId) &&
        !usedBreedings.has(record.id),
    )
    .map((record): AprFoalRow => {
      const dam = damHorses.get(record.mareId);
      return {
        key: `breeding:${record.id}`,
        label: dam?.fullName ?? dam?.officialName ?? record.mareId,
        outcome: 'review',
        issues: [ISSUES.missingFoal],
        disposition: 'missing',
        values: undefined,
        birthYear,
        damId: record.mareId,
        damName: dam?.fullName,
        breeding: record,
        state: undefined,
        plan: undefined,
        existing: undefined,
        subParamMismatch: false,
        confirmable: false,
      };
    });

  return [...rows, ...missing];
}

/**
 * 逐匹確認待核對的列（需求規格 11.4、APR-03）：確認後比照自由配種產駒建立並連結母馬，
 * 父馬依名稱對照連結或記外部名稱。未見產駒不能確認——那要人工去查，不是匯入能決定的。
 */
export function withReviewConfirmed(
  rows: readonly AprFoalRow[],
  keys: ReadonlySet<string>,
  game: Game,
): AprFoalRow[] {
  return rows.map((row) => {
    if (
      row.disposition !== 'review' ||
      !row.confirmable ||
      !keys.has(row.key) ||
      row.values === undefined ||
      row.damId === undefined ||
      row.state === undefined
    ) {
      return row;
    }
    const plan = planFoal(atImportYear(game, row.birthYear), row.state, {
      ...foalInputFrom(row.values, row.birthYear, row.values.sireName ?? ''),
      damId: row.damId,
    });
    return plan.issues.length > 0
      ? row
      : { ...row, outcome: 'warn' as const, disposition: 'confirmed' as const, plan };
  });
}

export function summariseAprRows(rows: readonly AprFoalRow[]): AprFoalsOverview {
  const count = (disposition: AprDisposition) =>
    rows.filter((row) => row.disposition === disposition).length;
  return {
    total: rows.length,
    create: count('create'),
    review: count('review'),
    confirmed: count('confirmed'),
    fill: count('fill'),
    missing: count('missing'),
    conflict: count('conflict'),
    male: rows.filter((row) => row.values?.sex === 'male').length,
    female: rows.filter((row) => row.values?.sex === 'female').length,
  };
}

interface BuildContext {
  readonly gameYear: number;
  readonly newId: () => string;
  readonly occurredAt: string;
}

/** 補齊既有手動產駒的空白欄位與幼駒馬番号（APR-07）；有值的欄位不覆寫。 */
function filledRecords(row: AprFoalRow, build: BuildContext): CollectionRecord[] {
  const { existing, values, state } = row;
  if (existing === undefined || values === undefined) {
    return [];
  }
  const details: Partial<Foal> = {
    ...(existing.sp === undefined && values.sp !== undefined ? { sp: values.sp } : {}),
    ...(existing.st === undefined && values.st !== undefined ? { st: values.st } : {}),
    ...(existing.subParams === undefined && Object.keys(values.subParams).length > 0
      ? { subParams: values.subParams }
      : {}),
    ...(existing.turf === undefined && values.turf !== undefined ? { turf: values.turf } : {}),
    ...(existing.dirt === undefined && values.dirt !== undefined ? { dirt: values.dirt } : {}),
    ...(existing.distanceText === undefined && values.distanceText !== undefined
      ? { distanceText: values.distanceText }
      : {}),
    ...(existing.kodashi === undefined && values.kodashi !== undefined
      ? { kodashi: values.kodashi }
      : {}),
  };
  const records: CollectionRecord[] = [];
  if (Object.keys(details).length > 0) {
    records.push({ collection: 'foals', record: { ...existing, ...details } });
  }
  const horse = state?.existingFoalHorse;
  if (horse !== undefined && values.horseNo !== undefined) {
    const numbered = withStageNumber(
      horse.abilityNo === undefined && values.abilityNo !== undefined
        ? { ...horse, abilityNo: values.abilityNo }
        : horse,
      importedStageNumber('aprFoals', values.horseNo, build.gameYear),
    );
    if (JSON.stringify(numbered) !== JSON.stringify(horse)) {
      records.push({ collection: 'horses', record: numbered });
    }
  }
  return records;
}

interface Written {
  readonly records: CollectionRecord[];
  readonly events: HistoryEvent[];
}

function applyRow(row: AprFoalRow, build: BuildContext): Written {
  if (row.disposition === 'fill') {
    return { records: filledRecords(row, build), events: [] };
  }
  const { plan, state, damId, values } = row;
  if (
    (row.disposition !== 'create' && row.disposition !== 'confirmed') ||
    plan === undefined ||
    state === undefined ||
    damId === undefined ||
    values === undefined
  ) {
    return { records: [], events: [] };
  }
  const built = buildFoalRecords({
    plan,
    state,
    damId,
    birthYear: row.birthYear,
    sex: values.sex,
    gameYear: build.gameYear,
    newId: build.newId,
    occurredAt: build.occurredAt,
  });
  // 幼駒馬番号與能力番号記在馬匹上（需求規格 6.4、11.4）。
  const horse: Horse = {
    ...built.horse,
    ...(values.abilityNo === undefined ? {} : { abilityNo: values.abilityNo }),
    stageNumbers:
      values.horseNo === undefined
        ? built.horse.stageNumbers
        : [importedStageNumber('aprFoals', values.horseNo, build.gameYear)],
  };
  return {
    records: [
      { collection: 'horses', record: horse },
      { collection: 'foals', record: built.foal },
      ...(built.breeding === undefined
        ? []
        : [{ collection: 'breedings' as const, record: built.breeding }]),
    ],
    events: [...built.events],
  };
}

/** 這次匯入會寫到的資料表。 */
export const APR_FOALS_COLLECTIONS = ['horses', 'foals', 'breedings'] as const;

export function buildAprFoals(
  rows: readonly AprFoalRow[],
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
 * 四月誕生幼駒總表（需求規格 11.4）：建立自家牧場誕生的產駒，保存幼駒馬番号，
 * 連結父母與繁殖紀錄。不猜測父母、不改寫受胎結果（11.2）。
 */
export function aprFoalsImportHandler(): ImportHandler<AprFoalRow> {
  return {
    type: 'aprFoals',
    collections: [...APR_FOALS_COLLECTIONS],
    preview: (context, game, file, choice) =>
      previewAprFoals(context, { gameId: game.id, file, choice }),
    build: ({ rows, choice, newId, occurredAt }) =>
      buildAprFoals(rows, { gameYear: choice.gameYear, newId, occurredAt }),
  };
}
