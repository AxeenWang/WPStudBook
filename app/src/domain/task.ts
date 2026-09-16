import { isLinePosition, type LinePosition } from './line.ts';
import { MARKET_GENERATION, pairDistanceFor, type Lineage, type PairDistance } from './lineage.ts';
import {
  isActiveSuccession,
  reachesRetirementAge,
  type MareGroup,
  type MareStatus,
  type Succession,
} from './mare.ts';

/** 建系期、循環期（需求規格 7.3、7.4；設計決策 6.3）。 */
export type TaskPhase = 'building' | 'cycling';

/**
 * 推進原系、建立新系（建系分支的兩條配對）與循環配種（需求規格 7.3、7.4）。
 * 第 1 系起點也是 `advance`，只是母馬側為起點母馬群。
 */
export type TaskKind = 'advance' | 'found' | 'cycle';

/** 建系期的產出代數（需求規格 7.3）：1 為起點，2～4 為分支。 */
export const BUILDING_TARGET_GENERATIONS = [1, 2, 3, 4] as const;

/** 產出 5 代起為循環期（需求規格 7.4）。 */
export const FIRST_CYCLE_GENERATION = 5;

/**
 * 兩兩互換配對的對象（需求規格 4.3、7.3）：距離 1 為 `1↔2、3↔4…`，2 為 `1↔3、2↔4…`，4 為 `1↔5、2↔6…`。
 * 三張表都等於把位置減 1 後與距離做位元互斥或再加 1。
 */
export function pairedPosition(position: LinePosition, distance: PairDistance): LinePosition {
  const paired = ((position - 1) ^ distance) + 1;
  // 1～8 與 1、2、4 的互斥或必定落在 1～8；型別守衛只是讓回傳型別成立。
  return isLinePosition(paired) ? paired : position;
}

/** 任務尚未就緒或暫停的原因（需求規格 7.3、7.6、7.7、13.2）。 */
export type TaskBlocker =
  | 'lineNotOpened'
  /** 缺少現任種牡馬：現任離場且未指定後任（需求規格 7.7、LINE-23）。 */
  | 'noCurrentStallion'
  /** 缺少目標種牡馬：建立新系的零代市場種牡馬被遊戲提前引退，等使用者替換（需求規格 7.7）。 */
  | 'missingTargetStallion'
  | 'noMares'
  /** 補系進行中：暫停新增下一系與循環換代（需求規格 7.6、LINE-21）。 */
  | 'recoveryInProgress';

/** 任務的母馬側：第 q 系 N 代母馬群（需求規格 10.3，含替代母馬）。 */
export interface TaskDam {
  readonly position: LinePosition;
  readonly generation: number;
  /** 推進原系只用替代第 q 系的市場母馬；建立新系與循環用該群母馬（需求規格 7.3）。 */
  readonly substitute: boolean;
  /** 第 1 系起點母馬群（需求規格 7.3、LINE-07）。 */
  readonly starter: boolean;
}

/** 看板上的一筆任務（需求規格 13.2）；由現有資料推導，不保存（設計決策 5.1）。 */
export interface LineTask {
  /** 規則決定的穩定識別，同時作為規則快照的任務代號。 */
  readonly id: string;
  readonly phase: TaskPhase;
  readonly kind: TaskKind;
  /** 起點沒有配對距離（需求規格 7.3）。 */
  readonly pairDistance: PairDistance | undefined;
  /** 種牡馬側的系與代數（需求規格 10.3）。 */
  readonly sire: Lineage;
  readonly dam: TaskDam;
  /** 預計產出的系與代數（需求規格 8.2）。 */
  readonly target: Lineage;
  /** 尚未就緒或暫停的原因；空陣列表示可執行。 */
  readonly blockers: readonly TaskBlocker[];
}

export interface TaskLine {
  readonly position: LinePosition;
  readonly opened: boolean;
  /** 已成立的母馬世代（需求規格 8.2）。 */
  readonly establishedGenerations: readonly number[];
}

/** 在崗的現任種牡馬（需求規格 7.7）；離開在崗的任期不放進來。 */
export interface TaskStallion {
  readonly position: LinePosition;
  readonly generation: number;
}

export interface TaskMare {
  readonly group: MareGroup;
  readonly status: MareStatus;
  readonly succession?: Succession | undefined;
  /** 目前遊戲年的馬齡；未知時不受定年限制。 */
  readonly age?: number | undefined;
}

export interface TaskSource {
  /** 八個系位置，含尚未開啟者。 */
  readonly lines: readonly TaskLine[];
  readonly stallions: readonly TaskStallion[];
  readonly mares: readonly TaskMare[];
  readonly retirementAge: number;
  /** 有進行中的斷血補系：暫停新增下一系與循環換代（需求規格 7.6、LINE-21）。 */
  readonly recoveryInProgress?: boolean | undefined;
}

/**
 * 可列入任務的母馬（需求規格 8.5、8.9、MARE-11、MARE-24）：生產中、未達定年，
 * 接替狀態為暫定保留、候選或正式保留；已被取代與已售出不列入。
 */
export function isTaskEligibleMare(mare: TaskMare, retirementAge: number): boolean {
  return (
    mare.status === 'producing' &&
    !reachesRetirementAge(mare.age, retirementAge) &&
    (mare.succession === undefined || isActiveSuccession(mare.succession))
  );
}

function hasGeneration(line: TaskLine | undefined, generation: number): boolean {
  return line?.establishedGenerations.includes(generation) ?? false;
}

function findLine(source: TaskSource, position: LinePosition): TaskLine | undefined {
  return source.lines.find((line) => line.position === position);
}

function hasEligibleMare(source: TaskSource, dam: TaskDam): boolean {
  return source.mares.some(
    (mare) =>
      mare.group.kind !== 'unassigned' &&
      mare.group.position === dam.position &&
      mare.group.generation === dam.generation &&
      (!dam.substitute || mare.group.kind !== 'own') &&
      isTaskEligibleMare(mare, source.retirementAge),
  );
}

function hasOnDutyStallion(source: TaskSource, sire: Lineage): boolean {
  return source.stallions.some(
    (stallion) => stallion.position === sire.position && stallion.generation === sire.generation,
  );
}

function blockersFor(
  source: TaskSource,
  kind: TaskKind,
  sire: Lineage,
  dam: TaskDam,
): TaskBlocker[] {
  const blockers: TaskBlocker[] = [];
  if (findLine(source, sire.position)?.opened !== true) {
    blockers.push('lineNotOpened');
  } else if (!hasOnDutyStallion(source, sire)) {
    // 建立新系用的是零代市場種牡馬，缺的時候要換市場馬而不是指定後任（需求規格 7.7）。
    blockers.push(kind === 'found' ? 'missingTargetStallion' : 'noCurrentStallion');
  }
  if (!hasEligibleMare(source, dam)) {
    blockers.push('noMares');
  }
  // 補系進行中暫停新增下一系與循環換代；推進原系不受影響（需求規格 7.6）。
  if (source.recoveryInProgress === true && (kind === 'found' || kind === 'cycle')) {
    blockers.push('recoveryInProgress');
  }
  return blockers;
}

function taskId(kind: TaskKind, sire: Lineage, dam: TaskDam, target: Lineage): string {
  const part = (lineage: Lineage) => `${String(lineage.position)}-${String(lineage.generation)}`;
  return `${kind}:s${part(sire)}:d${String(dam.position)}-${String(dam.generation)}:t${part(target)}`;
}

function makeTask(
  source: TaskSource,
  phase: TaskPhase,
  kind: TaskKind,
  pairDistance: PairDistance | undefined,
  sire: Lineage,
  dam: TaskDam,
  target: Lineage,
): LineTask {
  return {
    id: taskId(kind, sire, dam, target),
    phase,
    kind,
    pairDistance,
    sire,
    dam,
    target,
    blockers: blockersFor(source, kind, sire, dam),
  };
}

/** 第 1 系起點（需求規格 7.3）：第 1 系零代市場種牡馬 × 第 1 系起點母馬群 → 第 1 系 1 代。 */
function starterTask(source: TaskSource): LineTask[] {
  const firstLine = findLine(source, 1);
  if (firstLine?.opened !== true || hasGeneration(firstLine, 1)) {
    return [];
  }
  return [
    makeTask(
      source,
      'building',
      'advance',
      undefined,
      { position: 1, generation: MARKET_GENERATION },
      { position: 1, generation: MARKET_GENERATION, substitute: false, starter: true },
      { position: 1, generation: 1 },
    ),
  ];
}

/**
 * 建系分支（需求規格 7.3）：產出 2、3、4 代時，每個已有 g−1 代的第 p 系（p = 1～d）分出兩條配對。
 * 產出代數已成立的一側不再列出，未成立時原地重試、不推進代數（LINE-11）；各分支分年開啟不影響代數（LINE-12）。
 */
function branchTasks(source: TaskSource): LineTask[] {
  const tasks: LineTask[] = [];
  for (const targetGeneration of BUILDING_TARGET_GENERATIONS) {
    const distance = pairDistanceFor(targetGeneration);
    if (distance === undefined) {
      continue;
    }
    const previous = targetGeneration - 1;
    for (const line of source.lines) {
      if (line.position > distance || !hasGeneration(line, previous)) {
        continue;
      }
      const paired = pairedPosition(line.position, distance);
      if (!hasGeneration(line, targetGeneration)) {
        tasks.push(
          makeTask(
            source,
            'building',
            'advance',
            distance,
            { position: line.position, generation: previous },
            { position: paired, generation: previous, substitute: true, starter: false },
            { position: line.position, generation: targetGeneration },
          ),
        );
      }
      if (!hasGeneration(findLine(source, paired), targetGeneration)) {
        tasks.push(
          makeTask(
            source,
            'building',
            'found',
            distance,
            { position: paired, generation: MARKET_GENERATION },
            { position: line.position, generation: previous, substitute: false, starter: false },
            { position: paired, generation: targetGeneration },
          ),
        );
      }
    }
  }
  return tasks;
}

/** 循環期某系可產出的最新代數：種牡馬側與配對母馬側都已成立前一代的最大產出代數（需求規格 7.4）。 */
function newestCycleTarget(source: TaskSource, line: TaskLine): number | undefined {
  let newest: number | undefined;
  for (const generation of line.establishedGenerations) {
    const target = generation + 1;
    const distance = target < FIRST_CYCLE_GENERATION ? undefined : pairDistanceFor(target);
    if (distance === undefined) {
      continue;
    }
    const paired = findLine(source, pairedPosition(line.position, distance));
    if (hasGeneration(paired, generation) && (newest === undefined || target > newest)) {
      newest = target;
    }
  }
  return newest;
}

/**
 * 循環期任務（需求規格 7.4）：種牡馬與配對系母馬都達 N 代時，產出 N+1 代的任務自動出現，
 * 不需切換確認（LINE-13）。最新一代即使缺少現任或母馬也留在看板上並標示原因（需求規格 7.7）；
 * 世代交接的舊任務在種牡馬離開在崗或該群母馬全部離圈時結束（LINE-33）。
 */
function cyclingTasks(source: TaskSource): LineTask[] {
  const tasks: LineTask[] = [];
  for (const line of source.lines) {
    if (!line.opened) {
      continue;
    }
    const newest = newestCycleTarget(source, line);
    if (newest === undefined) {
      continue;
    }
    for (const generation of line.establishedGenerations) {
      const target = generation + 1;
      const distance =
        target < FIRST_CYCLE_GENERATION || target > newest ? undefined : pairDistanceFor(target);
      if (distance === undefined) {
        continue;
      }
      const paired = pairedPosition(line.position, distance);
      if (!hasGeneration(findLine(source, paired), generation)) {
        continue;
      }
      const task = makeTask(
        source,
        'cycling',
        'cycle',
        distance,
        { position: line.position, generation },
        { position: paired, generation, substitute: false, starter: false },
        { position: line.position, generation: target },
      );
      if (target === newest || task.blockers.length === 0) {
        tasks.push(task);
      }
    }
  }
  return tasks;
}

/** 分支的原系：推進原系與循環看種牡馬側，建立新系看母馬側，讓同一個分支的兩條配對相鄰。 */
function branchPosition(task: LineTask): LinePosition {
  return task.kind === 'found' ? task.dam.position : task.sire.position;
}

function compareTasks(a: LineTask, b: LineTask): number {
  const kindOrder = (task: LineTask) => (task.kind === 'found' ? 1 : 0);
  return (
    a.target.generation - b.target.generation ||
    branchPosition(a) - branchPosition(b) ||
    kindOrder(a) - kindOrder(b) ||
    a.target.position - b.target.position
  );
}

/**
 * 任務看板（需求規格 13.2）：建系期列出可開啟分支的兩條配對，循環期列出各代指定配種，
 * 依產出代數與種牡馬系位置排序。任務由系位置、已成立世代、在崗現任與母馬群推導，
 * 規則改變時整份重算，已執行的規則快照不受影響（需求規格 7.4、LINE-16）。
 */
export function buildLineTasks(source: TaskSource): LineTask[] {
  return [...starterTask(source), ...branchTasks(source), ...cyclingTasks(source)].sort(
    compareTasks,
  );
}
