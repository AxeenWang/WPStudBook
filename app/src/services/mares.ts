import { DEFAULT_GAME_SETTINGS, MIN_GAME_YEAR, type Game } from '../domain/game.ts';
import { formatAbilityNo, parseAbilityNo, toBaseName, type Horse } from '../domain/horse.ts';
import { LINE_POSITIONS, isLinePosition, type LinePosition } from '../domain/line.ts';
import {
  MARE_GROUP_TARGET,
  MARE_ORIGINS,
  MARE_SITES,
  YEAR_PLANS,
  checkMarketGroup,
  checkSubstituteSire,
  defaultMarketOrigin,
  isMareSite,
  marketGroupFor,
  type AssignedMareGroup,
  type Mare,
  type MareOrigin,
  type MareSite,
  type MarketGroupIssue,
  type UndeterminedReason,
  type YearPlan,
} from '../domain/mare.ts';
import { listConceptionsInYear } from '../storage/breedings.ts';
import { readGameSettings } from '../storage/games.ts';
import { findHorseByIdentity, getHorsesByIds } from '../storage/horses.ts';
import { listLines } from '../storage/lines.ts';
import { listMareYearly } from '../storage/mare-yearly.ts';
import { insertMare, listMares } from '../storage/mares.ts';
import { listSystemMapEntries } from '../storage/system-map.ts';
import { trackWrite, type ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import { userEvent } from './events.ts';
import { gameTouch, requireCurrentGame } from './games.ts';
import { buildMareCard, type MareCard } from './mare-list.ts';
import { normalizeSystemInput } from './system-map.ts';
import { requireAcceptedWarnings, type ServiceWarning } from './warnings.ts';

/** 介面用的選項與常數（ui 不能引用 domain 的值）。 */
export const MARE_POSITION_OPTIONS: readonly LinePosition[] = LINE_POSITIONS;
export const MARE_SITE_OPTIONS: readonly MareSite[] = MARE_SITES;
export const MARE_ORIGIN_OPTIONS: readonly MareOrigin[] = MARE_ORIGINS;
export const YEAR_PLAN_OPTIONS: readonly YearPlan[] = YEAR_PLANS;
export const MARE_TARGET_COUNT = MARE_GROUP_TARGET;

/** 新增表單的預設來源；系與代數不合法時回傳 undefined。 */
export function defaultOriginFor(
  position: number,
  generation: number,
  openedPositions: readonly LinePosition[],
): MareOrigin | undefined {
  if (checkMarketGroup(position, generation) !== undefined || !isLinePosition(position)) {
    return undefined;
  }
  return defaultMarketOrigin(marketGroupFor(position, generation), openedPositions);
}

export interface MarketMareInput {
  readonly position: number;
  readonly generation: number;
  readonly fullName: string;
  /** 能力番号文字；空白表示未填。 */
  readonly abilityNo: string;
  readonly birthYear?: number | undefined;
  readonly sireName: string;
  readonly damName: string;
  readonly sireSubsystem: string;
  /** 牝系名稱；空白且未勾選 noNamedFemaleLine 時為未取得。 */
  readonly femaleLine: string;
  /** 勾選「不屬於具名牝系」時保存空字串（需求規格 8.8）。 */
  readonly noNamedFemaleLine: boolean;
  /** 未選擇時傳入 NaN。 */
  readonly site: number;
  readonly origin: MareOrigin;
  readonly originNote: string;
  /** 使用者已確認的警告（需求規格 5.2）。 */
  readonly acceptedWarnings?: readonly AddMareWarningCode[] | undefined;
}

export type AddMareWarningCode = 'sireParentSystemDiffers';

export type AddMareWarning = ServiceWarning<AddMareWarningCode>;

export interface AddMareCheck {
  readonly issues: readonly string[];
  readonly warnings: readonly AddMareWarning[];
  /** 只提示、不要求確認（需求規格 8.3：無法判斷替代母馬的父系時）。 */
  readonly notices: readonly string[];
}

export interface AddedMare {
  readonly horse: Horse;
  readonly mare: Mare;
  readonly notices: readonly string[];
}

const GROUP_MESSAGES: Readonly<Record<MarketGroupIssue, string>> = {
  positionInvalid: '請選擇第 1～8 系',
  generationInvalid: '代數必須是 0～9999 的整數',
  starterOnlyFirstLine: '代數 0（起點母馬群）只能用於第 1 系',
};

const UNDETERMINED_MESSAGES: Readonly<
  Record<UndeterminedReason, (target: string, sireSubsystem: string) => string>
> = {
  sireSubsystemMissing: (target) => `自身父系未填，無法判斷是否屬於${target}`,
  lineNotOpened: (target) => `${target}尚未成立，無法判斷自身父系是否屬於${target}`,
  notInSystemMap: (target, sireSubsystem) =>
    `系統對照表沒有「${sireSubsystem}」，無法判斷自身父系是否屬於${target}`,
};

interface AddMareInspection extends AddMareCheck {
  readonly group: AssignedMareGroup | undefined;
  readonly site: MareSite | undefined;
  readonly fullName: string;
  readonly abilityNo: number | undefined;
  readonly sireSubsystem: string;
  readonly femaleLine: string;
}

async function inspectAddMarketMare(
  context: ServiceContext,
  game: Game,
  input: MarketMareInput,
): Promise<AddMareInspection> {
  const fullName = input.fullName.trim();
  const abilityText = input.abilityNo.trim();
  const abilityNo = abilityText === '' ? undefined : parseAbilityNo(abilityText);
  const { birthYear } = input;
  const sireSubsystem = normalizeSystemInput(input.sireSubsystem);
  const femaleLine = input.femaleLine.trim();
  const site = isMareSite(input.site) ? input.site : undefined;
  const issues: string[] = [];

  const groupIssue = checkMarketGroup(input.position, input.generation);
  const group =
    groupIssue === undefined && isLinePosition(input.position)
      ? marketGroupFor(input.position, input.generation)
      : undefined;
  if (groupIssue !== undefined) {
    issues.push(GROUP_MESSAGES[groupIssue]);
  }
  if (fullName === '') {
    issues.push('請輸入馬名');
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
  if (site === undefined) {
    issues.push('請選擇據點');
  }
  if (input.noNamedFemaleLine && femaleLine !== '') {
    issues.push('牝系名稱與「不屬於具名牝系」只能擇一');
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

  const warnings: AddMareWarning[] = [];
  const notices: string[] = [];
  if (group?.kind === 'substitute') {
    const [systemMap, lines] = await Promise.all([
      listSystemMapEntries(context.database, game.id),
      listLines(context.database, game.id),
    ]);
    const check = checkSubstituteSire(
      group,
      sireSubsystem === '' ? undefined : sireSubsystem,
      systemMap,
      lines,
    );
    const target = `第 ${String(group.position)} 系`;
    if (check.result === 'differentParentSystem') {
      warnings.push({
        code: 'sireParentSystemDiffers',
        message: `自身父系「${sireSubsystem}」的親系統是「${check.sireParentSystem}」，與${target}目前的親系統「${check.lineParentSystem}」不同；確認後仍登記為替代${target} ${String(group.generation)} 代`,
      });
    } else if (check.result === 'undetermined') {
      notices.push(UNDETERMINED_MESSAGES[check.reason](target, sireSubsystem));
    }
  }
  return { issues, warnings, notices, group, site, fullName, abilityNo, sireSubsystem, femaleLine };
}

export async function checkAddMarketMare(
  context: ServiceContext,
  input: MarketMareInput,
): Promise<AddMareCheck> {
  const game = await requireCurrentGame(context);
  const { issues, warnings, notices } = await inspectAddMarketMare(context, game, input);
  return { issues, warnings, notices };
}

/**
 * 手動新增市場母馬（需求規格 8.4）：記錄起點用或替代的系與代數，自身父系只是馬匹資料，
 * 不宣告她屬於該系（8.3）。能力番号、出生年、父母、自身父系與牝系可留空。
 */
export async function addMarketMare(
  context: ServiceContext,
  input: MarketMareInput,
): Promise<AddedMare> {
  const game = await requireCurrentGame(context);
  const inspection = await inspectAddMarketMare(context, game, input);
  const { group, site } = inspection;
  if (inspection.issues.length > 0 || group === undefined || site === undefined) {
    throw new ServiceError('invalidInput', inspection.issues.join('；'));
  }
  requireAcceptedWarnings(inspection.warnings, input.acceptedWarnings ?? []);

  const { fullName, abilityNo, sireSubsystem, femaleLine, warnings, notices } = inspection;
  const { birthYear } = input;
  const sireName = input.sireName.trim();
  const damName = input.damName.trim();
  const originNote = input.originNote.trim();
  const now = context.now().toISOString();

  const horse: Horse = {
    id: context.newId(),
    sex: 'female',
    ...(abilityNo === undefined ? {} : { abilityNo }),
    ...(birthYear === undefined ? {} : { birthYear }),
    fullName,
    baseName: toBaseName(fullName),
    ...(sireName === '' ? {} : { sireName }),
    ...(damName === '' ? {} : { damName }),
    ...(sireSubsystem === '' ? {} : { sireSubsystem }),
    ...(input.noNamedFemaleLine ? { femaleLine: '' } : femaleLine === '' ? {} : { femaleLine }),
    stageNumbers: [],
    aliases: [],
  };
  const mare: Mare = {
    id: horse.id,
    group,
    origin: input.origin,
    ...(originNote === '' ? {} : { originNote }),
    status: 'producing',
    site,
  };
  await trackWrite(context, () =>
    insertMare(context.database, {
      gameId: game.id,
      touch: gameTouch(context, now),
      build: (stored) => {
        if (birthYear !== undefined && birthYear > stored.currentYear) {
          throw new ServiceError(
            'invalidInput',
            `出生年必須是 ${String(MIN_GAME_YEAR)}～${String(stored.currentYear)} 的整數`,
          );
        }
        const groupValue = {
          kind: group.kind,
          position: group.position,
          generation: group.generation,
        };
        return {
          horse,
          mare,
          events: [
            userEvent(context, {
              subjectId: horse.id,
              type: 'horseCreated',
              gameYear: stored.currentYear,
              occurredAt: now,
              after: { fullName, sex: 'female' },
            }),
            userEvent(context, {
              subjectId: horse.id,
              type: 'mareAdded',
              gameYear: stored.currentYear,
              occurredAt: now,
              after: {
                group: groupValue,
                origin: input.origin,
                site,
                ...(warnings.length === 0
                  ? {}
                  : { confirmations: warnings.map((warning) => warning.code) }),
              },
            }),
          ],
        };
      },
    }),
  );
  return { horse, mare, notices };
}

export interface MareHerd {
  readonly currentYear: number;
  readonly highAgeReminderAge: number;
  readonly vitalityThreshold: number | undefined;
  readonly openedPositions: readonly LinePosition[];
  readonly cards: readonly MareCard[];
}

/** 母馬群清單資料：目前遊戲局全部母馬的卡片；篩選、排序與分頁由 mare-list.ts 在記憶體中處理。 */
export async function loadMareHerd(context: ServiceContext): Promise<MareHerd> {
  const game = await requireCurrentGame(context);
  const [mares, yearly, lines, storedSettings, conceptions] = await Promise.all([
    listMares(context.database, game.id),
    listMareYearly(context.database, game.id),
    listLines(context.database, game.id),
    readGameSettings(context.database, game.id),
    listConceptionsInYear(context.database, game.id, game.currentYear),
  ]);
  const horses = await getHorsesByIds(
    context.database,
    game.id,
    mares.map((mare) => mare.id),
  );
  const settings = storedSettings ?? DEFAULT_GAME_SETTINGS;
  const yearlyByHorse = Map.groupBy(yearly, (record) => record.horseId);
  return {
    currentYear: game.currentYear,
    highAgeReminderAge: settings.highAgeReminderAge,
    vitalityThreshold: settings.vitalityThreshold,
    openedPositions: lines.map((line) => line.position),
    cards: mares.map((mare) =>
      buildMareCard({
        mare,
        horse: horses.get(mare.id),
        yearly: yearlyByHorse.get(mare.id) ?? [],
        conception: conceptions.get(mare.id),
        currentYear: game.currentYear,
        settings,
      }),
    ),
  };
}
