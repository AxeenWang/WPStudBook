import { DEFAULT_GAME_SETTINGS, MIN_GAME_YEAR, type Game } from '../domain/game.ts';
import type { HistoryEvent, HistoryEventType } from '../domain/history-event.ts';
import {
  formatAbilityNo,
  parseAbilityNo,
  toBaseName,
  type Horse,
  type StageNumber,
} from '../domain/horse.ts';
import type { JsonObject, JsonValue } from '../domain/json.ts';
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
  isSameGroup,
  marketGroupFor,
  type AssignedMareGroup,
  type Mare,
  type MareGroup,
  type MareOrigin,
  type MareSite,
  type MarketGroupIssue,
  type UndeterminedReason,
  type YearPlan,
} from '../domain/mare.ts';
import {
  isBreedingTally,
  isCeExtendedKodashi,
  isKodashi,
  isVitalityValue,
  type MareYearly,
  type Vitality,
} from '../domain/mare-yearly.ts';
import type { Timing } from '../domain/timing.ts';
import { getConception, listConceptionsInYear } from '../storage/breedings.ts';
import { listEventsForSubject } from '../storage/events.ts';
import { readGameSettings } from '../storage/games.ts';
import { findHorseByIdentity, getHorse, getHorsesByIds } from '../storage/horses.ts';
import { listLines } from '../storage/lines.ts';
import {
  getMareYearly,
  listMareYearly,
  listMareYearlyForHorse,
  writeMareYearly,
} from '../storage/mare-yearly.ts';
import { getMare, insertMare, listMares, modifyMare } from '../storage/mares.ts';
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

/** 仔出 11～15 是 CE 擴充值（需求規格 8.8）；介面只標示，不影響保存。 */
export function isCeExtended(kodashi: number): boolean {
  return isCeExtendedKodashi(kodashi);
}

/** 馬番号與能力番号的顯示格式（設計決策 5.3 節）。 */
export function horseNumberText(value: number): string {
  return formatAbilityNo(value);
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

async function requireMare(context: ServiceContext, gameId: string, mareId: string): Promise<Mare> {
  const mare = await getMare(context.database, gameId, mareId);
  if (mare === undefined) {
    throw new ServiceError('invalidInput', '找不到這匹繁殖牝馬');
  }
  return mare;
}

/** 賣出、轉場與今年計畫只適用於繁殖牝馬圈內的母馬。 */
function requireProducing(mare: Mare): void {
  if (mare.status !== 'producing') {
    throw new ServiceError('invalidInput', '這匹繁殖牝馬已離圈');
  }
}

export interface SellPreview {
  readonly name: string;
  readonly group: MareGroup;
  /** 賣出前所在母馬群（同系同代的自家與替代母馬）的生產中數；待指定用途為 undefined。 */
  readonly producingInGroup: number | undefined;
}

/** 賣出前顯示影響（需求規格 8.5）。 */
export async function previewSellMare(
  context: ServiceContext,
  mareId: string,
): Promise<SellPreview> {
  const game = await requireCurrentGame(context);
  const mare = await requireMare(context, game.id, mareId);
  requireProducing(mare);
  const [horse, mares] = await Promise.all([
    getHorse(context.database, game.id, mareId),
    listMares(context.database, game.id),
  ]);
  const { group } = mare;
  return {
    name: horse?.fullName ?? horse?.officialName ?? mareId,
    group,
    producingInGroup:
      group.kind === 'unassigned'
        ? undefined
        : mares.filter(
            (item) =>
              item.status === 'producing' &&
              isSameGroup(item.group, group.position, group.generation),
          ).length,
  };
}

/**
 * 賣出（需求規格 8.5）：只改狀態為已離圈並保存事件，來源、紀錄與血緣都保留；
 * 自家母馬有姊妹接替狀態時一併改為已售出（8.9）。玩家不能讓母馬引退，沒有退役操作。
 */
export async function sellMare(context: ServiceContext, mareId: string): Promise<Mare> {
  const game = await requireCurrentGame(context);
  requireProducing(await requireMare(context, game.id, mareId));
  const now = context.now().toISOString();
  return trackWrite(context, () =>
    modifyMare(context.database, {
      gameId: game.id,
      mareId,
      touch: gameTouch(context, now),
      apply: ({ game: stored, mare }) => {
        requireProducing(mare);
        const { succession } = mare;
        const sold: Mare = {
          ...mare,
          status: 'left',
          leftReason: 'sold',
          ...(succession === undefined ? {} : { succession: 'sold' as const }),
        };
        const event = userEvent(context, {
          subjectId: mareId,
          type: 'mareSold',
          gameYear: stored.currentYear,
          occurredAt: now,
          before: { status: 'producing', ...(succession === undefined ? {} : { succession }) },
          after: {
            status: 'left',
            leftReason: 'sold',
            ...(succession === undefined ? {} : { succession: 'sold' }),
          },
        });
        return { mare: sold, events: [event] };
      },
    }),
  );
}

export interface TransferInput {
  readonly mareId: string;
  /** 未選擇時傳入 NaN。 */
  readonly site: number;
  readonly month: number | undefined;
  readonly week: number | undefined;
}

function isIntegerBetween(value: number | undefined, min: number, max: number): value is number {
  return value !== undefined && Number.isInteger(value) && value >= min && value <= max;
}

/** 轉場（需求規格 8.6）：保存原據點、新據點、年、時點與來源；時點由使用者填寫月與週。 */
export async function transferMare(context: ServiceContext, input: TransferInput): Promise<Mare> {
  const game = await requireCurrentGame(context);
  const { mareId, month, week } = input;
  const site = isMareSite(input.site) ? input.site : undefined;
  const issues: string[] = [];
  if (site === undefined) {
    issues.push('請選擇新據點');
  }
  if (!isIntegerBetween(month, 1, 12)) {
    issues.push('月份必須是 1～12 的整數');
  }
  if (!isIntegerBetween(week, 1, 5)) {
    issues.push('週必須是 1～5 的整數');
  }
  if (issues.length > 0 || site === undefined || month === undefined || week === undefined) {
    throw new ServiceError('invalidInput', issues.join('；'));
  }
  const mare = await requireMare(context, game.id, mareId);
  requireProducing(mare);
  if (mare.site === site) {
    throw new ServiceError('invalidInput', '新據點與目前據點相同');
  }
  const timing: Timing = { month, week };
  const now = context.now().toISOString();
  return trackWrite(context, () =>
    modifyMare(context.database, {
      gameId: game.id,
      mareId,
      touch: gameTouch(context, now),
      apply: ({ game: stored, mare: current }) => {
        requireProducing(current);
        if (current.site === site) {
          throw new ServiceError('invalidInput', '新據點與目前據點相同');
        }
        const event = userEvent(context, {
          subjectId: mareId,
          type: 'mareTransferred',
          gameYear: stored.currentYear,
          timing,
          occurredAt: now,
          before: { site: current.site },
          after: { site },
        });
        return { mare: { ...current, site }, events: [event] };
      },
    }),
  );
}

export interface YearPlanInput {
  readonly mareId: string;
  readonly plan: YearPlan;
}

/** 今年計畫（需求規格 8.7）：連同目前遊戲年保存，不寫事件。 */
export async function setYearPlan(context: ServiceContext, input: YearPlanInput): Promise<Mare> {
  const game = await requireCurrentGame(context);
  requireProducing(await requireMare(context, game.id, input.mareId));
  const now = context.now().toISOString();
  return trackWrite(context, () =>
    modifyMare(context.database, {
      gameId: game.id,
      mareId: input.mareId,
      touch: gameTouch(context, now),
      apply: ({ game: stored, mare }) => {
        requireProducing(mare);
        return {
          mare: { ...mare, yearPlan: { plan: input.plan, gameYear: stored.currentYear } },
          events: [],
        };
      },
    }),
  );
}

export interface VitalityInput {
  /** 空白表示沒有這份快照（顯示待更新），不是 0。 */
  readonly value: number | undefined;
  readonly boosted: boolean;
}

export interface MareYearlyInput {
  readonly mareId: string;
  readonly vitalityMay: VitalityInput;
  readonly vitalityJuly: VitalityInput;
  readonly kodashi: number | undefined;
  readonly breedingYears: number | undefined;
  readonly breedingCount: number | undefined;
}

const YEARLY_FIELDS = [
  'vitalityMay',
  'vitalityJuly',
  'kodashi',
  'breedingYears',
  'breedingCount',
] as const;

function yearlyValue(record: MareYearly | undefined): JsonObject {
  const value: Record<string, JsonValue> = {};
  for (const field of YEARLY_FIELDS) {
    const item = record?.[field];
    if (item !== undefined) {
      value[field] = item;
    }
  }
  return value;
}

function vitalityFrom(input: VitalityInput, label: string, issues: string[]): Vitality | undefined {
  if (input.value === undefined) {
    if (input.boosted) {
      issues.push(`${label}沒有數值時不能勾選増強中`);
    }
    return undefined;
  }
  if (!isVitalityValue(input.value)) {
    issues.push(`${label}必須是 0～100 的整數`);
    return undefined;
  }
  return { state: 'confirmed', value: input.value, boosted: input.boosted };
}

/**
 * 以表單內容取代目前遊戲年的年度資料（需求規格 8.7、8.8）：空白欄位不保存，
 * 活力 0 與仔出 0 是有效值。人工更正保存前後值（mareYearlyChanged）。
 */
export async function saveMareYearly(
  context: ServiceContext,
  input: MareYearlyInput,
): Promise<MareYearly> {
  const game = await requireCurrentGame(context);
  const issues: string[] = [];
  const vitalityMay = vitalityFrom(input.vitalityMay, '5 月活力', issues);
  const vitalityJuly = vitalityFrom(input.vitalityJuly, '7 月活力', issues);
  const { kodashi, breedingYears, breedingCount } = input;
  if (kodashi !== undefined && !isKodashi(kodashi)) {
    issues.push('仔出必須是 0～15 的整數');
  }
  if (breedingYears !== undefined && !isBreedingTally(breedingYears)) {
    issues.push('繁殖年數必須是 0～99 的整數');
  }
  if (breedingCount !== undefined && !isBreedingTally(breedingCount)) {
    issues.push('繁殖頭數必須是 0～99 的整數');
  }
  if (issues.length > 0) {
    throw new ServiceError('invalidInput', issues.join('；'));
  }
  const { mareId } = input;
  await requireMare(context, game.id, mareId);
  const fields = {
    ...(vitalityMay === undefined ? {} : { vitalityMay }),
    ...(vitalityJuly === undefined ? {} : { vitalityJuly }),
    ...(kodashi === undefined ? {} : { kodashi }),
    ...(breedingYears === undefined ? {} : { breedingYears }),
    ...(breedingCount === undefined ? {} : { breedingCount }),
  };
  const submitted = JSON.stringify(
    yearlyValue({ id: '', horseId: mareId, gameYear: 0, ...fields }),
  );
  const unchanged = (record: MareYearly | undefined) =>
    JSON.stringify(yearlyValue(record)) === submitted;
  if (unchanged(await getMareYearly(context.database, game.id, mareId, game.currentYear))) {
    throw new ServiceError('invalidInput', '年度資料沒有變更');
  }
  const now = context.now().toISOString();
  return trackWrite(context, () =>
    writeMareYearly(context.database, {
      gameId: game.id,
      horseId: mareId,
      touch: gameTouch(context, now),
      apply: ({ game: stored, record }) => {
        if (unchanged(record)) {
          throw new ServiceError('invalidInput', '年度資料沒有變更');
        }
        const next: MareYearly = {
          id: record?.id ?? context.newId(),
          horseId: mareId,
          gameYear: stored.currentYear,
          ...fields,
        };
        const event = userEvent(context, {
          subjectId: mareId,
          type: 'mareYearlyChanged',
          gameYear: stored.currentYear,
          occurredAt: now,
          before: record === undefined ? undefined : yearlyValue(record),
          after: yearlyValue(next),
        });
        return { record: next, events: [event] };
      },
    }),
  );
}

export interface MareHistoryItem {
  readonly id: string;
  readonly type: HistoryEventType;
  readonly gameYear: number;
  readonly timing: Timing | undefined;
  readonly occurredAt: string;
  /** 只有轉場事件才有。 */
  readonly fromSite: MareSite | undefined;
  readonly toSite: MareSite | undefined;
}

export interface MareDetail {
  readonly card: MareCard;
  /** 已格式化為 0x 開頭的 4 位十六進位。 */
  readonly abilityNo: string | undefined;
  readonly birthYear: number | undefined;
  readonly sireName: string | undefined;
  readonly damName: string | undefined;
  readonly originNote: string | undefined;
  readonly stageNumbers: readonly StageNumber[];
  /** 新到舊。 */
  readonly yearly: readonly MareYearly[];
  readonly currentYearly: MareYearly | undefined;
  /** 新到舊。 */
  readonly history: readonly MareHistoryItem[];
}

function siteIn(value: JsonValue | undefined): MareSite | undefined {
  if (typeof value !== 'object') {
    return undefined;
  }
  const site: unknown = Reflect.get(value, 'site');
  return typeof site === 'number' && isMareSite(site) ? site : undefined;
}

/**
 * 同一操作寫入的事件共用同一個時間；正式環境的 id 是隨機 UUID，不能用來排先後。
 * 依操作內的寫入順序給名次，名次較後者視為較新。
 */
const SAME_TIME_ORDER: Readonly<Partial<Record<HistoryEventType, number>>> = {
  horseCreated: 0,
  mareAdded: 1,
};

function compareHistoryNewestFirst(a: HistoryEvent, b: HistoryEvent): number {
  return (
    b.occurredAt.localeCompare(a.occurredAt) ||
    (SAME_TIME_ORDER[b.type] ?? 0) - (SAME_TIME_ORDER[a.type] ?? 0) ||
    b.id.localeCompare(a.id)
  );
}

function toHistoryItem(event: HistoryEvent): MareHistoryItem {
  const transfer = event.type === 'mareTransferred';
  return {
    id: event.id,
    type: event.type,
    gameYear: event.gameYear,
    timing: event.timing,
    occurredAt: event.occurredAt,
    fromSite: transfer ? siteIn(event.before) : undefined,
    toSite: transfer ? siteIn(event.after) : undefined,
  };
}

/** 詳情欄資料（需求規格 13.4）：概要、年度資料與歷程。 */
export async function loadMareDetail(context: ServiceContext, mareId: string): Promise<MareDetail> {
  const game = await requireCurrentGame(context);
  const mare = await requireMare(context, game.id, mareId);
  const [horse, horseYearly, events, storedSettings, conception] = await Promise.all([
    getHorse(context.database, game.id, mareId),
    listMareYearlyForHorse(context.database, game.id, mareId),
    listEventsForSubject(context.database, game.id, mareId),
    readGameSettings(context.database, game.id),
    getConception(context.database, game.id, mareId, game.currentYear),
  ]);
  const yearly = horseYearly.sort((a, b) => b.gameYear - a.gameYear);
  return {
    card: buildMareCard({
      mare,
      horse,
      yearly,
      conception,
      currentYear: game.currentYear,
      settings: storedSettings ?? DEFAULT_GAME_SETTINGS,
    }),
    abilityNo: horse?.abilityNo === undefined ? undefined : formatAbilityNo(horse.abilityNo),
    birthYear: horse?.birthYear,
    sireName: horse?.sireName,
    damName: horse?.damName,
    originNote: mare.originNote,
    stageNumbers: horse?.stageNumbers ?? [],
    yearly,
    currentYearly: yearly.find((record) => record.gameYear === game.currentYear),
    history: events.sort(compareHistoryNewestFirst).map(toHistoryItem),
  };
}
