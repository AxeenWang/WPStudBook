import type { BreedingPedigreeCheck, BreedingRuleSnapshot } from '../domain/breeding.ts';
import { DEFAULT_GAME_SETTINGS } from '../domain/game.ts';
import {
  LINE_POSITIONS,
  parentSystemStatus,
  type Line,
  type LinePosition,
  type ParentSystemStatus,
} from '../domain/line.ts';
import type { Lineage, PairDistance } from '../domain/lineage.ts';
import {
  ageInYear,
  atLastBreedingAge,
  isActiveSuccession,
  MARE_GROUP_TARGET,
  type Mare,
} from '../domain/mare.ts';
import {
  checkLineageAgainstRule,
  checkPedigree,
  pedigreeNotices,
  pedigreeWarningCodes,
  type LineageMismatch,
  type PedigreeCheck,
  type PedigreeWarningCode,
} from '../domain/pedigree-check.ts';
import { stallionLineage } from '../domain/foal.ts';
import { isRecoveryInProgress, needsReplenish } from '../domain/recovery.ts';
import { isOnDuty } from '../domain/stallion-duty.ts';
import {
  buildLineTasks,
  isTaskEligibleMare,
  type LineTask,
  type TaskBlocker,
  type TaskDam,
  type TaskKind,
  type TaskLine,
  type TaskPhase,
  type TaskStallion,
} from '../domain/task.ts';
import { listBreedings } from '../storage/breedings.ts';
import { getFoal } from '../storage/foals.ts';
import { readGameSettings } from '../storage/games.ts';
import { getHorsesByIds } from '../storage/horses.ts';
import { listLines } from '../storage/lines.ts';
import { getMare, listMares } from '../storage/mares.ts';
import { listRecoveries } from '../storage/recoveries.ts';
import { listStallionDuties } from '../storage/stallion-duties.ts';
import type { ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import { requireCurrentGame } from './games.ts';
import { loadHorseNames } from './horse-names.ts';
import { checkBreedingPedigree } from './pedigree-check.ts';
import { requireAcceptedWarnings, type ServiceWarning } from './warnings.ts';

/** 任務看板上可登記這筆任務的一匹母馬（需求規格 13.2）。 */
export interface TaskMareOption {
  readonly id: string;
  readonly name: string;
  /** 達定年減 1 歲的最後配種年齡提示（需求規格 8.5、MARE-11）。 */
  readonly lastBreedingAge: boolean;
  /** 本年度已依這筆任務登記繁殖紀錄。 */
  readonly recorded: boolean;
}

export interface TaskView {
  readonly id: string;
  readonly phase: TaskPhase;
  readonly kind: TaskKind;
  readonly pairDistance: PairDistance | undefined;
  readonly sire: Lineage;
  readonly dam: TaskDam;
  readonly target: Lineage;
  readonly blockers: readonly TaskBlocker[];
  /** 種牡馬側的在崗現任馬名；缺少現任時為 undefined。 */
  readonly sireName: string | undefined;
  readonly sireId: string | undefined;
  /** 母馬群中可列入任務的母馬（需求規格 8.5、8.9）。 */
  readonly mares: readonly TaskMareOption[];
  /**
   * 高優先待辦（需求規格 7.7）：種牡馬側的現任在本年度才正式接任，相關母馬下次配種改為指定配種。
   * 由任期起始年推導，不另外改寫母馬的今年計畫。
   */
  readonly highPriority: boolean;
}

/** 總覽的八系卡片（需求規格 13.2）；現任與後繼由 `loadStallionOverview` 提供。 */
export interface LineCardView {
  readonly position: LinePosition;
  readonly opened: boolean;
  readonly subsystem: string | undefined;
  readonly parentSystem: string | undefined;
  readonly color: string | undefined;
  /** 已成立的最新母馬世代。 */
  readonly latestGeneration: number | undefined;
  /** 最新世代生產中的母馬數與目標數（需求規格 7.5）。 */
  readonly mareCount: number;
  readonly mareTarget: number;
  /** 已成立世代的母馬降為 0：顯示「已成立，母馬群待補」（需求規格 7.6、LINE-18）。 */
  readonly needsReplenish: boolean;
  /**
   * 母馬群已推進而種牡馬未就緒時的等待年數（需求規格 7.8、LINE-24）：
   * 目前遊戲年減最新世代成立的年份，不退代、不判定斷血。
   */
  readonly waitingYears: number | undefined;
  /** 這個系的任務缺項，去除重複（需求規格 13.2）。 */
  readonly missing: readonly TaskBlocker[];
}

export interface TaskBoard {
  readonly currentYear: number;
  readonly tasks: readonly TaskView[];
  readonly lines: readonly LineCardView[];
  readonly parentSystem: ParentSystemStatus;
  /** 總覽提醒區（需求規格 13.2）：母馬群待補、缺少現任或目標種牡馬、等待目標種牡馬。 */
  readonly reminders: readonly string[];
  /** 進行中的斷血補系（需求規格 7.6、LINE-21）。 */
  readonly recoveryInProgress: boolean;
}

interface BoardData {
  readonly gameId: string;
  readonly currentYear: number;
  readonly lines: readonly Line[];
  readonly mares: readonly Mare[];
  readonly tasks: readonly LineTask[];
  readonly retirementAge: number;
  /** 母馬 id → 目前遊戲年的馬齡。 */
  readonly ages: ReadonlyMap<string, number | undefined>;
  /** 系位置與代數 → 在崗現任的馬匹 id 與任期起始年。 */
  readonly onDuty: ReadonlyMap<string, { readonly horseId: string; readonly startYear: number }>;
  /** 本年度已登記的任務代號 → 母馬 id。 */
  readonly recorded: ReadonlySet<string>;
  readonly recoveryInProgress: boolean;
}

/** 種牡馬側缺席時用的空祖先樹：只會得到「未計算」或「資料不足」，不再多讀一次資料庫。 */
const EMPTY_TREE = {
  greatGrandparents: [],
  duplicateAncestors: [],
  unlinkedAncestors: 1,
  buildingPhaseGaps: 0,
} as const;

function dutyKey(lineage: Lineage): string {
  return `${String(lineage.position)}-${String(lineage.generation)}`;
}

function recordKey(taskId: string, mareId: string): string {
  return `${taskId}\u001f${mareId}`;
}

async function loadBoardData(context: ServiceContext): Promise<BoardData> {
  const game = await requireCurrentGame(context);
  const [lines, duties, mares, breedings, settings, recoveries] = await Promise.all([
    listLines(context.database, game.id),
    listStallionDuties(context.database, game.id),
    listMares(context.database, game.id),
    listBreedings(context.database, game.id),
    readGameSettings(context.database, game.id),
    listRecoveries(context.database, game.id),
  ]);
  const recoveryInProgress = recoveries.some(isRecoveryInProgress);
  const horses = await getHorsesByIds(
    context.database,
    game.id,
    mares.map((mare) => mare.id),
  );
  const ages = new Map(
    mares.map((mare) => [mare.id, ageInYear(horses.get(mare.id)?.birthYear, game.currentYear)]),
  );
  const onDutyDuties = duties.filter(isOnDuty);
  const onDuty = new Map(
    onDutyDuties.map((duty) => [
      dutyKey(duty),
      { horseId: duty.horseId, startYear: duty.startYear },
    ]),
  );
  const stallions: TaskStallion[] = onDutyDuties.map((duty) => ({
    position: duty.position,
    generation: duty.generation,
  }));
  const retirementAge = (settings ?? DEFAULT_GAME_SETTINGS).retirementAge;
  const openedLines = new Map(lines.map((line) => [line.position, line]));
  const taskLines: TaskLine[] = LINE_POSITIONS.map((position) => {
    const line = openedLines.get(position);
    return {
      position,
      opened: line !== undefined,
      establishedGenerations: (line?.establishedGenerations ?? []).map((item) => item.generation),
    };
  });
  const tasks = buildLineTasks({
    lines: taskLines,
    stallions,
    mares: mares.map((mare) => ({
      group: mare.group,
      status: mare.status,
      succession: mare.succession,
      age: ages.get(mare.id),
    })),
    retirementAge,
    recoveryInProgress,
  });
  const recorded = new Set(
    breedings
      .filter((breeding) => breeding.gameYear === game.currentYear)
      .flatMap((breeding) =>
        breeding.ruleSnapshot === undefined
          ? []
          : [recordKey(breeding.ruleSnapshot.taskId, breeding.mareId)],
      ),
  );
  return {
    gameId: game.id,
    currentYear: game.currentYear,
    lines,
    mares,
    tasks,
    retirementAge,
    ages,
    onDuty,
    recorded,
    recoveryInProgress,
  };
}

function damMares(data: BoardData, dam: TaskDam): Mare[] {
  return data.mares.filter(
    (mare) =>
      mare.group.kind !== 'unassigned' &&
      mare.group.position === dam.position &&
      mare.group.generation === dam.generation &&
      (!dam.substitute || mare.group.kind !== 'own') &&
      isTaskEligibleMare(
        {
          group: mare.group,
          status: mare.status,
          succession: mare.succession,
          age: data.ages.get(mare.id),
        },
        data.retirementAge,
      ),
  );
}

/** 最新世代生產中的母馬數（需求規格 7.5、13.2）：含替代母馬，已離圈與被取代者不計。 */
function mareCountFor(data: BoardData, position: LinePosition, generation: number): number {
  return data.mares.filter(
    (mare) =>
      mare.group.kind !== 'unassigned' &&
      mare.group.position === position &&
      mare.group.generation === generation &&
      mare.status === 'producing' &&
      (mare.succession === undefined || isActiveSuccession(mare.succession)),
  ).length;
}

function latestGenerationOf(line: Line | undefined): number | undefined {
  return line === undefined || line.establishedGenerations.length === 0
    ? undefined
    : Math.max(...line.establishedGenerations.map((item) => item.generation));
}

/**
 * 等待目標種牡馬的年數（需求規格 7.8、LINE-24）：母馬群已推進到最新世代、但那一代缺種牡馬時，
 * 以目前遊戲年減該世代成立的年份。不退代、不判定斷血；種牡馬就緒後就不再顯示。
 */
function waitingYearsFor(
  data: BoardData,
  line: Line | undefined,
  latestGeneration: number | undefined,
  missing: readonly TaskBlocker[],
): number | undefined {
  if (line === undefined || latestGeneration === undefined) {
    return undefined;
  }
  if (!missing.includes('noCurrentStallion') && !missing.includes('missingTargetStallion')) {
    return undefined;
  }
  const established = line.establishedGenerations.find(
    (item) => item.generation === latestGeneration,
  );
  return established === undefined
    ? undefined
    : Math.max(data.currentYear - established.gameYear, 0);
}

/** 總覽提醒區（需求規格 13.2）：母馬群待補、缺少現任或目標種牡馬、等待目標種牡馬。 */
function buildReminders(lines: readonly LineCardView[]): string[] {
  const reminders: string[] = [];
  for (const card of lines) {
    if (!card.opened) {
      continue;
    }
    const label = `第 ${String(card.position)} 系`;
    if (card.needsReplenish) {
      reminders.push(
        `${label} ${String(card.latestGeneration ?? 0)} 代已成立，母馬群待補（0／${String(card.mareTarget)}），建議補血`,
      );
    }
    if (card.missing.includes('noCurrentStallion')) {
      reminders.push(`${label}缺少現任種牡馬，相關任務已暫停`);
    }
    if (card.missing.includes('missingTargetStallion')) {
      reminders.push(`${label}缺少目標種牡馬，請從市場選同系其他種牡馬替換`);
    }
    if (card.waitingYears !== undefined && card.waitingYears > 0) {
      reminders.push(
        `${label} ${String(card.latestGeneration ?? 0)} 代母馬群已等待目標種牡馬 ${String(card.waitingYears)} 年`,
      );
    }
  }
  return reminders;
}

/**
 * 任務看板與八系卡片（需求規格 13.2）：任務由系位置、已成立世代、在崗現任與母馬群推導，
 * 每次載入重算（LINE-16）。
 */
export async function loadTaskBoard(context: ServiceContext): Promise<TaskBoard> {
  const data = await loadBoardData(context);
  // 每筆任務的可配母馬只算一次：先取名字，再組畫面資料。
  const damsByTask = new Map(data.tasks.map((task) => [task.id, damMares(data, task.dam)]));
  const mareIds = [...damsByTask.values()].flatMap((mares) => mares.map((mare) => mare.id));
  const sireIds = data.tasks.flatMap((task) => {
    const duty = data.onDuty.get(dutyKey(task.sire));
    return duty === undefined ? [] : [duty.horseId];
  });
  const names = await loadHorseNames(context.database, data.gameId, [
    ...new Set([...mareIds, ...sireIds]),
  ]);
  const tasks = data.tasks.map((task): TaskView => {
    const duty = data.onDuty.get(dutyKey(task.sire));
    const sireId = duty?.horseId;
    return {
      id: task.id,
      phase: task.phase,
      kind: task.kind,
      pairDistance: task.pairDistance,
      sire: task.sire,
      dam: task.dam,
      target: task.target,
      blockers: task.blockers,
      sireId,
      sireName: sireId === undefined ? undefined : (names.get(sireId) ?? sireId),
      highPriority: duty?.startYear === data.currentYear,
      mares: (damsByTask.get(task.id) ?? []).map((mare) => ({
        id: mare.id,
        name: names.get(mare.id) ?? '（沒有馬名）',
        lastBreedingAge: atLastBreedingAge(data.ages.get(mare.id), data.retirementAge),
        recorded: data.recorded.has(recordKey(task.id, mare.id)),
      })),
    };
  });
  const byPosition = new Map(data.lines.map((line) => [line.position, line]));
  const lines = LINE_POSITIONS.map((position): LineCardView => {
    const line = byPosition.get(position);
    const latestGeneration = latestGenerationOf(line);
    const mareCount =
      latestGeneration === undefined ? 0 : mareCountFor(data, position, latestGeneration);
    const missing = [
      ...new Set(
        tasks
          .filter((task) => task.sire.position === position || task.target.position === position)
          .flatMap((task) => task.blockers),
      ),
    ];
    return {
      position,
      opened: line !== undefined,
      subsystem: line?.subsystem,
      parentSystem: line?.parentSystem,
      color: line?.color,
      latestGeneration,
      mareCount,
      mareTarget: MARE_GROUP_TARGET,
      needsReplenish: needsReplenish(latestGeneration !== undefined, mareCount),
      waitingYears: waitingYearsFor(data, line, latestGeneration, missing),
      missing,
    };
  });
  return {
    currentYear: data.currentYear,
    tasks,
    lines,
    reminders: buildReminders(lines),
    recoveryInProgress: data.recoveryInProgress,
    parentSystem: parentSystemStatus(
      data.lines.map((line) => ({ position: line.position, parentSystem: line.parentSystem })),
    ),
  };
}

/** 目前的任務清單，不含顯示用的馬名與母馬選項。 */
export async function listLineTasks(context: ServiceContext): Promise<readonly LineTask[]> {
  return (await loadBoardData(context)).tasks;
}

/** 依任務代號取出目前的規則快照（需求規格 7.4）；任務已不在看板上時回傳 undefined。 */
export async function ruleSnapshotFor(
  context: ServiceContext,
  taskId: string,
): Promise<BreedingRuleSnapshot | undefined> {
  const data = await loadBoardData(context);
  const task = data.tasks.find((item) => item.id === taskId);
  if (task === undefined) {
    return undefined;
  }
  return {
    taskId: task.id,
    phase: task.phase,
    kind: task.kind,
    ...(task.pairDistance === undefined ? {} : { pairDistance: task.pairDistance }),
    sire: task.sire,
    dam: { position: task.dam.position, generation: task.dam.generation },
    target: task.target,
  };
}

/** 登記指定配種前解析任務；任務不存在時阻止（需求規格 7.4）。 */
export async function requireRuleSnapshot(
  context: ServiceContext,
  taskId: string,
): Promise<BreedingRuleSnapshot> {
  const snapshot = await ruleSnapshotFor(context, taskId);
  if (snapshot === undefined) {
    throw new ServiceError('invalidInput', '這筆任務已不在看板上，請重新整理後再登記');
  }
  return snapshot;
}

/** 系與代數不符的說明（需求規格 10.3）：指出錯誤的一方與正確的系、代數。 */
function describeMismatch(mismatch: LineageMismatch): string {
  const side = mismatch.side === 'sire' ? '種牡馬' : '母馬';
  const expected = `第 ${String(mismatch.expected.position)} 系 ${String(mismatch.expected.generation)} 代`;
  if (mismatch.kind === 'unknown') {
    return `${side}沒有系與代數，這筆任務要用${expected}的${side}`;
  }
  const actual = mismatch.actual;
  const chosen =
    actual === undefined
      ? ''
      : `（選到的是第 ${String(actual.position)} 系 ${String(actual.generation)} 代）`;
  const wrong = mismatch.kind === 'position' ? '系別' : '代數';
  return `${side}的${wrong}與規則不符：這筆任務要用${expected}的${side}${chosen}`;
}

const PEDIGREE_WARNING_MESSAGES: Readonly<
  Record<PedigreeWarningCode, (check: PedigreeCheck) => string>
> = {
  activationBelowFull: (check) =>
    `活血預估只有 ${String(check.activationCount ?? 0)} 種，少於 8 種`,
  duplicateAncestors: (check) =>
    `4 代內有 ${String(check.duplicateAncestors.length)} 匹重複的馬（インブリード）`,
  insufficientPedigree: () => '血統資料不足，活血預估可能不準',
};

export interface TaskBreedingInput {
  readonly taskId: string;
  readonly mareId: string;
  readonly stallionId: string | undefined;
  /** 使用者已確認的警告（需求規格 5.2）。 */
  readonly acceptedWarnings?: readonly PedigreeWarningCode[] | undefined;
}

export interface TaskBreedingCheck {
  /** 系與代數不符等一律阻止的問題（需求規格 5.2、10.3）。 */
  readonly issues: readonly string[];
  /** 需要確認的血統警告（需求規格 10.2）。 */
  readonly warnings: readonly ServiceWarning<PedigreeWarningCode>[];
  /** 只提示、不要求確認的說明（PED-11）。 */
  readonly notices: readonly string[];
  readonly pedigreeCheck: PedigreeCheck;
}

interface TaskBreedingResolution extends TaskBreedingCheck {
  readonly ruleSnapshot: BreedingRuleSnapshot;
}

async function inspectTaskBreeding(
  context: ServiceContext,
  input: TaskBreedingInput,
): Promise<TaskBreedingResolution> {
  const game = await requireCurrentGame(context);
  const snapshot = await requireRuleSnapshot(context, input.taskId);
  const issues: string[] = [];

  const [duties, mare, ownFoal] = await Promise.all([
    listStallionDuties(context.database, game.id),
    getMare(context.database, game.id, input.mareId),
    input.stallionId === undefined
      ? Promise.resolve(undefined)
      : getFoal(context.database, game.id, input.stallionId),
  ]);
  const sireLineage =
    input.stallionId === undefined
      ? undefined
      : stallionLineage(
          duties.filter((duty) => duty.horseId === input.stallionId),
          ownFoal,
        );
  const sireMismatch = checkLineageAgainstRule('sire', snapshot.sire, sireLineage);
  if (sireMismatch !== undefined) {
    issues.push(describeMismatch(sireMismatch));
  }
  // 母馬側比對的是母馬群（需求規格 10.3「第 q 系 g−1 代母馬群（含替代母馬）」），不是母馬本身的代數。
  const damLineage =
    mare === undefined || mare.group.kind === 'unassigned'
      ? undefined
      : { position: mare.group.position, generation: mare.group.generation };
  const damMismatch = checkLineageAgainstRule('dam', snapshot.dam, damLineage);
  if (damMismatch !== undefined) {
    issues.push(describeMismatch(damMismatch));
  }

  // 種牡馬沒有系與代數時血統檢查只會回報「資料不足」，沒有參考價值；阻止原因已經足夠。
  const pedigreeCheck =
    input.stallionId === undefined
      ? checkPedigree(snapshot.phase, EMPTY_TREE)
      : await checkBreedingPedigree(context, {
          phase: snapshot.phase,
          sireId: input.stallionId,
          damId: input.mareId,
        });
  const warnings = pedigreeWarningCodes(pedigreeCheck).map((code) => ({
    code,
    message: PEDIGREE_WARNING_MESSAGES[code](pedigreeCheck),
  }));
  return {
    issues,
    warnings,
    notices: pedigreeNotices(pedigreeCheck),
    pedigreeCheck,
    ruleSnapshot: snapshot,
  };
}

/**
 * 依任務登記指定配種前的檢查（需求規格 10.2、10.3）：系與代數不符一律阻止，
 * 活血少於 8 種、4 代內重複或資料不足時警告並要求確認。
 */
export async function checkTaskBreeding(
  context: ServiceContext,
  input: TaskBreedingInput,
): Promise<TaskBreedingCheck> {
  const { issues, warnings, notices, pedigreeCheck } = await inspectTaskBreeding(context, input);
  return { issues, warnings, notices, pedigreeCheck };
}

export interface ResolvedTaskBreeding {
  readonly ruleSnapshot: BreedingRuleSnapshot;
  /** 循環期才有；建系期不計算活血（需求規格 10.1）。 */
  readonly pedigreeCheck: BreedingPedigreeCheck | undefined;
  readonly confirmations: readonly string[];
}

/**
 * 依任務登記指定配種時解析規則快照與血統檢查（需求規格 7.4、10.2、10.3）：
 * 系與代數不符時阻止，未確認的血統警告時要求確認，都通過才回傳要保存的內容。
 */
export async function resolveTaskBreeding(
  context: ServiceContext,
  input: TaskBreedingInput,
): Promise<ResolvedTaskBreeding> {
  const resolution = await inspectTaskBreeding(context, input);
  if (resolution.issues.length > 0) {
    throw new ServiceError('invalidInput', resolution.issues.join('；'));
  }
  requireAcceptedWarnings(resolution.warnings, input.acceptedWarnings ?? []);
  const { pedigreeCheck } = resolution;
  return {
    ruleSnapshot: resolution.ruleSnapshot,
    pedigreeCheck:
      pedigreeCheck.activationCount === undefined
        ? undefined
        : {
            activationCount: pedigreeCheck.activationCount,
            duplicateAncestors: pedigreeCheck.duplicateAncestors,
            insufficientPedigree: pedigreeCheck.insufficientPedigree,
            gapsOnlyFromBuildingPhase: pedigreeCheck.gapsOnlyFromBuildingPhase,
          },
    confirmations: resolution.warnings.map((warning) => warning.code),
  };
}
