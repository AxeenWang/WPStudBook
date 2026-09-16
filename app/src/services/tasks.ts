import type { BreedingRuleSnapshot } from '../domain/breeding.ts';
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
import { readGameSettings } from '../storage/games.ts';
import { getHorsesByIds } from '../storage/horses.ts';
import { listLines } from '../storage/lines.ts';
import { listMares } from '../storage/mares.ts';
import { listStallionDuties } from '../storage/stallion-duties.ts';
import type { ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import { requireCurrentGame } from './games.ts';
import { loadHorseNames } from './horse-names.ts';

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
}

export interface TaskBoard {
  readonly currentYear: number;
  readonly tasks: readonly TaskView[];
  readonly lines: readonly LineCardView[];
  readonly parentSystem: ParentSystemStatus;
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
}

function dutyKey(lineage: Lineage): string {
  return `${String(lineage.position)}-${String(lineage.generation)}`;
}

function recordKey(taskId: string, mareId: string): string {
  return `${taskId}\u001f${mareId}`;
}

async function loadBoardData(context: ServiceContext): Promise<BoardData> {
  const game = await requireCurrentGame(context);
  const [lines, duties, mares, breedings, settings] = await Promise.all([
    listLines(context.database, game.id),
    listStallionDuties(context.database, game.id),
    listMares(context.database, game.id),
    listBreedings(context.database, game.id),
    readGameSettings(context.database, game.id),
  ]);
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
 * 任務看板與八系卡片（需求規格 13.2）：任務由系位置、已成立世代、在崗現任與母馬群推導，
 * 每次載入重算（LINE-16）。
 */
export async function loadTaskBoard(context: ServiceContext): Promise<TaskBoard> {
  const data = await loadBoardData(context);
  const mareIds = data.tasks.flatMap((task) => damMares(data, task.dam).map((mare) => mare.id));
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
      mares: damMares(data, task.dam).map((mare) => ({
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
    return {
      position,
      opened: line !== undefined,
      subsystem: line?.subsystem,
      parentSystem: line?.parentSystem,
      color: line?.color,
      latestGeneration,
      mareCount:
        latestGeneration === undefined ? 0 : mareCountFor(data, position, latestGeneration),
      mareTarget: MARE_GROUP_TARGET,
    };
  });
  return {
    currentYear: data.currentYear,
    tasks,
    lines,
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
