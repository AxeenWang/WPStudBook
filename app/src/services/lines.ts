import { MIN_GAME_YEAR, type Game } from '../domain/game.ts';
import { formatAbilityNo, parseAbilityNo, toBaseName, type Horse } from '../domain/horse.ts';
import {
  LINE_COLORS,
  LINE_POSITIONS,
  parentSystemStatus,
  pickLineColor,
  type Line,
  type LineColor,
  type LinePosition,
  type ParentSystemStatus,
} from '../domain/line.ts';
import type { HistoryEvent } from '../domain/history-event.ts';
import type { CurrentDuty, StallionDuty } from '../domain/stallion-duty.ts';
import type { SystemMapEntry } from '../domain/system-map.ts';
import { findHorseByIdentity, getHorse } from '../storage/horses.ts';
import { insertOpenedLine, listLines, writeLineSystems } from '../storage/lines.ts';
import { listStallionDuties } from '../storage/stallion-duties.ts';
import { findSystemMapEntry } from '../storage/system-map.ts';
import { trackWrite, type ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import { userEvent, type UserEventInput } from './events.ts';
import { gameTouch, requireCurrentGame } from './games.ts';
import { normalizeSystemInput } from './system-map.ts';
import { listLineTasks } from './tasks.ts';
import { requireAcceptedWarnings, type ServiceWarning } from './warnings.ts';

/** 介面用的代表色選項（ui 不能引用 domain 的值）。 */
export const LINE_COLOR_OPTIONS: readonly LineColor[] = LINE_COLORS;

export function defaultLineColor(): string {
  return pickLineColor([]);
}

export function lineColorLabel(color: string): string {
  return LINE_COLORS.find((option) => option.value === color)?.label ?? color;
}

export interface LineSlot {
  readonly position: LinePosition;
  readonly line?: Line;
  readonly founderName?: string;
}

/** 八個系位置（需求規格 7.1）；未開啟的位置只有 position。 */
export async function listLineSlots(context: ServiceContext): Promise<LineSlot[]> {
  const game = await requireCurrentGame(context);
  const [lines, duties] = await Promise.all([
    listLines(context.database, game.id),
    listStallionDuties(context.database, game.id),
  ]);
  return Promise.all(
    LINE_POSITIONS.map(async (position): Promise<LineSlot> => {
      const line = lines.find((item) => item.position === position);
      if (line === undefined) {
        return { position };
      }
      const founderDuty = duties.find(
        (duty): duty is CurrentDuty =>
          duty.position === position && duty.generation === 0 && duty.role === 'current',
      );
      const founder =
        founderDuty === undefined
          ? undefined
          : await getHorse(context.database, game.id, founderDuty.horseId);
      return founder?.fullName === undefined
        ? { position, line }
        : { position, line, founderName: founder.fullName };
    }),
  );
}

export interface FounderInput {
  readonly fullName: string;
  /** 能力番号文字；空白表示未填。 */
  readonly abilityNo: string;
  readonly birthYear?: number | undefined;
  readonly sireName: string;
  readonly damName: string;
  /**
   * 沿用既有的馬匹紀錄（需求規格 11.9）：目標種牡馬 TXT 匯入時，五月總表可能已經建立過
   * 這一匹，以能力番号＋出生年配對到就沿用，不另建一匹也不當成身分衝突。
   */
  readonly reuse?: Horse | undefined;
}

export type OpenLineWarningCode = 'parentSystemDiffersFromMap' | 'parentSystemDuplicated';

export type OpenLineWarning = ServiceWarning<OpenLineWarningCode>;

/** 可以開啟的系位置（需求規格 7.3、LINE-02）：只有規則指定的位置。 */
export interface OpenableLine {
  readonly position: LinePosition;
  /** 這個位置要產出的代數；第 1 系起點為 1。 */
  readonly targetGeneration: number;
  /** 建立新系所用的母馬群（第 p 系 g−1 代）；第 1 系起點沒有。 */
  readonly damPosition: LinePosition | undefined;
  readonly damGeneration: number | undefined;
  /** 自動分配的代表色，可以改選（需求規格 7.1、LINE-02）。 */
  readonly suggestedColor: string;
}

/**
 * 目前可以開啟的系位置（需求規格 7.3、LINE-02）：還沒有任何系時只有第 1 系起點，
 * 之後只有建系分支「建立新系」指向、且尚未開啟的位置。
 */
export async function listOpenableLines(context: ServiceContext): Promise<OpenableLine[]> {
  const game = await requireCurrentGame(context);
  const lines = await listLines(context.database, game.id);
  const suggestedColor = pickLineColor(lines.map((line) => line.color));
  if (lines.length === 0) {
    return [
      {
        position: 1,
        targetGeneration: 1,
        damPosition: undefined,
        damGeneration: undefined,
        suggestedColor,
      },
    ];
  }
  const opened = new Set(lines.map((line) => line.position));
  const tasks = await listLineTasks(context);
  const openable = new Map<LinePosition, OpenableLine>();
  for (const task of tasks) {
    if (task.kind !== 'found' || opened.has(task.sire.position)) {
      continue;
    }
    openable.set(task.sire.position, {
      position: task.sire.position,
      targetGeneration: task.target.generation,
      damPosition: task.dam.position,
      damGeneration: task.dam.generation,
      suggestedColor,
    });
  }
  return [...openable.values()].sort((a, b) => a.position - b.position);
}

export interface OpenLineInput {
  readonly position: LinePosition;
  readonly subsystem: string;
  readonly parentSystem: string;
  readonly color: string;
  readonly founder: FounderInput;
  /** 使用者已確認的警告（需求規格 5.2）。 */
  readonly acceptedWarnings?: readonly OpenLineWarningCode[] | undefined;
}

export interface OpenLineCheck {
  readonly issues: readonly string[];
  readonly warnings: readonly OpenLineWarning[];
}

export interface OpenLineInspection extends OpenLineCheck {
  readonly targetGeneration: number;
  readonly subsystem: string;
  readonly parentSystem: string;
  /** 資料契約的代表色是小寫 #rrggbb。 */
  readonly color: string;
  readonly fullName: string;
  readonly abilityNo: number | undefined;
  readonly mapEntry: SystemMapEntry | undefined;
}

function duplicateParentSystemWarning(
  lines: readonly Line[],
  position: LinePosition,
  parentSystem: string,
): OpenLineWarning | undefined {
  const others = lines.filter((line) => line.position !== position);
  const duplicated = others.some((line) => line.parentSystem === parentSystem);
  if (!duplicated || parentSystem === '') {
    return undefined;
  }
  const positions = others
    .filter((line) => line.parentSystem === parentSystem)
    .map((line) => `第 ${String(line.position)} 系`)
    .join('、');
  return {
    code: 'parentSystemDuplicated',
    message: `親系統「${parentSystem}」已用於${positions}；八系親系統重複會讓活血少於 8 種`,
  };
}

async function inspectOpenLine(
  context: ServiceContext,
  game: Game,
  input: OpenLineInput,
): Promise<OpenLineInspection> {
  const subsystem = normalizeSystemInput(input.subsystem);
  const parentSystem = normalizeSystemInput(input.parentSystem);
  const color = input.color.toLowerCase();
  const fullName = input.founder.fullName.trim();
  const abilityText = input.founder.abilityNo.trim();
  const abilityNo = abilityText === '' ? undefined : parseAbilityNo(abilityText);
  const { birthYear } = input.founder;
  const [lines, openable] = await Promise.all([
    listLines(context.database, game.id),
    listOpenableLines(context),
  ]);
  const slot = openable.find((item) => item.position === input.position);
  const issues: string[] = [];
  if (slot === undefined) {
    const positions = openable.map((item) => `第 ${String(item.position)} 系`).join('、');
    if (lines.some((line) => line.position === input.position)) {
      issues.push(`第 ${String(input.position)} 系已經開啟`);
    } else {
      issues.push(
        openable.length === 0
          ? `第 ${String(input.position)} 系現在不能開啟，請先完成上一層分支`
          : `第 ${String(input.position)} 系不是規則指定的位置，目前只能開啟${positions}`,
      );
    }
  }
  if (subsystem === '') {
    issues.push('請輸入目前子系統');
  }
  if (parentSystem === '') {
    issues.push('請輸入親系統');
  }
  if (!LINE_COLORS.some((option) => option.value === color)) {
    issues.push('請選擇代表色');
  }
  if (fullName === '') {
    issues.push('請輸入零代市場種牡馬的馬名');
  } else if (toBaseName(fullName) === '') {
    issues.push('馬名不能只有 (外)、[地] 前綴');
  }
  if (abilityText !== '' && abilityNo === undefined) {
    issues.push('能力番号必須是 0x0000～0xFFFF 的十六進位');
  }
  if (
    birthYear !== undefined &&
    (!Number.isInteger(birthYear) || birthYear < MIN_GAME_YEAR || birthYear > game.currentYear)
  ) {
    issues.push(`出生年必須是 ${String(MIN_GAME_YEAR)}～${String(game.currentYear)} 的整數`);
  }
  if (issues.length === 0 && abilityNo !== undefined && birthYear !== undefined) {
    const existing = await findHorseByIdentity(context.database, game.id, abilityNo, birthYear);
    if (existing !== undefined && existing.id !== input.founder.reuse?.id) {
      const name = existing.fullName ?? existing.officialName ?? existing.id;
      issues.push(
        `能力番号 ${formatAbilityNo(abilityNo)} 與出生年 ${String(birthYear)} 已屬於「${name}」`,
      );
    }
  }
  const mapEntry =
    subsystem === '' ? undefined : await findSystemMapEntry(context.database, game.id, subsystem);
  const duplicate = duplicateParentSystemWarning(lines, input.position, parentSystem);
  const warnings: OpenLineWarning[] = [
    ...(mapEntry !== undefined && parentSystem !== '' && mapEntry.parentSystem !== parentSystem
      ? [
          {
            code: 'parentSystemDiffersFromMap' as const,
            message: `系統對照表記載「${subsystem}」的親系統是「${mapEntry.parentSystem}」，確認後會改為「${parentSystem}」`,
          },
        ]
      : []),
    ...(duplicate === undefined ? [] : [duplicate]),
  ];
  return {
    issues,
    warnings,
    targetGeneration: slot?.targetGeneration ?? 1,
    subsystem,
    parentSystem,
    color,
    fullName,
    abilityNo,
    mapEntry,
  };
}

/**
 * 開啟系位置的檢查結果，含建立紀錄需要的資料（需求規格 7.1）。
 * 目標種牡馬 TXT 的匯入在預覽時取得，套用時交給 `buildOpenedLine`（11.9）。
 */
export async function prepareOpenLine(
  context: ServiceContext,
  input: OpenLineInput,
): Promise<OpenLineInspection> {
  return inspectOpenLine(context, await requireCurrentGame(context), input);
}

export async function checkOpenLine(
  context: ServiceContext,
  input: OpenLineInput,
): Promise<OpenLineCheck> {
  const game = await requireCurrentGame(context);
  const { issues, warnings } = await inspectOpenLine(context, game, input);
  return { issues, warnings };
}

/** 開啟系位置要寫的紀錄與事件；`openLine` 與目標種牡馬 TXT 匯入共用（需求規格 7.1、11.9）。 */
export interface OpenedLineRecords {
  readonly line: Line;
  readonly founder: Horse;
  readonly duty: StallionDuty;
  readonly systemMapEntry: SystemMapEntry | undefined;
  readonly events: readonly HistoryEvent[];
}

export interface BuildOpenedLineInput {
  readonly position: LinePosition;
  readonly inspection: OpenLineInspection;
  readonly founder: FounderInput;
  readonly gameYear: number;
  readonly occurredAt: string;
  readonly newId: () => string;
}

/**
 * 只組紀錄，不讀不寫：匯入的套用在單一交易內只能做同步運算（需求規格 11.1）。
 * 沿用既有馬匹時保留內部識別、階段馬番号與別名，只補上零代種牡馬需要的欄位。
 */
export function buildOpenedLine(input: BuildOpenedLineInput): OpenedLineRecords {
  const { inspection, position, gameYear, occurredAt, newId } = input;
  const { subsystem, parentSystem, color, fullName, abilityNo, mapEntry, warnings } = inspection;
  const { birthYear, reuse } = input.founder;
  const sireName = input.founder.sireName.trim();
  const damName = input.founder.damName.trim();
  const event = (
    subjectId: string,
    type: HistoryEvent['type'],
    payload: Pick<UserEventInput, 'before' | 'after'>,
  ) => userEvent({ newId }, { subjectId, type, gameYear, occurredAt, ...payload });

  const base: Horse = reuse ?? {
    id: newId(),
    sex: 'male',
    fullName,
    baseName: toBaseName(fullName),
    stageNumbers: [],
    aliases: [],
  };
  const founder: Horse = {
    ...base,
    fullName,
    baseName: toBaseName(fullName),
    ...(abilityNo === undefined ? {} : { abilityNo }),
    ...(birthYear === undefined ? {} : { birthYear }),
    ...(sireName === '' ? {} : { sireName }),
    ...(damName === '' ? {} : { damName }),
    sireSubsystem: subsystem,
  };
  const line: Line = {
    id: newId(),
    position,
    subsystem,
    parentSystem,
    color,
    branch: { targetGeneration: inspection.targetGeneration, openedYear: gameYear },
    establishedGenerations: [],
  };
  const duty: StallionDuty = {
    id: newId(),
    position,
    generation: 0,
    horseId: founder.id,
    role: 'current',
    dutyStatus: 'onDuty',
    startYear: gameYear,
  };
  const systemMapEntry: SystemMapEntry | undefined =
    mapEntry?.parentSystem === parentSystem
      ? undefined
      : { id: mapEntry?.id ?? newId(), subsystem, parentSystem };
  const events: HistoryEvent[] = [
    // 沿用既有紀錄時這一匹不是新建的，不重複寫建立事件。
    ...(reuse === undefined
      ? [event(founder.id, 'horseCreated', { after: { fullName, sex: 'male' } })]
      : []),
    event(line.id, 'lineOpened', {
      after: {
        position,
        subsystem,
        parentSystem,
        founderId: founder.id,
        ...(warnings.length === 0
          ? {}
          : { confirmations: warnings.map((warning) => warning.code) }),
      },
    }),
    event(founder.id, 'stallionDutyStarted', {
      after: { position, generation: 0, role: 'current' },
    }),
    ...(systemMapEntry === undefined
      ? []
      : [
          event(systemMapEntry.id, 'systemMapChanged', {
            before:
              mapEntry === undefined
                ? undefined
                : { subsystem: mapEntry.subsystem, parentSystem: mapEntry.parentSystem },
            after: { subsystem, parentSystem },
          }),
        ]),
  ];
  return { line, founder, duty, systemMapEntry, events };
}

/**
 * 開啟系位置（需求規格 7.1、7.3）：第 1 系起點或建系分支指定的新系位置。建立零代市場種牡馬
 * 與現任任期，系統對照表沒有該子系統就新增，親系統不同或與既有系重複時確認後才寫入。
 */
export async function openLine(context: ServiceContext, input: OpenLineInput): Promise<Line> {
  const game = await requireCurrentGame(context);
  const inspection = await inspectOpenLine(context, game, input);
  if (inspection.issues.length > 0) {
    throw new ServiceError('invalidInput', inspection.issues.join('；'));
  }
  requireAcceptedWarnings(inspection.warnings, input.acceptedWarnings ?? []);

  const now = context.now().toISOString();
  const records = buildOpenedLine({
    position: input.position,
    inspection,
    founder: input.founder,
    gameYear: game.currentYear,
    occurredAt: now,
    newId: context.newId,
  });
  await trackWrite(context, () =>
    insertOpenedLine(context.database, {
      gameId: game.id,
      touch: gameTouch(context, now),
      line: records.line,
      founder: records.founder,
      duty: records.duty,
      systemMapEntry: records.systemMapEntry,
      events: [...records.events],
    }),
  );
  return records.line;
}

export interface UpdateLineSystemsInput {
  readonly position: LinePosition;
  readonly subsystem: string;
  readonly parentSystem: string;
  readonly acceptedWarnings?: readonly OpenLineWarningCode[] | undefined;
}

export interface UpdateLineSystemsCheck {
  readonly issues: readonly string[];
  readonly warnings: readonly OpenLineWarning[];
}

interface SystemsInspection extends UpdateLineSystemsCheck {
  readonly subsystem: string;
  readonly parentSystem: string;
  readonly line: Line | undefined;
  readonly mapEntry: SystemMapEntry | undefined;
}

async function inspectUpdateLineSystems(
  context: ServiceContext,
  game: Game,
  input: UpdateLineSystemsInput,
): Promise<SystemsInspection> {
  const subsystem = normalizeSystemInput(input.subsystem);
  const parentSystem = normalizeSystemInput(input.parentSystem);
  const lines = await listLines(context.database, game.id);
  const line = lines.find((item) => item.position === input.position);
  const issues: string[] = [];
  if (line === undefined) {
    issues.push(`第 ${String(input.position)} 系尚未開啟`);
  }
  if (subsystem === '') {
    issues.push('請輸入目前子系統');
  }
  if (parentSystem === '') {
    issues.push('請輸入親系統');
  }
  if (line !== undefined && line.subsystem === subsystem && line.parentSystem === parentSystem) {
    issues.push('系統名稱沒有變更');
  }
  const mapEntry =
    subsystem === '' ? undefined : await findSystemMapEntry(context.database, game.id, subsystem);
  const duplicate = duplicateParentSystemWarning(lines, input.position, parentSystem);
  const warnings: OpenLineWarning[] = [
    ...(mapEntry !== undefined && parentSystem !== '' && mapEntry.parentSystem !== parentSystem
      ? [
          {
            code: 'parentSystemDiffersFromMap' as const,
            message: `系統對照表記載「${subsystem}」的親系統是「${mapEntry.parentSystem}」，確認後會改為「${parentSystem}」`,
          },
        ]
      : []),
    ...(duplicate === undefined ? [] : [duplicate]),
  ];
  return { issues, warnings, subsystem, parentSystem, line, mapEntry };
}

export async function checkUpdateLineSystems(
  context: ServiceContext,
  input: UpdateLineSystemsInput,
): Promise<UpdateLineSystemsCheck> {
  const game = await requireCurrentGame(context);
  const { issues, warnings } = await inspectUpdateLineSystems(context, game, input);
  return { issues, warnings };
}

/**
 * 更新某系目前的子系統與親系統（需求規格 7.1、LINE-06）：位置、配種、代數與任務都不變，
 * 歷程保存舊名與年份。系統對照表沒有該子系統就新增，親系統不同時確認後更新（LINE-04 升格）。
 */
export async function updateLineSystems(
  context: ServiceContext,
  input: UpdateLineSystemsInput,
): Promise<Line> {
  const game = await requireCurrentGame(context);
  const inspection = await inspectUpdateLineSystems(context, game, input);
  if (inspection.issues.length > 0) {
    throw new ServiceError('invalidInput', inspection.issues.join('；'));
  }
  requireAcceptedWarnings(inspection.warnings, input.acceptedWarnings ?? []);

  const { subsystem, parentSystem, mapEntry, warnings } = inspection;
  const gameYear = game.currentYear;
  const now = context.now().toISOString();
  const systemMapEntry: SystemMapEntry | undefined =
    mapEntry?.parentSystem === parentSystem
      ? undefined
      : { id: mapEntry?.id ?? context.newId(), subsystem, parentSystem };
  return trackWrite(context, () =>
    writeLineSystems(context.database, {
      gameId: game.id,
      touch: gameTouch(context, now),
      position: input.position,
      subsystem,
      parentSystem,
      systemMapEntry,
      buildEvents: (line) => {
        if (line.subsystem === subsystem && line.parentSystem === parentSystem) {
          return undefined;
        }
        return [
          userEvent(context, {
            subjectId: line.id,
            type: 'lineSystemsChanged',
            gameYear,
            occurredAt: now,
            before: { subsystem: line.subsystem, parentSystem: line.parentSystem },
            after: {
              subsystem,
              parentSystem,
              ...(warnings.length === 0
                ? {}
                : { confirmations: warnings.map((warning) => warning.code) }),
            },
          }),
          ...(systemMapEntry === undefined
            ? []
            : [
                userEvent(context, {
                  subjectId: systemMapEntry.id,
                  type: 'systemMapChanged',
                  gameYear,
                  occurredAt: now,
                  before:
                    mapEntry === undefined
                      ? undefined
                      : { subsystem: mapEntry.subsystem, parentSystem: mapEntry.parentSystem },
                  after: { subsystem, parentSystem },
                }),
              ]),
        ];
      },
    }),
  );
}

/** 八系親系統狀態（需求規格 13.2、LINE-04）：種類數與重複的系。 */
export async function loadParentSystemStatus(context: ServiceContext): Promise<ParentSystemStatus> {
  const game = await requireCurrentGame(context);
  const lines = await listLines(context.database, game.id);
  return parentSystemStatus(
    lines.map((line) => ({ position: line.position, parentSystem: line.parentSystem })),
  );
}
