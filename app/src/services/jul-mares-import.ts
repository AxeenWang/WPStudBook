import {
  expectedBirthYearFor,
  isConception,
  type Breeding,
  type BreedingPedigreeCheck,
  type BreedingRuleSnapshot,
  type BreedingType,
  type Conception,
} from '../domain/breeding.ts';
import type { HistoryEvent } from '../domain/history-event.ts';
import type { Horse } from '../domain/horse.ts';
import { withStageNumber } from '../domain/horse.ts';
import { inferBirthYear } from '../domain/identity.ts';
import type { PreviewIssue, PreviewOutcome, PreviewRow } from '../domain/import-batch.ts';
import { isMareSite, type Mare, type MareSite } from '../domain/mare.ts';
import type { MareYearly, Vitality } from '../domain/mare-yearly.ts';
import type { PedigreeWarningCode } from '../domain/pedigree-check.ts';
import { isOnDuty, type StallionDuty } from '../domain/stallion-duty.ts';
import {
  CONCEPTION_STATUSES,
  readBroodmareRow,
  type BroodmareValues,
} from '../import/broodmare.ts';
import type { ParsedFile } from '../import/parse.ts';
import { isPrefixOnlyName } from '../import/values.ts';
import { listBreedings } from '../storage/breedings.ts';
import { getHorsesByIds } from '../storage/horses.ts';
import type { CollectionRecord } from '../storage/imports.ts';
import { listMares } from '../storage/mares.ts';
import { listMareYearly } from '../storage/mare-yearly.ts';
import { listStallionDuties } from '../storage/stallion-duties.ts';
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
import { matchStallionNames } from './stallion-names.ts';
import { listLineTasks, resolveTaskBreeding } from './tasks.ts';

/**
 * 預覽的處置（需求規格 11.6）。七月只確認受胎結果，不動繁殖牝馬圈：配對不到的列是待處理，
 * 五月在圈而七月缺席的母馬只列出核對（JUL-02）。
 */
export type JulDisposition =
  /** 既有繁殖紀錄，更新受胎狀態與實際種牡馬。 */
  | 'update'
  /** 該年沒有繁殖紀錄且不是空胎 → 由七月資料自動建立（JUL-07、JUL-08）。 */
  | 'create'
  /** 既有的八系指定配種與實際種牡馬不符 → 確認後依實際保存並標示偏離（JUL-04）。 */
  | 'deviate'
  /** 空胎且沒有既有紀錄：只保存活力快照，不建立繁殖紀錄。 */
  | 'vitalityOnly'
  /** 無法唯一配對五月名單；不建立馬匹（需求規格 11.6）。 */
  | 'unmatched'
  /** 五月在圈、七月缺席：只列出核對，不移出繁殖牝馬圈（JUL-02）。 */
  | 'absent'
  | 'conflict';

/** 自動建立的配種類型與要保存的規則快照（JUL-07、JUL-08）。 */
export interface AutoBreedingPlan {
  readonly breedingType: BreedingType;
  readonly ruleSnapshot?: BreedingRuleSnapshot;
  readonly pedigreeCheck?: BreedingPedigreeCheck;
  readonly confirmations?: readonly string[];
}

export interface JulMareRow extends PreviewRow {
  readonly disposition: JulDisposition;
  /** 檔案列才有；七月缺席的母馬沒有。 */
  readonly values: BroodmareValues | undefined;
  readonly birthYear: number | undefined;
  readonly horseId: string | undefined;
  readonly horse: Horse | undefined;
  readonly mare: Mare | undefined;
  readonly site: MareSite | undefined;
  /** `状態`；缺席與未配對的列沒有。 */
  readonly conception: Conception | undefined;
  /** `種付け種牡馬` 對應到的內部種牡馬；對應不到時保留 `stallionName`。 */
  readonly stallionId: string | undefined;
  readonly stallionName: string | undefined;
  /** 這個匯入年已有的繁殖紀錄。 */
  readonly breeding: Breeding | undefined;
  /** 自動建立時的類型與規則快照。 */
  readonly plan: AutoBreedingPlan | undefined;
  /** 只補空白欄；與既有不同的欄位列在這裡並略過該筆（JUL-05）。 */
  readonly fills: BloodFills;
  /** 7 月活力快照；五月的仔出、繁殖年數與頭數不覆寫（JUL-03）。 */
  readonly vitality: Vitality | undefined;
  /** 這個匯入年已有的年度資料；有的話沿用同一筆的 id。 */
  readonly yearly: MareYearly | undefined;
}

export interface JulMaresOverview {
  readonly total: number;
  /** 依四種 `状態` 統計（需求規格 11.6）。 */
  readonly conceptions: Readonly<Record<Conception, number>>;
  readonly update: number;
  readonly create: number;
  readonly deviate: number;
  readonly vitalityOnly: number;
  readonly unmatched: number;
  readonly absent: number;
  readonly conflict: number;
}

const ISSUES = {
  identityAmbiguous: {
    code: 'identityAmbiguous',
    message: '有多筆名稱相符的既有紀錄，無法唯一配對，列為待處理',
    handling: 'confirm',
  },
  identityNew: {
    code: 'identityNew',
    message: '五月名單裡沒有這匹母馬，七月不建立馬匹，列為待處理',
    handling: 'confirm',
  },
  identityConflict: {
    code: 'identityConflict',
    message: '與既有紀錄的身分不符，略過這一筆',
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
  notInHerd: {
    code: 'notInHerd',
    message: '配對到的馬不在繁殖牝馬圈；七月不改變繁殖牝馬圈，列為待處理',
    handling: 'confirm',
  },
  unconfirmed: {
    code: 'unconfirmed',
    message: '七月仍是未確認，保留原狀態；可能是異常，不推定結果',
    handling: 'confirm',
  },
  absent: {
    code: 'absent',
    message: '五月在圈、七月缺席，只列出核對，不移出繁殖牝馬圈',
    handling: 'confirm',
  },
  linkedFoal: {
    code: 'linkedFoal',
    message: '這一年的繁殖紀錄已連結產駒，不能改變受胎狀態或種牡馬，略過這一筆',
    handling: 'confirm',
  },
  deviated: {
    code: 'deviated',
    message: '實際種牡馬與既有的八系指定配種不符，確認後依實際保存並標示偏離規則',
    handling: 'confirm',
  },
} as const satisfies Record<string, PreviewIssue>;

function halted(problem: string): ServiceError {
  return new ServiceError('importHalted', `匯入停止，資料不變：${problem}`);
}

/** `状態` 出現四種以外的文字 → 整份停止（需求規格 11.6、JUL-06）。 */
function checkConceptions(rows: readonly BroodmareValues[]): void {
  const bad = rows.filter((row) => row.status !== undefined && !isConception(row.status));
  if (bad.length === 0) {
    return;
  }
  const detail = bad
    .slice(0, 5)
    .map((row) => `第 ${String(row.lineNumber)} 行為「${row.status ?? ''}」`)
    .join('、');
  throw halted(
    `\`状態\` 只能是 ${CONCEPTION_STATUSES.join('、')}，共 ${String(bad.length)} 筆不是：${detail}`,
  );
}

/** 同五月總表的範圍驗證：七月總表只含自家牧場的母馬（需求規格 11.5、11.6）。 */
function checkSites(rows: readonly BroodmareValues[]): void {
  const bad = rows.filter((row) => row.farmNo === undefined || !isMareSite(row.farmNo));
  if (bad.length === 0) {
    return;
  }
  const detail = bad
    .slice(0, 5)
    .map(
      (row) =>
        `第 ${String(row.lineNumber)} 行${
          row.farmNo === undefined ? '缺少繋養牧場番号' : `為 ${String(row.farmNo)}`
        }`,
    )
    .join('、');
  throw halted(
    `七月繁殖牝馬總表只含據點 32～35 的自家母馬，共 ${String(bad.length)} 筆超出範圍：${detail}`,
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
  readonly disposition: JulDisposition;
  readonly outcome: PreviewOutcome;
  readonly issues: PreviewIssue[];
  readonly horseId: string | undefined;
  readonly fills: BloodFills;
}

/**
 * 只判斷身分與血統；受胎與繁殖紀錄的處置在 `decideBreeding` 決定，因為那要先知道
 * 種牡馬對應與既有紀錄。
 */
function classifyIdentity(
  values: BroodmareValues,
  resolution: IdentityResolution,
  horses: ReadonlyMap<string, Horse>,
  mares: ReadonlyMap<string, Mare>,
): Classified {
  const pending = (issue: PreviewIssue, horseId?: string): Classified => ({
    disposition: 'unmatched',
    outcome: 'review',
    issues: [issue],
    horseId,
    fills: {},
  });
  if (isPrefixOnlyName(values.fullName)) {
    return {
      disposition: 'conflict',
      outcome: 'skip',
      issues: [ISSUES.prefixOnlyName],
      horseId: undefined,
      fills: {},
    };
  }
  if (resolution.kind === 'ambiguous') {
    return pending(ISSUES.identityAmbiguous);
  }
  // 七月不建立馬匹（需求規格 11.6）：五月名單裡沒有的母馬只列為待處理。
  if (resolution.kind === 'new') {
    return pending(ISSUES.identityNew);
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
  const horse = horses.get(resolution.horse.id) ?? resolution.horse;
  const mare = mares.get(horse.id);
  if (mare === undefined || mare.status !== 'producing') {
    return pending(ISSUES.notInHerd, horse.id);
  }
  const { fills, conflict } = compareBlood(values, horse);
  if (conflict) {
    return {
      disposition: 'conflict',
      outcome: 'skip',
      issues: [ISSUES.bloodConflict],
      horseId: horse.id,
      fills: {},
    };
  }
  return { disposition: 'update', outcome: 'apply', issues: [], horseId: horse.id, fills };
}

/** 已連結產駒的紀錄不能改受胎與種牡馬（同 `saveBreeding` 的規則）。 */
function changesLinkedFoal(
  breeding: Breeding | undefined,
  conception: Conception | undefined,
  stallionId: string | undefined,
  stallionName: string | undefined,
): boolean {
  if (breeding?.foalId === undefined) {
    return false;
  }
  return (
    conception !== '受胎' ||
    breeding.stallionId !== stallionId ||
    breeding.stallionName !== stallionName
  );
}

interface BreedingDecision {
  readonly disposition: JulDisposition;
  readonly outcome: PreviewOutcome;
  readonly issues: readonly PreviewIssue[];
}

/**
 * 決定這一列要對繁殖紀錄做什麼（需求規格 11.6）。自動建立與偏離都要使用者確認過才寫入
 * （JUL-04、JUL-09），所以列為警告。
 */
function decideBreeding(
  conception: Conception | undefined,
  breeding: Breeding | undefined,
  stallionId: string | undefined,
  stallionName: string | undefined,
  plan: AutoBreedingPlan | undefined,
): BreedingDecision {
  const unconfirmed = conception === '未確認' ? [ISSUES.unconfirmed] : [];
  if (changesLinkedFoal(breeding, conception, stallionId, stallionName)) {
    return { disposition: 'conflict', outcome: 'skip', issues: [ISSUES.linkedFoal] };
  }
  if (breeding === undefined) {
    if (conception === undefined || conception === '空胎') {
      return { disposition: 'vitalityOnly', outcome: 'apply', issues: unconfirmed };
    }
    const type = plan?.breedingType === 'designated' ? '八系指定配種' : '自由配種';
    return {
      disposition: 'create',
      outcome: 'warn',
      issues: [
        ...unconfirmed,
        {
          code: 'autoBreeding',
          message: `這一年還沒有繁殖紀錄，會依七月資料自動建立${type}`,
          handling: 'confirm',
        },
      ],
    };
  }
  // 既有的八系指定配種與實際種牡馬不符（JUL-04）。
  const differs =
    breeding.ruleSnapshot !== undefined &&
    (breeding.stallionId ?? breeding.stallionName) !== (stallionId ?? stallionName);
  if (differs) {
    return { disposition: 'deviate', outcome: 'warn', issues: [...unconfirmed, ISSUES.deviated] };
  }
  return {
    disposition: 'update',
    outcome: unconfirmed.length > 0 ? 'warn' : 'apply',
    issues: unconfirmed,
  };
}

/** 在崗現任的系與代數 → 馬匹，用來判斷「正是任務指定的種牡馬」（JUL-07）。 */
function onDutyByLineage(duties: readonly StallionDuty[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const duty of duties) {
    if (isOnDuty(duty)) {
      map.set(`${String(duty.position)}:${String(duty.generation)}`, duty.horseId);
    }
  }
  return map;
}

export interface PreviewJulMaresInput {
  readonly gameId: string;
  readonly file: ParsedFile;
  readonly choice: ImportChoice;
}

export async function previewJulMares(
  context: ServiceContext,
  input: PreviewJulMaresInput,
): Promise<JulMareRow[]> {
  const { gameId, file, choice } = input;
  const values = file.rows.map(readBroodmareRow);
  checkSites(values);
  checkConceptions(values);
  const identityRows = values.map((item) =>
    toIdentityRow(item, inferBirthYear('julMares', choice.gameYear, item.age)),
  );
  const duplicates = duplicateAbilityNosIn(identityRows);
  if (duplicates.length > 0) {
    throw halted(
      `檔案內有重複的能力番号：${duplicates
        .map((no) => `0x${no.toString(16).toUpperCase().padStart(4, '0')}`)
        .join('、')}`,
    );
  }

  const [resolutions, mareList, breedingList, yearlyList, duties, tasks, stallionNames] =
    await Promise.all([
      resolveIdentities(context.database, gameId, identityRows),
      listMares(context.database, gameId),
      listBreedings(context.database, gameId),
      listMareYearly(context.database, gameId),
      listStallionDuties(context.database, gameId),
      listLineTasks(context),
      matchStallionNames(
        context.database,
        gameId,
        values
          .map((item) => item.matedStallionName)
          .filter((name): name is string => name !== undefined),
      ),
    ]);
  const mares = new Map(mareList.map((mare) => [mare.id, mare]));
  const matchedIds = new Set(
    resolutions
      .map((resolution) => matchedHorseId(resolution))
      .filter((id): id is string => id !== undefined),
  );
  const horses = await getHorsesByIds(context.database, gameId, [
    ...new Set([...matchedIds, ...mareList.map((mare) => mare.id)]),
  ]);
  const breedingByMare = new Map(
    breedingList
      .filter((record) => record.gameYear === choice.gameYear)
      .map((record) => [record.mareId, record]),
  );
  const yearlyByHorse = new Map(
    yearlyList
      .filter((record) => record.gameYear === choice.gameYear)
      .map((record) => [record.horseId, record]),
  );
  const dutyLineages = onDutyByLineage(duties);

  const fileRows: JulMareRow[] = [];
  for (const [index, item] of values.entries()) {
    const resolution = resolutions[index] ?? { kind: 'new' as const };
    const identity = classifyIdentity(item, resolution, horses, mares);
    const conception =
      item.status !== undefined && isConception(item.status) ? item.status : undefined;
    const name = item.matedStallionName;
    const stallionId = name === undefined ? undefined : stallionNames.get(name.trim());
    const stallionName = stallionId === undefined ? name : undefined;
    const breeding =
      identity.horseId === undefined ? undefined : breedingByMare.get(identity.horseId);

    // 只有要寫入的列才去算自動建立的類型：那會跑血統檢查，配對不到的列不必付這個成本。
    const plan =
      identity.disposition === 'update' &&
      breeding === undefined &&
      conception !== undefined &&
      conception !== '空胎' &&
      identity.horseId !== undefined
        ? await planAutoBreeding(context, identity.horseId, stallionId, tasks, dutyLineages)
        : undefined;
    const decision =
      identity.disposition === 'update'
        ? decideBreeding(conception, breeding, stallionId, stallionName, plan)
        : {
            disposition: identity.disposition,
            outcome: identity.outcome,
            issues: identity.issues,
          };

    fileRows.push({
      key: String(item.lineNumber),
      lineNumber: item.lineNumber,
      label: item.fullName ?? `第 ${String(item.lineNumber)} 行`,
      outcome: decision.outcome,
      issues: [...identity.issues, ...decision.issues.filter((i) => !identity.issues.includes(i))],
      disposition: decision.disposition,
      values: item,
      birthYear: identityRows[index]?.birthYear,
      horseId: identity.horseId,
      horse: identity.horseId === undefined ? undefined : horses.get(identity.horseId),
      mare: identity.horseId === undefined ? undefined : mares.get(identity.horseId),
      site: isMareSite(item.farmNo ?? Number.NaN) ? (item.farmNo as MareSite) : undefined,
      conception,
      stallionId,
      stallionName,
      breeding,
      plan: decision.disposition === 'create' ? plan : undefined,
      fills: identity.fills,
      vitality: item.vitality,
      yearly: identity.horseId === undefined ? undefined : yearlyByHorse.get(identity.horseId),
    });
  }

  // 五月在圈、七月缺席：只列出核對（JUL-02）。
  const absentRows = mareList
    .filter((mare) => mare.status === 'producing' && !matchedIds.has(mare.id))
    .map((mare): JulMareRow => {
      const horse = horses.get(mare.id);
      return {
        key: `mare:${mare.id}`,
        label: horse?.fullName ?? horse?.officialName ?? mare.id,
        outcome: 'review',
        issues: [ISSUES.absent],
        disposition: 'absent',
        values: undefined,
        birthYear: horse?.birthYear,
        horseId: mare.id,
        horse,
        mare,
        site: mare.site,
        conception: undefined,
        stallionId: undefined,
        stallionName: undefined,
        breeding: breedingByMare.get(mare.id),
        plan: undefined,
        fills: {},
        vitality: undefined,
        yearly: yearlyByHorse.get(mare.id),
      };
    });

  return [...fileRows, ...absentRows];
}

/**
 * 自動建立的配種類型（JUL-07、JUL-08）：實際種牡馬正是某個任務的在崗現任、而且這匹母馬
 * 通得過該任務的系代與血統檢查時是八系指定配種，其餘都是自由配種。
 *
 * 血統警告在這裡先接受，因為預覽會把它們列給使用者確認，套用時再由匯入的確認閘擋一次。
 */
async function planAutoBreeding(
  context: ServiceContext,
  mareId: string,
  stallionId: string | undefined,
  tasks: readonly {
    readonly id: string;
    readonly sire: { position: number; generation: number };
  }[],
  dutyLineages: ReadonlyMap<string, string>,
): Promise<AutoBreedingPlan> {
  if (stallionId === undefined) {
    return { breedingType: 'free' };
  }
  const candidates = tasks.filter(
    (task) =>
      dutyLineages.get(`${String(task.sire.position)}:${String(task.sire.generation)}`) ===
      stallionId,
  );
  for (const task of candidates) {
    try {
      const resolved = await resolveTaskBreeding(context, {
        taskId: task.id,
        mareId,
        stallionId,
        acceptedWarnings: ALL_PEDIGREE_WARNINGS,
      });
      return {
        breedingType: 'designated',
        ruleSnapshot: resolved.ruleSnapshot,
        ...(resolved.pedigreeCheck === undefined ? {} : { pedigreeCheck: resolved.pedigreeCheck }),
        ...(resolved.confirmations.length === 0 ? {} : { confirmations: resolved.confirmations }),
      };
    } catch {
      // 系或代數不符：這匹母馬不屬於這個任務，換下一個候選任務。
    }
  }
  return { breedingType: 'free' };
}

/** 血統警告的代號；預覽負責讓使用者看到，這裡先接受才拿得到規則快照。 */
const ALL_PEDIGREE_WARNINGS: readonly PedigreeWarningCode[] = [
  'activationBelowFull',
  'duplicateAncestors',
  'insufficientPedigree',
];

export function summariseJulRows(rows: readonly JulMareRow[]): JulMaresOverview {
  const count = (disposition: JulDisposition) =>
    rows.filter((row) => row.disposition === disposition).length;
  const conceptions: Record<Conception, number> = {
    空胎: 0,
    受胎: 0,
    不受胎: 0,
    未確認: 0,
  };
  for (const row of rows) {
    if (row.conception !== undefined) {
      conceptions[row.conception] += 1;
    }
  }
  return {
    total: rows.length,
    conceptions,
    update: count('update'),
    create: count('create'),
    deviate: count('deviate'),
    vitalityOnly: count('vitalityOnly'),
    unmatched: count('unmatched'),
    absent: count('absent'),
    conflict: count('conflict'),
  };
}

interface BuildContext {
  readonly gameYear: number;
  readonly newId: () => string;
  readonly occurredAt: string;
}

/** 補齊空白的父母與父系，並記下這一階段的馬番号（需求規格 6.4、JUL-05）。 */
function updatedHorse(row: JulMareRow, build: BuildContext): Horse | undefined {
  const { horse, values } = row;
  if (horse === undefined) {
    return undefined;
  }
  const filled: Horse = { ...horse, ...row.fills };
  const numbered =
    values?.horseNo === undefined
      ? filled
      : withStageNumber(filled, importedStageNumber('julMares', values.horseNo, build.gameYear));
  return JSON.stringify(numbered) === JSON.stringify(horse) ? undefined : numbered;
}

/** 7 月活力快照；五月的仔出、繁殖年數與頭數不覆寫（需求規格 11.6、JUL-03）。 */
function yearlyRecord(row: JulMareRow, horseId: string, build: BuildContext): MareYearly {
  return {
    id: row.yearly?.id ?? build.newId(),
    horseId,
    gameYear: build.gameYear,
    ...(row.yearly?.vitalityMay === undefined ? {} : { vitalityMay: row.yearly.vitalityMay }),
    ...(row.yearly?.kodashi === undefined ? {} : { kodashi: row.yearly.kodashi }),
    ...(row.yearly?.breedingYears === undefined ? {} : { breedingYears: row.yearly.breedingYears }),
    ...(row.yearly?.breedingCount === undefined ? {} : { breedingCount: row.yearly.breedingCount }),
    ...(row.vitality === undefined ? {} : { vitalityJuly: row.vitality }),
  };
}

function breedingRecord(row: JulMareRow, horseId: string, build: BuildContext): Breeding {
  const { breeding, conception } = row;
  const base = {
    id: breeding?.id ?? build.newId(),
    mareId: horseId,
    gameYear: build.gameYear,
    ...(row.stallionId === undefined ? {} : { stallionId: row.stallionId }),
    ...(row.stallionName === undefined ? {} : { stallionName: row.stallionName }),
    ...(conception === undefined ? {} : { conception }),
  };
  const expectedBirthYear = expectedBirthYearFor(build.gameYear, conception);
  const timing = expectedBirthYear === undefined ? {} : { expectedBirthYear };
  if (row.disposition === 'create') {
    const plan = row.plan ?? { breedingType: 'free' as const };
    return {
      ...base,
      breedingType: plan.breedingType,
      ...timing,
      ...(plan.ruleSnapshot === undefined ? {} : { ruleSnapshot: plan.ruleSnapshot }),
      ...(plan.pedigreeCheck === undefined ? {} : { pedigreeCheck: plan.pedigreeCheck }),
      ...(plan.confirmations === undefined ? {} : { confirmations: plan.confirmations }),
    };
  }
  // 偏離：規則快照留著（看得出是依哪個任務登記的），但血統檢查是對「原本要配的那匹」算的，
  // 留著只會誤導，所以拿掉；產駒的系與代數在確認出生時依實際父母重新推導（JUL-04）。
  if (row.disposition === 'deviate') {
    return {
      ...base,
      breedingType: breeding?.breedingType ?? 'designated',
      ...timing,
      ...(breeding?.ruleSnapshot === undefined ? {} : { ruleSnapshot: breeding.ruleSnapshot }),
      deviated: true,
    };
  }
  return {
    ...base,
    breedingType: breeding?.breedingType ?? 'free',
    ...timing,
    ...(breeding?.foalId === undefined ? {} : { foalId: breeding.foalId }),
    ...(breeding?.ruleSnapshot === undefined ? {} : { ruleSnapshot: breeding.ruleSnapshot }),
    ...(breeding?.pedigreeCheck === undefined ? {} : { pedigreeCheck: breeding.pedigreeCheck }),
    ...(breeding?.confirmations === undefined ? {} : { confirmations: breeding.confirmations }),
    ...(breeding?.deviated === undefined ? {} : { deviated: breeding.deviated }),
  };
}

interface Written {
  readonly records: CollectionRecord[];
  readonly events: HistoryEvent[];
}

const WRITES_BREEDING: readonly JulDisposition[] = ['update', 'create', 'deviate'];

function applyRow(row: JulMareRow, build: BuildContext): Written {
  const records: CollectionRecord[] = [];
  const events: HistoryEvent[] = [];
  const horseId = row.horseId;
  // 待處理、缺席與衝突都不寫（需求規格 11.6）。selectRows 已經依預覽分類濾掉，這裡是第二道。
  if (
    horseId === undefined ||
    row.disposition === 'unmatched' ||
    row.disposition === 'absent' ||
    row.disposition === 'conflict'
  ) {
    return { records, events };
  }
  const event = (type: HistoryEvent['type'], payload: Partial<HistoryEvent>) =>
    userEvent(
      { newId: build.newId },
      { subjectId: '', type, gameYear: build.gameYear, occurredAt: build.occurredAt, ...payload },
    );

  const horse = updatedHorse(row, build);
  if (horse !== undefined) {
    records.push({ collection: 'horses', record: horse });
  }
  records.push({ collection: 'mareYearly', record: yearlyRecord(row, horseId, build) });

  if (WRITES_BREEDING.includes(row.disposition)) {
    const record = breedingRecord(row, horseId, build);
    records.push({ collection: 'breedings', record });
    events.push(
      event('breedingRecorded', {
        subjectId: horseId,
        after: {
          breedingType: record.breedingType,
          ...(record.conception === undefined ? {} : { conception: record.conception }),
          ...(record.deviated === true ? { deviated: '是' } : {}),
        },
      }),
    );
  }
  return { records, events };
}

/** 這次匯入會寫到的資料表。 */
export const JUL_MARES_COLLECTIONS = ['horses', 'mareYearly', 'breedings'] as const;

export function buildJulMares(
  rows: readonly JulMareRow[],
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
 * 七月繁殖牝馬總表（需求規格 11.6）：正式受胎與實際種牡馬、自動建立缺少的配種紀錄、
 * 7 月活力快照、補齊空白的父母與父系。不重新對帳繁殖牝馬圈、不覆寫五月年度資料（11.2）。
 */
export function julMaresImportHandler(): ImportHandler<JulMareRow> {
  return {
    type: 'julMares',
    collections: [...JUL_MARES_COLLECTIONS],
    preview: (context, game, file, choice) =>
      previewJulMares(context, { gameId: game.id, file, choice }),
    build: ({ rows, choice, newId, occurredAt }) =>
      buildJulMares(rows, { gameYear: choice.gameYear, newId, occurredAt }),
  };
}
