import { MIN_GAME_YEAR, type Game } from '../domain/game.ts';
import { formatAbilityNo, parseAbilityNo, toBaseName, type Horse } from '../domain/horse.ts';
import {
  LINE_COLORS,
  LINE_POSITIONS,
  pickLineColor,
  type Line,
  type LineColor,
  type LinePosition,
} from '../domain/line.ts';
import type { StallionDuty } from '../domain/stallion-duty.ts';
import type { SystemMapEntry } from '../domain/system-map.ts';
import { findHorseByIdentity, getHorse } from '../storage/horses.ts';
import { insertOpenedLine, listLines } from '../storage/lines.ts';
import { listStallionDuties } from '../storage/stallion-duties.ts';
import { findSystemMapEntry } from '../storage/system-map.ts';
import { trackWrite, type ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import { userEvent } from './events.ts';
import { gameTouch, requireCurrentGame } from './games.ts';
import { normalizeSystemInput } from './system-map.ts';
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
        (duty) => duty.position === position && duty.generation === 0 && duty.role === 'current',
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

export type OpenLineWarningCode = 'parentSystemDiffersFromMap';

export type OpenLineWarning = ServiceWarning<OpenLineWarningCode>;

export interface OpenFirstLineInput {
  readonly subsystem: string;
  readonly parentSystem: string;
  readonly color: string;
  readonly founder: FounderInput;
  /** 使用者已確認的警告（需求規格 5.2）。 */
  readonly acceptedWarnings?: readonly OpenLineWarningCode[] | undefined;
}

export interface OpenFirstLineCheck {
  readonly issues: readonly string[];
  readonly warnings: readonly OpenLineWarning[];
}

interface Inspection extends OpenFirstLineCheck {
  readonly subsystem: string;
  readonly parentSystem: string;
  /** 資料契約的代表色是小寫 #rrggbb。 */
  readonly color: string;
  readonly fullName: string;
  readonly abilityNo: number | undefined;
  readonly mapEntry: SystemMapEntry | undefined;
}

async function inspectOpenFirstLine(
  context: ServiceContext,
  game: Game,
  input: OpenFirstLineInput,
): Promise<Inspection> {
  const subsystem = normalizeSystemInput(input.subsystem);
  const parentSystem = normalizeSystemInput(input.parentSystem);
  const color = input.color.toLowerCase();
  const fullName = input.founder.fullName.trim();
  const abilityText = input.founder.abilityNo.trim();
  const abilityNo = abilityText === '' ? undefined : parseAbilityNo(abilityText);
  const { birthYear } = input.founder;
  const lines = await listLines(context.database, game.id);
  const issues: string[] = [];
  if (lines.length > 0) {
    issues.push('第 1 系已經開啟');
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
  const warnings: OpenLineWarning[] =
    mapEntry !== undefined && parentSystem !== '' && mapEntry.parentSystem !== parentSystem
      ? [
          {
            code: 'parentSystemDiffersFromMap',
            message: `系統對照表記載「${subsystem}」的親系統是「${mapEntry.parentSystem}」，確認後會改為「${parentSystem}」`,
          },
        ]
      : [];
  return { issues, warnings, subsystem, parentSystem, color, fullName, abilityNo, mapEntry };
}

export async function checkOpenFirstLine(
  context: ServiceContext,
  input: OpenFirstLineInput,
): Promise<OpenFirstLineCheck> {
  const game = await requireCurrentGame(context);
  const { issues, warnings } = await inspectOpenFirstLine(context, game, input);
  return { issues, warnings };
}

/**
 * 開啟第 1 系（需求規格 7.1、7.3 起點）：建立零代市場種牡馬與現任任期，
 * 系統對照表沒有該子系統就新增，親系統不同且使用者確認後更新。
 */
export async function openFirstLine(
  context: ServiceContext,
  input: OpenFirstLineInput,
): Promise<Line> {
  const game = await requireCurrentGame(context);
  const inspection = await inspectOpenFirstLine(context, game, input);
  if (inspection.issues.length > 0) {
    throw new ServiceError('invalidInput', inspection.issues.join('；'));
  }
  requireAcceptedWarnings(inspection.warnings, input.acceptedWarnings ?? []);

  const { subsystem, parentSystem, color, fullName, abilityNo, mapEntry, warnings } = inspection;
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
    position: 1,
    subsystem,
    parentSystem,
    color,
    branch: { targetGeneration: 1, openedYear: gameYear },
    establishedGenerations: [],
  };
  const duty: StallionDuty = {
    id: context.newId(),
    position: 1,
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
        position: 1,
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
      after: { position: 1, generation: 0, role: 'current' },
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
