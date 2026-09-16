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
import type { CurrentDuty, StallionDuty } from '../domain/stallion-duty.ts';
import type { SystemMapEntry } from '../domain/system-map.ts';
import { findHorseByIdentity, getHorse } from '../storage/horses.ts';
import { insertOpenedLine, listLines, writeLineSystems } from '../storage/lines.ts';
import { listStallionDuties } from '../storage/stallion-duties.ts';
import { findSystemMapEntry } from '../storage/system-map.ts';
import { trackWrite, type ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import { userEvent } from './events.ts';
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

interface Inspection extends OpenLineCheck {
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
): Promise<Inspection> {
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
    if (existing !== undefined) {
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

export async function checkOpenLine(
  context: ServiceContext,
  input: OpenLineInput,
): Promise<OpenLineCheck> {
  const game = await requireCurrentGame(context);
  const { issues, warnings } = await inspectOpenLine(context, game, input);
  return { issues, warnings };
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

  const { subsystem, parentSystem, color, fullName, abilityNo, mapEntry, warnings } = inspection;
  const { position } = input;
  const { birthYear } = input.founder;
  const sireName = input.founder.sireName.trim();
  const damName = input.founder.damName.trim();
  const gameYear = game.currentYear;
  const now = context.now().toISOString();

  const founder: Horse = {
    id: context.newId(),
    sex: 'male',
    ...(abilityNo === undefined ? {} : { abilityNo }),
    ...(birthYear === undefined ? {} : { birthYear }),
    fullName,
    baseName: toBaseName(fullName),
    ...(sireName === '' ? {} : { sireName }),
    ...(damName === '' ? {} : { damName }),
    sireSubsystem: subsystem,
    stageNumbers: [],
    aliases: [],
  };
  const line: Line = {
    id: context.newId(),
    position,
    subsystem,
    parentSystem,
    color,
    branch: { targetGeneration: inspection.targetGeneration, openedYear: gameYear },
    establishedGenerations: [],
  };
  const duty: StallionDuty = {
    id: context.newId(),
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
      : { id: mapEntry?.id ?? context.newId(), subsystem, parentSystem };
  const events = [
    userEvent(context, {
      subjectId: founder.id,
      type: 'horseCreated',
      gameYear,
      occurredAt: now,
      after: { fullName, sex: 'male' },
    }),
    userEvent(context, {
      subjectId: line.id,
      type: 'lineOpened',
      gameYear,
      occurredAt: now,
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
    userEvent(context, {
      subjectId: founder.id,
      type: 'stallionDutyStarted',
      gameYear,
      occurredAt: now,
      after: { position, generation: 0, role: 'current' },
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
  await trackWrite(context, () =>
    insertOpenedLine(context.database, {
      gameId: game.id,
      touch: gameTouch(context, now),
      line,
      founder,
      duty,
      systemMapEntry,
      events,
    }),
  );
  return line;
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
