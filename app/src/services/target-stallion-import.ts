import type { HistoryEvent } from '../domain/history-event.ts';
import { formatAbilityNo, type Horse } from '../domain/horse.ts';
import { inferBirthYear } from '../domain/identity.ts';
import type { PreviewIssue, PreviewRow } from '../domain/import-batch.ts';
import type { Line, LinePosition } from '../domain/line.ts';
import { isOnDuty, type CurrentDuty, type StallionDuty } from '../domain/stallion-duty.ts';
import type { SystemMapEntry } from '../domain/system-map.ts';
import type { ParsedFile } from '../import/parse.ts';
import { readStallionRow, type StallionValues } from '../import/stallion.ts';
import { isPrefixOnlyName } from '../import/values.ts';
import { getHorsesByIds } from '../storage/horses.ts';
import type { CollectionRecord } from '../storage/imports.ts';
import { listLines } from '../storage/lines.ts';
import { listStallionDuties } from '../storage/stallion-duties.ts';
import { listSystemMapEntries } from '../storage/system-map.ts';
import type { ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import { userEvent } from './events.ts';
import { importedStageNumber, resolveIdentities, type IdentityRow } from './import-identity.ts';
import type { ImportChoice, ImportHandler } from './imports.ts';
import {
  buildOpenedLine,
  prepareOpenLine,
  type OpenLineInspection,
  type OpenLineWarningCode,
} from './lines.ts';

/**
 * 這份目標種牡馬 TXT 要做什麼（需求規格 7.1、7.7、11.9）：開啟建立新系的分支，
 * 或替換被遊戲依史實提前引退的零代種牡馬。兩者都不限月份。
 */
export type TargetStallionTarget =
  | {
      readonly kind: 'openLine';
      readonly position: LinePosition;
      /** 留白時取檔案的 `父系`（需求規格 7.1、11.9）。 */
      readonly subsystem: string;
      /** 留白時取系統對照表登錄的親系統。 */
      readonly parentSystem: string;
      readonly color: string;
      readonly acceptedWarnings?: readonly OpenLineWarningCode[] | undefined;
    }
  | {
      readonly kind: 'replaceFounder';
      readonly position: LinePosition;
      /** 已確認子系統與該系不同仍要替換（STL-07）。 */
      readonly acceptedSubsystemChange?: boolean;
    };

export interface TargetStallionRow extends PreviewRow {
  readonly values: StallionValues;
  readonly birthYear: number | undefined;
  /** 五月總表已建立的紀錄，以能力番号＋出生年配對沿用（需求規格 11.9）。 */
  readonly reuse: Horse | undefined;
  readonly position: LinePosition;
  /** 開啟系位置要用的檢查結果；替換時沒有。 */
  readonly inspection: OpenLineInspection | undefined;
  /** 替換時的那一系與要接任的位置。 */
  readonly replacement: ReplacementPlan | undefined;
}

export interface ReplacementPlan {
  readonly line: Line;
  /** 檔案的父系與該系目前子系統不同時要改名（STL-07）。 */
  readonly subsystemChange: { readonly from: string; readonly to: string } | undefined;
  /** 檔案父系沒有登錄在系統對照表（需求規格 7.2、LINE-05）。 */
  readonly subsystemUnregistered: boolean;
}

const ISSUES = {
  notSingleRow: {
    code: 'notSingleRow',
    message: '目標種牡馬 TXT 必須只有一匹',
    handling: 'halt',
  },
  prefixOnlyName: {
    code: 'prefixOnlyName',
    message: '只有 (外) 或 [地] 前綴、沒有馬名',
    handling: 'halt',
  },
  subsystemDiffers: {
    code: 'subsystemDiffers',
    message: '這匹種牡馬的子系統與該系目前的子系統不同，確認後會更新目前子系統名稱',
    handling: 'confirm',
  },
  subsystemUnregistered: {
    code: 'subsystemUnregistered',
    message: '這個子系統還沒登錄在系統對照表，可以之後補登；不補登不影響這次匯入',
    handling: 'confirm',
  },
} as const satisfies Record<string, PreviewIssue>;

function halted(problem: string): ServiceError {
  return new ServiceError('importHalted', `匯入停止，資料不變：${problem}`);
}

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

function issue(code: string, message: string, handling: PreviewIssue['handling']): PreviewIssue {
  return { code, message, handling };
}

/** 替換提前引退的零代種牡馬（需求規格 7.7、STL-06、STL-07）。 */
function planReplacement(
  values: StallionValues,
  position: LinePosition,
  lines: readonly Line[],
  duties: readonly StallionDuty[],
  registeredSubsystems: ReadonlySet<string>,
): { readonly plan: ReplacementPlan | undefined; readonly issues: PreviewIssue[] } {
  const line = lines.find((item) => item.position === position);
  if (line === undefined) {
    return {
      plan: undefined,
      issues: [issue('lineNotOpened', `第 ${String(position)} 系還沒開啟`, 'halt')],
    };
  }
  const founderDuties = duties.filter(
    (duty): duty is CurrentDuty =>
      duty.position === position && duty.generation === 0 && duty.role === 'current',
  );
  const onDuty = founderDuties.find((duty) => isOnDuty(duty));
  if (onDuty !== undefined) {
    return {
      plan: undefined,
      issues: [
        issue(
          'founderStillOnDuty',
          '這一系的零代種牡馬還在崗；先標示他已引退或退出生產行列，再匯入替換的目標種牡馬',
          'halt',
        ),
      ],
    };
  }
  if (founderDuties.length === 0) {
    return {
      plan: undefined,
      issues: [
        issue('noFounderDuty', `第 ${String(position)} 系沒有零代種牡馬的任期可以替換`, 'halt'),
      ],
    };
  }
  const subsystem = values.sireSubsystem;
  const subsystemChange =
    subsystem === undefined || subsystem === line.subsystem
      ? undefined
      : { from: line.subsystem, to: subsystem };
  const unregistered = subsystem !== undefined && !registeredSubsystems.has(subsystem);
  return {
    plan: {
      line,
      subsystemChange,
      subsystemUnregistered: unregistered,
    },
    issues: [
      ...(subsystemChange === undefined
        ? []
        : [
            issue(
              ISSUES.subsystemDiffers.code,
              `${ISSUES.subsystemDiffers.message}（「${subsystemChange.from}」→「${subsystemChange.to}」）；親系統若也不同會影響活血`,
              'confirm',
            ),
          ]),
      ...(unregistered ? [ISSUES.subsystemUnregistered] : []),
    ],
  };
}

export interface PreviewTargetStallionInput {
  readonly gameId: string;
  readonly file: ParsedFile;
  readonly choice: ImportChoice;
  readonly target: TargetStallionTarget;
}

/**
 * 整份只能有一匹；0 匹或 2 匹以上時停止，不寫入（需求規格 11.9、STL-04）。
 * 預覽顯示該馬的能力、父母、父系與要連結的系與分支。
 */
export async function previewTargetStallion(
  context: ServiceContext,
  input: PreviewTargetStallionInput,
): Promise<TargetStallionRow[]> {
  const { gameId, file, choice, target } = input;
  if (file.rows.length !== 1) {
    throw halted(`${ISSUES.notSingleRow.message}，這份有 ${String(file.rows.length)} 匹`);
  }
  const [source] = file.rows;
  if (source === undefined) {
    throw halted(ISSUES.notSingleRow.message);
  }
  const values = readStallionRow(source);
  if (isPrefixOnlyName(values.fullName)) {
    throw halted(ISSUES.prefixOnlyName.message);
  }
  const birthYear = inferBirthYear('targetStallion', choice.gameYear, values.age);

  const [resolutions, lines, duties, systemMap] = await Promise.all([
    resolveIdentities(context.database, gameId, [toIdentityRow(values, birthYear)]),
    listLines(context.database, gameId),
    listStallionDuties(context.database, gameId),
    listSystemMapEntries(context.database, gameId),
  ]);
  const resolution = resolutions[0] ?? { kind: 'new' as const };
  if (resolution.kind === 'conflict') {
    throw halted(`「${values.fullName ?? ''}」與既有紀錄的身分不符`);
  }
  if (resolution.kind === 'ambiguous') {
    throw halted('有多筆名稱相符的既有紀錄，無法唯一配對');
  }
  // 五月總表已建立的紀錄以能力番号＋出生年配對沿用（需求規格 11.9）。
  const reuse =
    resolution.kind === 'new'
      ? undefined
      : ((await getHorsesByIds(context.database, gameId, [resolution.horse.id])).get(
          resolution.horse.id,
        ) ?? resolution.horse);
  const registeredSubsystems = new Set(systemMap.map((entry) => entry.subsystem));

  const base = {
    key: String(values.lineNumber),
    lineNumber: values.lineNumber,
    label: values.fullName ?? `第 ${String(values.lineNumber)} 行`,
    values,
    birthYear,
    reuse,
    position: target.position,
  } as const;

  if (target.kind === 'replaceFounder') {
    const { plan, issues } = planReplacement(
      values,
      target.position,
      lines,
      duties,
      registeredSubsystems,
    );
    return [
      {
        ...base,
        outcome: plan === undefined ? 'error' : issues.length > 0 ? 'warn' : 'apply',
        issues,
        inspection: undefined,
        replacement: plan,
      },
    ];
  }

  // 子系統與親系統留白時用檔案與對照表填：使用者仍可覆寫（需求規格 7.1）。
  const subsystem =
    target.subsystem.trim() === '' ? (values.sireSubsystem ?? '') : target.subsystem;
  const parentSystem =
    target.parentSystem.trim() === ''
      ? (systemMap.find((entry) => entry.subsystem === subsystem)?.parentSystem ?? '')
      : target.parentSystem;
  const inspection = await prepareOpenLine(context, {
    position: target.position,
    subsystem,
    parentSystem,
    color: target.color,
    founder: {
      fullName: values.fullName ?? '',
      abilityNo: values.abilityNo === undefined ? '' : formatAbilityNo(values.abilityNo),
      birthYear,
      sireName: values.sireName ?? '',
      damName: values.damName ?? '',
      reuse,
    },
    acceptedWarnings: target.acceptedWarnings,
  });
  const issues: PreviewIssue[] = [
    ...inspection.issues.map((problem) => issue('openLineBlocked', problem, 'halt')),
    ...inspection.warnings.map((warning) => issue(warning.code, warning.message, 'confirm')),
  ];
  return [
    {
      ...base,
      outcome:
        inspection.issues.length > 0 ? 'error' : inspection.warnings.length > 0 ? 'warn' : 'apply',
      issues,
      inspection,
      replacement: undefined,
    },
  ];
}

interface BuildContext {
  readonly gameYear: number;
  readonly newId: () => string;
  readonly occurredAt: string;
}

/** 補齊能力番号、出生年、種牡馬馬番号、父母與父系（需求規格 11.9、STL-01）。 */
function founderHorse(row: TargetStallionRow, subsystem: string, build: BuildContext): Horse {
  const { values } = row;
  const fullName = values.fullName ?? row.label;
  const base: Horse = row.reuse ?? {
    id: build.newId(),
    sex: 'male',
    fullName,
    baseName: values.baseName ?? fullName,
    stageNumbers: [],
    aliases: [],
  };
  const filled: Horse = {
    ...base,
    fullName,
    ...(values.baseName === undefined ? {} : { baseName: values.baseName }),
    ...(values.abilityNo === undefined ? {} : { abilityNo: values.abilityNo }),
    ...(row.birthYear === undefined ? {} : { birthYear: row.birthYear }),
    ...(values.sireName === undefined ? {} : { sireName: values.sireName }),
    ...(values.damName === undefined ? {} : { damName: values.damName }),
    sireSubsystem: subsystem,
  };
  return values.horseNo === undefined
    ? filled
    : {
        ...filled,
        stageNumbers: [
          ...filled.stageNumbers.filter(
            (item) => !(item.stage === 'stallion' && item.number === values.horseNo),
          ),
          importedStageNumber('targetStallion', values.horseNo, build.gameYear),
        ],
      };
}

function buildReplacement(
  row: TargetStallionRow,
  plan: ReplacementPlan,
  build: BuildContext,
): { readonly records: CollectionRecord[]; readonly events: HistoryEvent[] } {
  const { line } = plan;
  const subsystem = plan.subsystemChange?.to ?? line.subsystem;
  const horse = founderHorse(row, subsystem, build);
  const event = (subjectId: string, type: HistoryEvent['type'], after: HistoryEvent['after']) =>
    userEvent(
      { newId: build.newId },
      { subjectId, type, gameYear: build.gameYear, occurredAt: build.occurredAt, after },
    );
  // 位置、分支與已成立的世代都不變，前任的任期原封不動留著（STL-06）。
  const duty: StallionDuty = {
    id: build.newId(),
    position: line.position,
    generation: 0,
    horseId: horse.id,
    role: 'current',
    dutyStatus: 'onDuty',
    startYear: build.gameYear,
  };
  const records: CollectionRecord[] = [
    { collection: 'horses', record: horse },
    { collection: 'stallionDuties', record: duty },
  ];
  const events: HistoryEvent[] = [
    ...(row.reuse === undefined
      ? [event(horse.id, 'horseCreated', { fullName: horse.fullName ?? '', sex: 'male' })]
      : []),
    event(horse.id, 'stallionDutyStarted', {
      position: line.position,
      generation: 0,
      role: 'current',
    }),
  ];
  if (plan.subsystemChange !== undefined) {
    records.push({ collection: 'lines', record: { ...line, subsystem } });
    events.push(
      userEvent(
        { newId: build.newId },
        {
          subjectId: line.id,
          type: 'lineSystemsChanged',
          gameYear: build.gameYear,
          occurredAt: build.occurredAt,
          before: { subsystem: plan.subsystemChange.from, parentSystem: line.parentSystem },
          after: { subsystem, parentSystem: line.parentSystem },
        },
      ),
    );
  }
  return { records, events };
}

/** 這次匯入會寫到的資料表。 */
export const TARGET_STALLION_COLLECTIONS = [
  'horses',
  'lines',
  'stallionDuties',
  'systemMap',
] as const;

export function buildTargetStallion(
  rows: readonly TargetStallionRow[],
  build: BuildContext,
): { readonly records: readonly CollectionRecord[]; readonly events: readonly HistoryEvent[] } {
  const records: CollectionRecord[] = [];
  const events: HistoryEvent[] = [];
  for (const row of rows) {
    if (row.replacement !== undefined) {
      const built = buildReplacement(row, row.replacement, build);
      records.push(...built.records);
      events.push(...built.events);
      continue;
    }
    if (row.inspection === undefined) {
      continue;
    }
    const opened = buildOpenedLine({
      position: row.position,
      inspection: row.inspection,
      founder: {
        fullName: row.values.fullName ?? row.label,
        abilityNo: row.values.abilityNo === undefined ? '' : formatAbilityNo(row.values.abilityNo),
        birthYear: row.birthYear,
        sireName: row.values.sireName ?? '',
        damName: row.values.damName ?? '',
        reuse: row.reuse,
      },
      gameYear: build.gameYear,
      occurredAt: build.occurredAt,
      newId: build.newId,
    });
    const founder =
      row.values.horseNo === undefined
        ? opened.founder
        : {
            ...opened.founder,
            stageNumbers: [
              ...opened.founder.stageNumbers.filter(
                (item) => !(item.stage === 'stallion' && item.number === row.values.horseNo),
              ),
              importedStageNumber('targetStallion', row.values.horseNo, build.gameYear),
            ],
          };
    records.push(
      { collection: 'horses', record: founder },
      { collection: 'lines', record: opened.line },
      { collection: 'stallionDuties', record: opened.duty },
      ...(opened.systemMapEntry === undefined
        ? []
        : [
            {
              collection: 'systemMap' as const,
              record: opened.systemMapEntry satisfies SystemMapEntry,
            },
          ]),
    );
    events.push(...opened.events);
  }
  return { records, events };
}

/**
 * 目標種牡馬 TXT（需求規格 11.9）：整份一匹，建立新系的零代種牡馬或替換提前引退的那一匹。
 * 不是年度總表，所以不推進年份、不建立檢查點（11.1）。
 */
export function targetStallionImportHandler(
  target: TargetStallionTarget,
): ImportHandler<TargetStallionRow> {
  return {
    type: 'targetStallion',
    collections: [...TARGET_STALLION_COLLECTIONS],
    // 同一層的每一條建立新系分支各自匯入自己的檔案（STL-05），內容不同不算資料更正。
    manyPerSlot: true,
    preview: (context, game, file, choice) =>
      previewTargetStallion(context, { gameId: game.id, file, choice, target }),
    build: ({ rows, choice, newId, occurredAt }) =>
      buildTargetStallion(rows, { gameYear: choice.gameYear, newId, occurredAt }),
  };
}
