import { trackingName, subParamTotal, type Aptitude, type SubParams } from '../domain/foal.ts';
import { DEFAULT_GAME_SETTINGS, type Game } from '../domain/game.ts';
import type { HistoryEvent } from '../domain/history-event.ts';
import {
  formatAbilityNo,
  horseDisplayName,
  isStallionHorse,
  nameForTracking,
  parseAbilityNo,
  withStageNumber,
  type Horse,
  type Sex,
} from '../domain/horse.ts';
import type { JsonObject } from '../domain/json.ts';
import type { Line } from '../domain/line.ts';
import type { Lineage } from '../domain/lineage.ts';
import { ageInYear, mareGeneration } from '../domain/mare.ts';
import {
  REPLACE_REASONS,
  PLANNED_READINESS,
  isActivePlanned,
  isOnDuty,
  reachesStallionReminderAge,
  statusForReplaceReason,
  type ReplaceReason,
  type CurrentDuty,
  type DutyStatus,
  type PlannedDuty,
  type PlannedReadiness,
  type StallionDuty,
} from '../domain/stallion-duty.ts';
import { listBreedings } from '../storage/breedings.ts';
import { getFoal, listFoals, modifyFoal } from '../storage/foals.ts';
import { readGameSettings } from '../storage/games.ts';
import { getHorsesByIds } from '../storage/horses.ts';
import { listLines } from '../storage/lines.ts';
import { listMares } from '../storage/mares.ts';
import {
  getStallionDuty,
  listStallionDuties,
  modifyStallionDuties,
  type CandidateRecords,
  type StallionChange,
  type StallionState,
} from '../storage/stallion-duties.ts';
import { trackWrite, type ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import { userEvent } from './events.ts';
import { gameTouch, requireCurrentGame } from './games.ts';
import { deriveOffspringLineage, lineageMismatch, lineageText } from './succession.ts';

/** 介面用的選項（ui 不能引用 domain 的值）。 */
export const REPLACE_REASON_OPTIONS: readonly ReplaceReason[] = REPLACE_REASONS;
/** 使用者可以直接設定的就緒狀態；尚未誕生由指定配種決定，正式供用由接任決定。 */
export const SETTABLE_READINESS: readonly PlannedReadiness[] = PLANNED_READINESS.filter(
  (readiness) => readiness === 'racing' || readiness === 'retiredPending',
);

function fail(issues: readonly string[]): never {
  throw new ServiceError('invalidInput', issues.join('；'));
}

/** 種牡馬馬番号：空白表示未填；接受 `0x` 開頭或不帶前綴的十六進位（設計決策 5.3 節）。 */
function parseStallionNo(text: string, issues: string[]): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '') {
    return undefined;
  }
  const value = parseAbilityNo(trimmed);
  if (value === undefined) {
    issues.push('種牡馬馬番号必須是 0x0000～0xFFFF 的十六進位');
  }
  return value;
}

interface CandidateCheck {
  readonly issues: readonly string[];
  /** 核對通過時的系與代數。 */
  readonly lineage: Lineage | undefined;
}

/**
 * 公駒成為現任或預定後繼前的核對（需求規格 9.6）：只接受非自由配種的自家公駒；以父母再次推導系與代數，
 * 與出生紀錄不符時阻止；必須屬於操作的系位置，且該系已開啟。line 是交易內讀出的 position 系位置。
 */
function checkCandidate(
  candidate: CandidateRecords | undefined,
  line: Line | undefined,
  position: number,
): CandidateCheck {
  const horse = candidate?.horse;
  if (candidate === undefined || horse === undefined) {
    return { issues: ['找不到這匹馬'], lineage: undefined };
  }
  const issues: string[] = [];
  if (horse.sex !== 'male') {
    issues.push('只有公馬可以成為種牡馬');
  }
  const { foal } = candidate;
  if (foal === undefined) {
    issues.push('只有自家產駒可以由此接任或指定為預定後繼');
  } else if (foal.freeBred || foal.lineage === undefined) {
    issues.push('自由配種產駒不能成為八系後繼');
  }
  const lineage = foal?.freeBred === false ? foal.lineage : undefined;
  if (lineage !== undefined) {
    const mismatch = lineageMismatch(lineage, candidate.sire, candidate.dam);
    if (mismatch !== undefined) {
      issues.push(mismatch);
    }
    if (lineage.position !== position) {
      issues.push(`這匹馬屬於第 ${String(lineage.position)} 系，不是第 ${String(position)} 系`);
    } else if (line === undefined) {
      issues.push(`第 ${String(position)} 系尚未開啟`);
    }
  }
  return { issues, lineage: issues.length === 0 ? lineage : undefined };
}

/** 服務先以產駒紀錄找出系位置，交易內再以同一位置讀取並核對。 */
async function candidatePosition(context: ServiceContext, gameId: string, horseId: string) {
  const foal = await getFoal(context.database, gameId, horseId);
  return foal?.lineage?.position ?? 0;
}

function dutyStatusValue(duty: CurrentDuty): JsonObject {
  return {
    dutyStatus: duty.dutyStatus,
    ...(duty.endYear === undefined ? {} : { endYear: duty.endYear }),
    ...(duty.replaceReason === undefined ? {} : { replaceReason: duty.replaceReason }),
    ...(duty.successorId === undefined ? {} : { successorId: duty.successorId }),
  };
}

function plannedValue(duty: PlannedDuty): JsonObject {
  return {
    generation: duty.generation,
    readiness: duty.readiness,
    ...(duty.horseId === undefined ? {} : { horseId: duty.horseId }),
    ...(duty.breedingId === undefined ? {} : { breedingId: duty.breedingId }),
    ...(duty.endYear === undefined ? {} : { endYear: duty.endYear }),
  };
}

/**
 * 預定後繼指定結束的年份：不早於指定年。更換現任可以回填較早的生效年，目前遊戲年也可以調回較早的年份，
 * 結束年早於指定年的紀錄會被備份欄位規則拒絕。
 */
function plannedEndYear(planned: PlannedDuty, year: number): number {
  return Math.max(year, planned.startYear);
}

interface DutyStart {
  readonly horse: Horse;
  readonly lineage: Lineage;
  readonly startYear: number;
  readonly stallionNo: number | undefined;
  readonly predecessorId?: string | undefined;
}

/**
 * 開始現任任期：寫入去向（成為種牡馬）與種牡馬馬番号；這匹馬是該系進行中的預定後繼時（含指向他出生前的
 * 配種、尚未確認的指定），指定改為正式供用並結束（需求規格 7.7）。
 */
function startDuty(
  context: ServiceContext,
  game: Game,
  state: StallionState,
  line: Line,
  start: DutyStart,
  now: string,
): StallionChange {
  const { horse, lineage, startYear } = start;
  const events: HistoryEvent[] = [];
  const stallionHorse = becomeStallion(context, game, horse, start.stallionNo, now, events);
  const duty: CurrentDuty = {
    id: context.newId(),
    position: lineage.position,
    generation: lineage.generation,
    horseId: horse.id,
    role: 'current',
    dutyStatus: 'onDuty',
    startYear,
  };
  events.push(
    userEvent(context, {
      subjectId: horse.id,
      type: 'stallionDutyStarted',
      gameYear: game.currentYear,
      occurredAt: now,
      after: {
        position: duty.position,
        generation: duty.generation,
        role: 'current',
        startYear,
        ...(start.predecessorId === undefined ? {} : { predecessorId: start.predecessorId }),
      },
    }),
  );
  const planned = state.duties.find(isActivePlanned);
  const bornFromPlanned =
    planned?.breedingId !== undefined &&
    state.birth?.breeding?.id === planned.breedingId &&
    state.birth.breeding.foalId === horse.id;
  const duties: StallionDuty[] = [duty];
  if (planned !== undefined && (planned.horseId === horse.id || bornFromPlanned)) {
    const ended: PlannedDuty = {
      id: planned.id,
      position: planned.position,
      generation: planned.generation,
      role: 'planned',
      horseId: horse.id,
      readiness: 'inService',
      startYear: planned.startYear,
      endYear: plannedEndYear(planned, startYear),
    };
    duties.push(ended);
    events.push(
      userEvent(context, {
        subjectId: line.id,
        type: 'plannedSuccessorChanged',
        gameYear: game.currentYear,
        occurredAt: now,
        before: plannedValue(planned),
        after: plannedValue(ended),
      }),
    );
  }
  return { duties, horses: stallionHorse === undefined ? [] : [stallionHorse], events };
}

/** 寫入去向與種牡馬馬番号；只有第一次成為種牡馬時寫事件，都沒有變更時回傳 undefined。 */
function becomeStallion(
  context: ServiceContext,
  game: Game,
  horse: Horse,
  stallionNo: number | undefined,
  now: string,
  events: HistoryEvent[],
): Horse | undefined {
  const numbered =
    stallionNo === undefined
      ? horse
      : withStageNumber(horse, {
          stage: 'stallion',
          number: stallionNo,
          gameYear: game.currentYear,
          source: 'manual',
        });
  const becomes = !isStallionHorse(horse);
  if (!becomes) {
    return numbered === horse ? undefined : numbered;
  }
  events.push(
    userEvent(context, {
      subjectId: horse.id,
      type: 'becameStallion',
      gameYear: game.currentYear,
      occurredAt: now,
      after: stallionNo === undefined ? {} : { stallionNo },
    }),
  );
  return { ...numbered, fate: { kind: 'becameStallion', gameYear: game.currentYear } };
}

export interface RegisterStallionInput {
  readonly horseId: string;
  /** 種牡馬馬番号文字；空白表示未填。 */
  readonly stallionNo: string;
}

/**
 * 登記自家產駒成為種牡馬（需求規格 9.7）：保存去向與種牡馬馬番号，母馬的產駒頁籤另外標示。
 * 只作紀錄，不影響八系任務、代數或後繼，所以自由配種產駒也可以登記。之後馬名唯讀（6.4）。
 */
export async function registerAsStallion(
  context: ServiceContext,
  input: RegisterStallionInput,
): Promise<Horse> {
  const game = await requireCurrentGame(context);
  const issues: string[] = [];
  const stallionNo = parseStallionNo(input.stallionNo, issues);
  if (issues.length > 0) {
    fail(issues);
  }
  if ((await getFoal(context.database, game.id, input.horseId)) === undefined) {
    fail(['只有自家產駒可以登記成為種牡馬']);
  }
  const now = context.now().toISOString();
  const result = await trackWrite(context, () =>
    modifyFoal(context.database, {
      gameId: game.id,
      foalId: input.horseId,
      touch: gameTouch(context, now),
      apply: ({ game: stored, horse }) => {
        if (horse.sex !== 'male') {
          fail(['只有公馬可以成為種牡馬']);
        }
        if (isStallionHorse(horse)) {
          fail(['這匹馬已經登記為種牡馬']);
        }
        const events: HistoryEvent[] = [];
        const updated = becomeStallion(context, stored, horse, stallionNo, now, events);
        return { horse: updated, events };
      },
    }),
  );
  return result.horse;
}

export interface AssignStallionInput {
  readonly horseId: string;
  readonly stallionNo: string;
}

/**
 * 自家種牡馬接任現任（需求規格 7.7、9.6、STL-03）：從既有產駒選取，沿用能力番号、出生年與內部識別。
 * 該系該代已有在崗現任時阻止，改用更換現任或兄弟比較；交接期間上下兩代可同時在崗。
 */
export async function assignCurrentStallion(
  context: ServiceContext,
  input: AssignStallionInput,
): Promise<CurrentDuty> {
  const game = await requireCurrentGame(context);
  const inputIssues: string[] = [];
  const stallionNo = parseStallionNo(input.stallionNo, inputIssues);
  if (inputIssues.length > 0) {
    fail(inputIssues);
  }
  const position = await candidatePosition(context, game.id, input.horseId);
  const now = context.now().toISOString();
  const change = await trackWrite(context, () =>
    modifyStallionDuties(context.database, {
      gameId: game.id,
      request: { position, horseId: input.horseId },
      touch: gameTouch(context, now),
      apply: (stored, state) => {
        const { issues, lineage } = checkCandidate(state.candidate, state.line, position);
        const horse = state.candidate?.horse;
        if (issues.length > 0 || lineage === undefined || horse === undefined || !state.line) {
          fail(issues);
        }
        const onDuty = state.duties.find(
          (duty) => isOnDuty(duty) && duty.generation === lineage.generation,
        );
        if (onDuty !== undefined) {
          fail([
            onDuty.role === 'current' && onDuty.horseId === horse.id
              ? '這匹馬已經是現任'
              : `${lineageText(lineage.position, lineage.generation)}已有在崗的現任，請使用更換現任或兄弟比較`,
          ]);
        }
        return startDuty(
          context,
          stored,
          state,
          state.line,
          { horse, lineage, startYear: stored.currentYear, stallionNo },
          now,
        );
      },
    }),
  );
  return requireStartedDuty(change);
}

function requireStartedDuty(change: StallionChange): CurrentDuty {
  const duty = change.duties.find(
    (item): item is CurrentDuty => item.role === 'current' && item.dutyStatus === 'onDuty',
  );
  if (duty === undefined) {
    throw new ServiceError('invalidInput', '沒有建立現任任期');
  }
  return duty;
}

export interface ReplaceStallionInput {
  readonly position: number;
  readonly generation: number;
  readonly successorId: string;
  readonly reason: ReplaceReason | undefined;
  /** 生效年；未填時傳入 undefined。 */
  readonly effectiveYear: number | undefined;
  readonly stallionNo: string;
}

interface Replacement {
  readonly position: number;
  readonly generation: number;
  readonly successorId: string;
  readonly reason: ReplaceReason;
  readonly effectiveYear: number;
  readonly stallionNo: number | undefined;
  /** 兄弟比較一律標示已被取代（需求規格 7.7）。 */
  readonly forceReplaced: boolean;
}

function planReplacement(
  context: ServiceContext,
  game: Game,
  state: StallionState,
  replacement: Replacement,
  now: string,
): StallionChange {
  const { position, generation, effectiveYear } = replacement;
  const issues: string[] = [];
  const predecessor = state.duties.find(
    (duty): duty is CurrentDuty => isOnDuty(duty) && duty.generation === generation,
  );
  if (predecessor === undefined) {
    issues.push(`${lineageText(position, generation)}目前沒有在崗的現任，請直接接任`);
  }
  const { issues: candidateIssues, lineage } = checkCandidate(
    state.candidate,
    state.line,
    position,
  );
  issues.push(...candidateIssues);
  if (
    lineage !== undefined &&
    (lineage.position !== position || lineage.generation !== generation)
  ) {
    issues.push(
      `後任必須是${lineageText(position, generation)}的種牡馬，這匹馬是${lineageText(lineage.position, lineage.generation)}`,
    );
  }
  if (predecessor !== undefined && predecessor.horseId === replacement.successorId) {
    issues.push('後任不能是目前的現任');
  }
  if (
    predecessor !== undefined &&
    (!Number.isInteger(effectiveYear) ||
      effectiveYear < predecessor.startYear ||
      effectiveYear > game.currentYear)
  ) {
    issues.push(
      `生效年必須是 ${String(predecessor.startYear)}～${String(game.currentYear)} 的整數`,
    );
  }
  const horse = state.candidate?.horse;
  if (
    issues.length > 0 ||
    predecessor === undefined ||
    lineage === undefined ||
    horse === undefined ||
    state.line === undefined
  ) {
    fail(issues);
  }
  const ended: CurrentDuty = {
    ...predecessor,
    dutyStatus: replacement.forceReplaced ? 'replaced' : statusForReplaceReason(replacement.reason),
    endYear: effectiveYear,
    replaceReason: replacement.reason,
    successorId: horse.id,
  };
  const started = startDuty(
    context,
    game,
    state,
    state.line,
    {
      horse,
      lineage,
      startYear: effectiveYear,
      stallionNo: replacement.stallionNo,
      predecessorId: predecessor.horseId,
    },
    now,
  );
  const endEvent = userEvent(context, {
    subjectId: predecessor.horseId,
    type: 'stallionDutyChanged',
    gameYear: game.currentYear,
    occurredAt: now,
    before: dutyStatusValue(predecessor),
    after: dutyStatusValue(ended),
  });
  return {
    duties: [ended, ...started.duties],
    horses: started.horses,
    events: [endEvent, ...started.events],
  };
}

async function runReplacement(
  context: ServiceContext,
  replacement: Replacement,
): Promise<CurrentDuty> {
  const game = await requireCurrentGame(context);
  const now = context.now().toISOString();
  const change = await trackWrite(context, () =>
    modifyStallionDuties(context.database, {
      gameId: game.id,
      request: { position: replacement.position, horseId: replacement.successorId },
      touch: gameTouch(context, now),
      apply: (stored, state) => planReplacement(context, stored, state, replacement, now),
    }),
  );
  return requireStartedDuty(change);
}

/**
 * 更換現任（需求規格 7.7、LINE-22）：保存前任、後任、生效年與原因；前任的配種、產駒與血緣保持原連結。
 * 後任必須是同系同代的種牡馬；同父弟弟可以取代哥哥，不要求同母。
 */
export async function replaceCurrentStallion(
  context: ServiceContext,
  input: ReplaceStallionInput,
): Promise<CurrentDuty> {
  const issues: string[] = [];
  const stallionNo = parseStallionNo(input.stallionNo, issues);
  if (input.reason === undefined) {
    issues.push('請選擇更換原因');
  }
  if (input.effectiveYear === undefined) {
    issues.push('請輸入生效年');
  }
  if (issues.length > 0 || input.reason === undefined || input.effectiveYear === undefined) {
    fail(issues);
  }
  return runReplacement(context, {
    position: input.position,
    generation: input.generation,
    successorId: input.successorId,
    reason: input.reason,
    effectiveYear: input.effectiveYear,
    stallionNo,
    forceReplaced: false,
  });
}

export type SettableDutyStatus = Exclude<DutyStatus, 'replaced'>;

export interface DutyStatusInput {
  readonly dutyId: string;
  readonly status: SettableDutyStatus;
  /** 離開在崗的年份；改回在崗時不使用。 */
  readonly year: number | undefined;
}

/**
 * 標示現任退出生產行列或已引退，或更正回在崗（需求規格 7.7）：只由使用者執行；已被取代的任期不能改狀態，
 * 改回在崗時同系同代不能已有其他在崗現任。
 */
export async function changeDutyStatus(
  context: ServiceContext,
  input: DutyStatusInput,
): Promise<CurrentDuty> {
  const game = await requireCurrentGame(context);
  const found = await getStallionDuty(context.database, game.id, input.dutyId);
  if (found?.role !== 'current') {
    fail(['找不到這筆現任任期']);
  }
  const now = context.now().toISOString();
  const change = await trackWrite(context, () =>
    modifyStallionDuties(context.database, {
      gameId: game.id,
      request: { position: found.position },
      touch: gameTouch(context, now),
      apply: (stored, state) => {
        const duty = state.duties.find(
          (item): item is CurrentDuty => item.id === input.dutyId && item.role === 'current',
        );
        if (duty === undefined) {
          fail(['找不到這筆現任任期']);
        }
        if (duty.dutyStatus === 'replaced') {
          fail(['已被取代的任期不能改狀態']);
        }
        if (duty.dutyStatus === input.status) {
          fail(['任期狀態沒有變更']);
        }
        let next: CurrentDuty;
        if (input.status === 'onDuty') {
          if (
            state.duties.some(
              (item) =>
                item.id !== duty.id && isOnDuty(item) && item.generation === duty.generation,
            )
          ) {
            fail([`${lineageText(duty.position, duty.generation)}已有其他在崗的現任`]);
          }
          next = {
            id: duty.id,
            position: duty.position,
            generation: duty.generation,
            horseId: duty.horseId,
            role: 'current',
            dutyStatus: 'onDuty',
            startYear: duty.startYear,
          };
        } else {
          const { year } = input;
          if (
            year === undefined ||
            !Number.isInteger(year) ||
            year < duty.startYear ||
            year > stored.currentYear
          ) {
            fail([`年份必須是 ${String(duty.startYear)}～${String(stored.currentYear)} 的整數`]);
          }
          next = { ...duty, dutyStatus: input.status, endYear: year };
        }
        const event = userEvent(context, {
          subjectId: duty.horseId,
          type: 'stallionDutyChanged',
          gameYear: stored.currentYear,
          occurredAt: now,
          before: dutyStatusValue(duty),
          after: dutyStatusValue(next),
        });
        return { duties: [next], horses: [], events: [event] };
      },
    }),
  );
  const [duty] = change.duties;
  if (duty?.role !== 'current') {
    fail(['找不到這筆現任任期']);
  }
  return duty;
}

export interface PlannedSuccessorInput {
  readonly position: number;
  /** 指定既有的公駒；與 breedingId 擇一。 */
  readonly horseId?: string | undefined;
  /** 指定已受胎、產駒尚未出生的八系指定配種。 */
  readonly breedingId?: string | undefined;
  /** 指定馬匹時的就緒狀態。 */
  readonly readiness?: PlannedReadiness | undefined;
}

function isSettableReadiness(readiness: PlannedReadiness | undefined): boolean {
  return readiness === 'racing' || readiness === 'retiredPending';
}

/** 預定後繼的系與代數：指定馬匹時核對 9.6，指定配種時由父母推導。 */
function plannedTarget(
  state: StallionState,
  input: PlannedSuccessorInput,
): { readonly lineage: Lineage; readonly readiness: PlannedReadiness } {
  const issues: string[] = [];
  if (input.horseId !== undefined) {
    const { issues: candidateIssues, lineage } = checkCandidate(
      state.candidate,
      state.line,
      input.position,
    );
    issues.push(...candidateIssues);
    if (!isSettableReadiness(input.readiness)) {
      issues.push('請選擇就緒狀態');
    }
    if (state.duties.some((duty) => isOnDuty(duty) && duty.horseId === input.horseId)) {
      issues.push('這匹馬已經是現任');
    }
    if (issues.length > 0 || lineage === undefined || input.readiness === undefined) {
      fail(issues);
    }
    return { lineage, readiness: input.readiness };
  }
  const birth = state.birth;
  const breeding = birth?.breeding;
  if (birth === undefined || breeding === undefined) {
    fail(['找不到這筆配種紀錄']);
  }
  if (breeding.breedingType !== 'designated') {
    issues.push('只有八系指定配種可以指定為預定後繼');
  }
  if (breeding.conception !== '受胎') {
    issues.push('只有已受胎的配種可以指定為尚未誕生的預定後繼');
  }
  if (breeding.foalId !== undefined) {
    issues.push('產駒已出生，請改為指定產駒本身');
  }
  const lineage = deriveOffspringLineage(birth.sire, birth.dam);
  if (lineage === undefined) {
    issues.push('無法推導產駒的系與代數：找不到父馬的系位置或母馬的母馬群');
  } else if (lineage.position !== input.position) {
    issues.push(
      `產駒會屬於第 ${String(lineage.position)} 系，不能指定為第 ${String(input.position)} 系的預定後繼`,
    );
  }
  if (state.line === undefined) {
    issues.push(`第 ${String(input.position)} 系尚未開啟`);
  }
  if (issues.length > 0 || lineage === undefined) {
    fail(issues);
  }
  return { lineage, readiness: 'unborn' };
}

/**
 * 指定預定後繼（需求規格 7.7）：每系一匹；可以指定既有公駒，或已受胎、產駒尚未出生的八系指定配種。
 * 已有進行中的指定時結束原指定，歷程保存前後值。
 */
export async function setPlannedSuccessor(
  context: ServiceContext,
  input: PlannedSuccessorInput,
): Promise<PlannedDuty> {
  if ((input.horseId === undefined) === (input.breedingId === undefined)) {
    fail(['請選擇一匹公駒或一筆已受胎的配種']);
  }
  const game = await requireCurrentGame(context);
  const now = context.now().toISOString();
  const change = await trackWrite(context, () =>
    modifyStallionDuties(context.database, {
      gameId: game.id,
      request: input,
      touch: gameTouch(context, now),
      apply: (stored, state) => {
        const { lineage, readiness } = plannedTarget(state, input);
        const line = state.line;
        if (line === undefined) {
          fail([`第 ${String(input.position)} 系尚未開啟`]);
        }
        const existing = state.duties.find(isActivePlanned);
        if (
          existing !== undefined &&
          existing.horseId === input.horseId &&
          existing.breedingId === input.breedingId &&
          existing.readiness === readiness
        ) {
          fail(['預定後繼沒有變更']);
        }
        const planned: PlannedDuty = {
          id: context.newId(),
          position: lineage.position,
          generation: lineage.generation,
          role: 'planned',
          ...(input.horseId === undefined ? {} : { horseId: input.horseId }),
          ...(input.breedingId === undefined ? {} : { breedingId: input.breedingId }),
          readiness,
          startYear: stored.currentYear,
        };
        const ended =
          existing === undefined
            ? undefined
            : { ...existing, endYear: plannedEndYear(existing, stored.currentYear) };
        const event = userEvent(context, {
          subjectId: line.id,
          type: 'plannedSuccessorChanged',
          gameYear: stored.currentYear,
          occurredAt: now,
          before: existing === undefined ? undefined : plannedValue(existing),
          after: plannedValue(planned),
        });
        return {
          duties: ended === undefined ? [planned] : [ended, planned],
          horses: [],
          events: [event],
        };
      },
    }),
  );
  const planned = change.duties.find(
    (duty): duty is PlannedDuty => duty.role === 'planned' && duty.endYear === undefined,
  );
  if (planned === undefined) {
    fail(['沒有建立預定後繼']);
  }
  return planned;
}

type PlannedUpdate = (planned: PlannedDuty, state: StallionState, game: Game) => PlannedDuty;

async function updatePlanned(
  context: ServiceContext,
  position: number,
  update: PlannedUpdate,
): Promise<PlannedDuty> {
  const game = await requireCurrentGame(context);
  const now = context.now().toISOString();
  const change = await trackWrite(context, () =>
    modifyStallionDuties(context.database, {
      gameId: game.id,
      request: { position },
      touch: gameTouch(context, now),
      apply: (stored, state) => {
        const planned = state.duties.find(isActivePlanned);
        if (planned === undefined || state.line === undefined) {
          fail([`第 ${String(position)} 系沒有進行中的預定後繼`]);
        }
        const next = update(planned, state, stored);
        const event = userEvent(context, {
          subjectId: state.line.id,
          type: 'plannedSuccessorChanged',
          gameYear: stored.currentYear,
          occurredAt: now,
          before: plannedValue(planned),
          after: plannedValue(next),
        });
        return { duties: [next], horses: [], events: [event] };
      },
    }),
  );
  const [duty] = change.duties;
  if (duty?.role !== 'planned') {
    fail(['沒有更新預定後繼']);
  }
  return duty;
}

/** 更新預定後繼的就緒狀態（競走中、已引退待指定）。 */
export async function updatePlannedReadiness(
  context: ServiceContext,
  input: { readonly position: number; readonly readiness: PlannedReadiness | undefined },
): Promise<PlannedDuty> {
  return updatePlanned(context, input.position, (planned) => {
    if (planned.horseId === undefined) {
      fail(['尚未誕生的預定後繼要先確認產駒']);
    }
    if (!isSettableReadiness(input.readiness) || input.readiness === undefined) {
      fail(['請選擇就緒狀態']);
    }
    if (planned.readiness === input.readiness) {
      fail(['就緒狀態沒有變更']);
    }
    return { ...planned, readiness: input.readiness };
  });
}

/**
 * 產駒出生後確認預定後繼（需求規格 7.7）：不自動改指，由使用者確認；產駒為牝時預定後繼失效，
 * 只能重新指定或取消。確認前依 9.6 再次核對父母、系與代數。
 */
export async function confirmPlannedBirth(
  context: ServiceContext,
  position: number,
): Promise<PlannedDuty> {
  return updatePlanned(context, position, (planned, state) => {
    if (planned.breedingId === undefined) {
      fail(['預定後繼不是尚未誕生的配種']);
    }
    const born = state.birth?.born;
    if (born?.horse === undefined) {
      fail(['產駒尚未出生']);
    }
    if (born.horse.sex !== 'male') {
      fail(['產駒是牝馬，預定後繼失效；請重新指定或取消']);
    }
    const { issues, lineage } = checkCandidate(born, state.line, position);
    if (issues.length > 0 || lineage === undefined) {
      fail(issues);
    }
    return {
      id: planned.id,
      position: planned.position,
      generation: lineage.generation,
      role: 'planned',
      horseId: born.horse.id,
      readiness: 'racing',
      startYear: planned.startYear,
    };
  });
}

/** 取消進行中的預定後繼；歷程保留原指定。 */
export async function endPlannedSuccessor(
  context: ServiceContext,
  position: number,
): Promise<PlannedDuty> {
  return updatePlanned(context, position, (planned, _state, game) => ({
    ...planned,
    endYear: plannedEndYear(planned, game.currentYear),
  }));
}

export type BrotherStatus = DutyStatus | 'notCurrent';

/** 兄弟比較的一列（需求規格 7.7、13.5）：只並排資料，不標示優劣。 */
export interface BrotherRow {
  readonly id: string;
  readonly name: string;
  readonly birthYear: number | undefined;
  readonly age: number | undefined;
  readonly damName: string | undefined;
  readonly sp: number | undefined;
  readonly st: number | undefined;
  readonly subParams: SubParams;
  readonly subParamTotal: number | undefined;
  readonly turf: Aptitude | undefined;
  readonly dirt: Aptitude | undefined;
  readonly distanceText: string | undefined;
  /** 在這個系與代數最近一次現任任期的狀態；沒有擔任過現任時為 notCurrent。 */
  readonly status: BrotherStatus;
}

export interface BrotherComparison {
  readonly position: number;
  readonly generation: number;
  readonly sireId: string;
  readonly sireName: string | undefined;
  readonly rows: readonly BrotherRow[];
}

interface StallionBook {
  readonly game: Game;
  readonly duties: readonly StallionDuty[];
  readonly foals: Map<string, Awaited<ReturnType<typeof listFoals>>[number]>;
  readonly horses: Map<string, Horse>;
}

async function loadStallionBook(context: ServiceContext): Promise<StallionBook> {
  const game = await requireCurrentGame(context);
  const [duties, foalList] = await Promise.all([
    listStallionDuties(context.database, game.id),
    listFoals(context.database, game.id),
  ]);
  const foals = new Map(foalList.map((foal) => [foal.id, foal]));
  const ids = new Set<string>();
  for (const foal of foalList) {
    ids.add(foal.id);
    ids.add(foal.damId);
  }
  for (const duty of duties) {
    if (duty.horseId !== undefined) {
      ids.add(duty.horseId);
    }
    if (duty.role === 'current' && duty.successorId !== undefined) {
      ids.add(duty.successorId);
    }
  }
  const horses = await getHorsesByIds(context.database, game.id, [...ids]);
  const sireIds = [...horses.values()].flatMap((horse) =>
    horse.sireId === undefined || horses.has(horse.sireId) ? [] : [horse.sireId],
  );
  const sires = await getHorsesByIds(context.database, game.id, [...new Set(sireIds)]);
  return { game, duties, foals, horses: new Map([...horses, ...sires]) };
}

function latestCurrentDuty(
  duties: readonly StallionDuty[],
  horseId: string,
  lineage: Lineage,
): CurrentDuty | undefined {
  return duties
    .filter(
      (duty): duty is CurrentDuty =>
        duty.role === 'current' &&
        duty.horseId === horseId &&
        duty.position === lineage.position &&
        duty.generation === lineage.generation,
    )
    .sort((a, b) => b.startYear - a.startYear || (isOnDuty(a) ? -1 : isOnDuty(b) ? 1 : 0))[0];
}

/** 同系同代、同父、已成為種牡馬（登記去向或擔任過現任）的兄弟，含自己。 */
function stallionBrothers(book: StallionBook, horse: Horse, lineage: Lineage): Horse[] {
  const { sireId } = horse;
  if (sireId === undefined) {
    return [horse];
  }
  return [...book.horses.values()].filter((item) => {
    const foal = book.foals.get(item.id);
    return (
      item.sireId === sireId &&
      item.sex === 'male' &&
      foal?.freeBred === false &&
      foal.lineage?.position === lineage.position &&
      foal.lineage.generation === lineage.generation &&
      (isStallionHorse(item) || latestCurrentDuty(book.duties, item.id, lineage) !== undefined)
    );
  });
}

function displayName(book: StallionBook, horse: Horse): string {
  const foal = book.foals.get(horse.id);
  const dam = foal === undefined ? undefined : book.horses.get(foal.damId);
  const tracking =
    foal === undefined
      ? undefined
      : trackingName(dam === undefined ? undefined : nameForTracking(dam), foal.birthYear);
  return horseDisplayName(horse, tracking) ?? horse.id;
}

/**
 * 種牡馬兄弟比較（需求規格 7.7、LINE-30、LINE-32）：同系同代兩匹以上同父兄弟成為種牡馬時並排比較，
 * 由使用者決定現任；系統不判定優劣，也不自動更換現任。
 */
export async function loadBrotherComparison(
  context: ServiceContext,
  horseId: string,
): Promise<BrotherComparison> {
  const book = await loadStallionBook(context);
  const horse = book.horses.get(horseId);
  const lineage = book.foals.get(horseId)?.lineage;
  if (horse === undefined || lineage === undefined || horse.sireId === undefined) {
    fail(['只有知道父馬、系與代數的自家種牡馬可以比較兄弟']);
  }
  const rows = stallionBrothers(book, horse, lineage)
    .map((item): BrotherRow => {
      const foal = book.foals.get(item.id);
      const dam = foal === undefined ? undefined : book.horses.get(foal.damId);
      return {
        id: item.id,
        name: displayName(book, item),
        birthYear: item.birthYear,
        age: ageInYear(item.birthYear, book.game.currentYear),
        damName: dam === undefined ? item.damName : displayName(book, dam),
        sp: foal?.sp,
        st: foal?.st,
        subParams: foal?.subParams ?? {},
        subParamTotal: subParamTotal(foal?.subParams),
        turf: foal?.turf,
        dirt: foal?.dirt,
        distanceText: foal?.distanceText,
        status: latestCurrentDuty(book.duties, item.id, lineage)?.dutyStatus ?? 'notCurrent',
      };
    })
    .sort((a, b) => (a.birthYear ?? 0) - (b.birthYear ?? 0) || a.id.localeCompare(b.id));
  const sireOf = book.horses.get(horse.sireId);
  return {
    position: lineage.position,
    generation: lineage.generation,
    sireId: horse.sireId,
    sireName: sireOf === undefined ? horse.sireName : displayName(book, sireOf),
    rows,
  };
}

export interface BrotherChoiceInput {
  readonly position: number;
  readonly generation: number;
  readonly sireId: string;
  readonly horseId: string;
}

/**
 * 從兄弟比較選定現任（需求規格 7.7、LINE-30、LINE-31）：只接受同系同代、同父且已成為種牡馬的兄弟，
 * 其他一律阻止；已有同父兄弟在崗時改由選定者擔任，原現任標示已被取代。在崗者不是同父兄弟時改用更換現任。
 */
export async function chooseCurrentFromBrothers(
  context: ServiceContext,
  input: BrotherChoiceInput,
): Promise<CurrentDuty> {
  const game = await requireCurrentGame(context);
  const now = context.now().toISOString();
  const change = await trackWrite(context, () =>
    modifyStallionDuties(context.database, {
      gameId: game.id,
      request: { position: input.position, horseId: input.horseId },
      touch: gameTouch(context, now),
      apply: (stored, state) => {
        const horse = state.candidate?.horse;
        const lineage = state.candidate?.foal?.lineage;
        const scope = `${lineageText(input.position, input.generation)}、同父的種牡馬`;
        if (
          horse === undefined ||
          lineage === undefined ||
          lineage.position !== input.position ||
          lineage.generation !== input.generation ||
          horse.sireId !== input.sireId
        ) {
          fail([`兄弟比較只接受${scope}`]);
        }
        const hasDuty = state.duties.some(
          (duty) => duty.role === 'current' && duty.horseId === horse.id,
        );
        if (!isStallionHorse(horse) && !hasDuty) {
          fail(['這匹馬尚未登記成為種牡馬']);
        }
        const onDuty = state.duties.find(
          (duty): duty is CurrentDuty => isOnDuty(duty) && duty.generation === input.generation,
        );
        if (onDuty?.horseId === horse.id) {
          fail(['這匹馬已經是現任']);
        }
        if (
          onDuty !== undefined &&
          state.onDutyHorses.get(onDuty.horseId)?.sireId !== input.sireId
        ) {
          fail(['目前的現任不是同父兄弟，請使用更換現任']);
        }
        if (onDuty === undefined) {
          const { issues, lineage: checked } = checkCandidate(
            state.candidate,
            state.line,
            input.position,
          );
          if (issues.length > 0 || checked === undefined || state.line === undefined) {
            fail(issues);
          }
          return startDuty(
            context,
            stored,
            state,
            state.line,
            { horse, lineage: checked, startYear: stored.currentYear, stallionNo: undefined },
            now,
          );
        }
        return planReplacement(
          context,
          stored,
          state,
          {
            position: input.position,
            generation: input.generation,
            successorId: horse.id,
            reason: 'betterBrother',
            effectiveYear: stored.currentYear,
            stallionNo: undefined,
            forceReplaced: true,
          },
          now,
        );
      },
    }),
  );
  return requireStartedDuty(change);
}

/** 八系頁的一筆現任任期。 */
export interface CurrentStallionView {
  readonly dutyId: string;
  readonly horseId: string;
  readonly name: string;
  readonly generation: number;
  readonly dutyStatus: DutyStatus;
  readonly startYear: number;
  readonly endYear: number | undefined;
  readonly replaceReason: ReplaceReason | undefined;
  readonly successorName: string | undefined;
  readonly age: number | undefined;
  /** 在崗且達到種牡馬提醒年齡（LINE-26）。 */
  readonly reminder: boolean;
  /** 同系同代、同父且已成為種牡馬的兄弟數（含自己）；2 匹以上時可比較。 */
  readonly brotherCount: number;
}

export interface PlannedSuccessorView {
  readonly generation: number;
  readonly readiness: PlannedReadiness;
  readonly startYear: number;
  readonly horse: { readonly id: string; readonly name: string } | undefined;
  readonly birth:
    | {
        readonly label: string;
        readonly expectedBirthYear: number | undefined;
        /** 產駒已出生時的名稱與性別。 */
        readonly born: { readonly name: string; readonly sex: Sex } | undefined;
      }
    | undefined;
}

export interface SuccessorOption {
  readonly id: string;
  readonly name: string;
  readonly generation: number;
}

export interface LineStallions {
  readonly position: number;
  readonly current: readonly CurrentStallionView[];
  readonly planned: PlannedSuccessorView | undefined;
  readonly reminders: readonly string[];
  /** 這個系的自家公駒（非自由配種、目前不是在崗現任），供接任、更換與預定後繼選擇。 */
  readonly successorOptions: readonly SuccessorOption[];
  /** 已受胎、產駒尚未出生、會屬於這個系的八系指定配種。 */
  readonly breedingOptions: readonly SuccessorOption[];
}

export interface StallionOverview {
  readonly currentYear: number;
  readonly reminderAge: number;
  readonly lines: readonly LineStallions[];
}

function successorNameOf(book: StallionBook, successorId: string | undefined): string | undefined {
  const successor = successorId === undefined ? undefined : book.horses.get(successorId);
  return successor === undefined ? successorId : displayName(book, successor);
}

function birthLabel(
  book: StallionBook,
  damId: string,
  stallionId: string | undefined,
  gameYear: number,
): string {
  const damHorse = book.horses.get(damId);
  const sire = stallionId === undefined ? undefined : book.horses.get(stallionId);
  const damName = damHorse === undefined ? '未知母馬' : displayName(book, damHorse);
  const sireName = sire === undefined ? '未知種牡馬' : displayName(book, sire);
  return `${damName} × ${sireName}（${String(gameYear)} 年受胎）`;
}

/** 八系頁的種牡馬資料（需求規格 7.7、13.2）：各系現任、預定後繼、提醒與可選的後繼。 */
export async function loadStallionOverview(context: ServiceContext): Promise<StallionOverview> {
  const book = await loadStallionBook(context);
  const { game } = book;
  const [lines, breedings, mares, settings] = await Promise.all([
    listLines(context.database, game.id),
    listBreedings(context.database, game.id),
    listMares(context.database, game.id),
    readGameSettings(context.database, game.id),
  ]);
  const reminderAge = (settings ?? DEFAULT_GAME_SETTINGS).stallionAgeReminderAge;
  const breedingHorseIds = breedings.flatMap((item) => [
    item.mareId,
    ...(item.stallionId === undefined ? [] : [item.stallionId]),
  ]);
  const missing = breedingHorseIds.filter((id) => !book.horses.has(id));
  for (const [id, horse] of await getHorsesByIds(context.database, game.id, [
    ...new Set(missing),
  ])) {
    book.horses.set(id, horse);
  }
  const maresById = new Map(mares.map((mare) => [mare.id, mare]));
  const lineageOfStallion = (horseId: string): Lineage | undefined => {
    const duty = book.duties.find((item) => item.role === 'current' && item.horseId === horseId);
    return duty === undefined
      ? book.foals.get(horseId)?.lineage
      : { position: duty.position, generation: duty.generation };
  };
  const sorted = [...lines].sort((a, b) => a.position - b.position);
  return {
    currentYear: game.currentYear,
    reminderAge,
    lines: sorted.map((line): LineStallions => {
      const duties = book.duties.filter((duty) => duty.position === line.position);
      const current = duties
        .filter((duty): duty is CurrentDuty => duty.role === 'current')
        .map((duty): CurrentStallionView => {
          const horse = book.horses.get(duty.horseId);
          const age = ageInYear(horse?.birthYear, game.currentYear);
          const lineage = { position: duty.position, generation: duty.generation };
          return {
            dutyId: duty.id,
            horseId: duty.horseId,
            name: horse === undefined ? duty.horseId : displayName(book, horse),
            generation: duty.generation,
            dutyStatus: duty.dutyStatus,
            startYear: duty.startYear,
            endYear: duty.endYear,
            replaceReason: duty.replaceReason,
            successorName: successorNameOf(book, duty.successorId),
            age,
            reminder: isOnDuty(duty) && reachesStallionReminderAge(age, reminderAge),
            brotherCount: horse === undefined ? 1 : stallionBrothers(book, horse, lineage).length,
          };
        })
        .sort(
          (a, b) =>
            b.generation - a.generation ||
            Number(b.dutyStatus === 'onDuty') - Number(a.dutyStatus === 'onDuty') ||
            b.startYear - a.startYear,
        );
      const reminders = current
        .filter((item) => item.reminder)
        .map(
          (item) =>
            `第 ${String(line.position)} 系 ${String(item.generation)} 代現任「${item.name}」已 ${String(item.age)} 歲，達到種牡馬提醒年齡，請準備後繼`,
        );
      const plannedDuty = duties.find(isActivePlanned);
      let planned: PlannedSuccessorView | undefined;
      if (plannedDuty !== undefined) {
        const horse =
          plannedDuty.horseId === undefined ? undefined : book.horses.get(plannedDuty.horseId);
        const breeding = breedings.find((item) => item.id === plannedDuty.breedingId);
        const bornHorse =
          breeding?.foalId === undefined ? undefined : book.horses.get(breeding.foalId);
        planned = {
          generation: plannedDuty.generation,
          readiness: plannedDuty.readiness,
          startYear: plannedDuty.startYear,
          horse:
            plannedDuty.horseId === undefined
              ? undefined
              : {
                  id: plannedDuty.horseId,
                  name: horse === undefined ? plannedDuty.horseId : displayName(book, horse),
                },
          birth:
            breeding === undefined
              ? undefined
              : {
                  label: birthLabel(book, breeding.mareId, breeding.stallionId, breeding.gameYear),
                  expectedBirthYear: breeding.expectedBirthYear,
                  born:
                    bornHorse === undefined
                      ? undefined
                      : { name: displayName(book, bornHorse), sex: bornHorse.sex },
                },
        };
        if (bornHorse?.sex === 'female') {
          reminders.push(
            `第 ${String(line.position)} 系的預定後繼「${displayName(book, bornHorse)}」出生為牝馬，預定後繼失效，請重新指定或取消`,
          );
        } else if (bornHorse !== undefined) {
          reminders.push(
            `第 ${String(line.position)} 系的預定後繼已出生（${displayName(book, bornHorse)}），請確認`,
          );
        }
      }
      const onDutyIds = new Set(
        duties.filter((duty) => isOnDuty(duty)).map((duty) => duty.horseId),
      );
      const successorOptions = [...book.foals.values()]
        .filter(
          (foal) =>
            !foal.freeBred &&
            foal.lineage?.position === line.position &&
            book.horses.get(foal.id)?.sex === 'male' &&
            !onDutyIds.has(foal.id),
        )
        .map((foal): SuccessorOption => {
          const horse = book.horses.get(foal.id);
          return {
            id: foal.id,
            name: horse === undefined ? foal.id : displayName(book, horse),
            generation: foal.lineage?.generation ?? 0,
          };
        })
        .sort((a, b) => b.generation - a.generation || a.name.localeCompare(b.name, 'ja'));
      const breedingOptions = breedings.flatMap((breeding): SuccessorOption[] => {
        if (
          breeding.breedingType !== 'designated' ||
          breeding.conception !== '受胎' ||
          breeding.foalId !== undefined ||
          breeding.stallionId === undefined
        ) {
          return [];
        }
        const sireLineage = lineageOfStallion(breeding.stallionId);
        const dam = maresById.get(breeding.mareId);
        const damGeneration = dam === undefined ? undefined : mareGeneration(dam.group);
        if (sireLineage?.position !== line.position || damGeneration === undefined) {
          return [];
        }
        const generation = Math.max(sireLineage.generation, damGeneration) + 1;
        return [
          {
            id: breeding.id,
            name: `${birthLabel(book, breeding.mareId, breeding.stallionId, breeding.gameYear)}・預定第 ${String(line.position)} 系 ${String(generation)} 代`,
            generation,
          },
        ];
      });
      return {
        position: line.position,
        current,
        planned,
        reminders,
        successorOptions,
        breedingOptions,
      };
    }),
  };
}

/** 產駒面板用的種牡馬狀態。 */
export interface HorseStallionStatus {
  readonly isStallion: boolean;
  /** 最近一次現任任期。 */
  readonly current:
    | { readonly position: number; readonly generation: number; readonly dutyStatus: DutyStatus }
    | undefined;
  /** 這匹馬是進行中的預定後繼時。 */
  readonly planned: { readonly position: number; readonly readiness: PlannedReadiness } | undefined;
  readonly stallionNumbers: readonly string[];
}

export async function loadHorseStallionStatus(
  context: ServiceContext,
  horseId: string,
): Promise<HorseStallionStatus> {
  const game = await requireCurrentGame(context);
  const [duties, horses] = await Promise.all([
    listStallionDuties(context.database, game.id),
    getHorsesByIds(context.database, game.id, [horseId]),
  ]);
  const horse = horses.get(horseId);
  const own = duties.filter((duty) => duty.horseId === horseId);
  const current = own
    .filter((duty): duty is CurrentDuty => duty.role === 'current')
    .sort((a, b) => b.startYear - a.startYear || Number(isOnDuty(b)) - Number(isOnDuty(a)))[0];
  const planned = own.find(isActivePlanned);
  return {
    isStallion: horse !== undefined && isStallionHorse(horse),
    current:
      current === undefined
        ? undefined
        : {
            position: current.position,
            generation: current.generation,
            dutyStatus: current.dutyStatus,
          },
    planned:
      planned === undefined
        ? undefined
        : { position: planned.position, readiness: planned.readiness },
    stallionNumbers: (horse?.stageNumbers ?? [])
      .filter((item) => item.stage === 'stallion')
      .map((item) => formatAbilityNo(item.number)),
  };
}
