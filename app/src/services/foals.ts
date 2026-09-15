import {
  BIRTH_TIMING,
  buildFoalTimeline,
  type Breeding,
  type FoalTimelineEntry,
} from '../domain/breeding.ts';
import {
  APTITUDES,
  DISPOSITIONS,
  SUB_PARAM_GRADES,
  SUB_PARAM_KEYS,
  defaultDisposition,
  isAbilityValue,
  isDispositionAllowed,
  stallionLineage,
  subParamTotal,
  surfaceSummary,
  trackingName,
  type Aptitude,
  type Disposition,
  type Foal,
  type SubParamGrade,
  type SubParamKey,
  type SubParams,
  type SurfaceSummary,
} from '../domain/foal.ts';
import { MIN_GAME_YEAR, type Game } from '../domain/game.ts';
import type { HistoryEvent } from '../domain/history-event.ts';
import {
  horseDisplayName,
  nameForTracking,
  type Horse,
  type HorseAlias,
  type Sex,
} from '../domain/horse.ts';
import type { JsonObject, JsonValue } from '../domain/json.ts';
import { offspringLineage, type Lineage } from '../domain/lineage.ts';
import { ageInYear, mareGeneration } from '../domain/mare.ts';
import { isKodashi } from '../domain/mare-yearly.ts';
import { listBreedingsForMare } from '../storage/breedings.ts';
import { listEventsForSubject } from '../storage/events.ts';
import {
  insertFoal,
  listFoals,
  listFoalsForDam,
  loadFoalBirthState,
  modifyFoal,
  type FoalBirthState,
} from '../storage/foals.ts';
import { getHorse, getHorsesByIds } from '../storage/horses.ts';
import { getMare, listMares } from '../storage/mares.ts';
import { trackWrite, type ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import { userEvent } from './events.ts';
import { gameTouch, requireCurrentGame } from './games.ts';
import { requireAcceptedWarnings, type ServiceWarning } from './warnings.ts';

/** 介面用的選項（ui 不能引用 domain 的值）。 */
export const SUB_PARAM_KEY_OPTIONS: readonly SubParamKey[] = SUB_PARAM_KEYS;
export const SUB_PARAM_GRADE_OPTIONS: readonly SubParamGrade[] = SUB_PARAM_GRADES;
export const APTITUDE_OPTIONS: readonly Aptitude[] = APTITUDES;
export const DISPOSITION_OPTIONS: readonly Disposition[] = DISPOSITIONS;

/** 能力、適性與備註；新增與更正共用。空白欄位不保存。 */
export interface FoalDetailsInput {
  readonly sp: number | undefined;
  readonly st: number | undefined;
  readonly subParams: SubParams;
  readonly turf: Aptitude | undefined;
  readonly dirt: Aptitude | undefined;
  readonly distanceText: string;
  readonly kodashi: number | undefined;
  readonly note: string;
}

type FoalDetails = Pick<
  Foal,
  'sp' | 'st' | 'subParams' | 'turf' | 'dirt' | 'distanceText' | 'kodashi' | 'note'
>;

function detailsFrom(input: FoalDetailsInput, issues: string[]): FoalDetails {
  const { sp, st, kodashi, turf, dirt } = input;
  if (sp !== undefined && !isAbilityValue(sp)) {
    issues.push('SP 必須是 0～999 的整數');
  }
  if (st !== undefined && !isAbilityValue(st)) {
    issues.push('ST 必須是 0～999 的整數');
  }
  if (kodashi !== undefined && !isKodashi(kodashi)) {
    issues.push('仔出必須是 0～15 的整數');
  }
  const subParams = Object.fromEntries(
    SUB_PARAM_KEYS.flatMap((key) => {
      const grade = input.subParams[key];
      return grade === undefined ? [] : [[key, grade] as const];
    }),
  );
  const distanceText = input.distanceText.trim();
  const note = input.note.trim();
  return {
    ...(sp === undefined ? {} : { sp }),
    ...(st === undefined ? {} : { st }),
    ...(Object.keys(subParams).length === 0 ? {} : { subParams }),
    ...(turf === undefined ? {} : { turf }),
    ...(dirt === undefined ? {} : { dirt }),
    ...(distanceText === '' ? {} : { distanceText }),
    ...(kodashi === undefined ? {} : { kodashi }),
    ...(note === '' ? {} : { note }),
  };
}

export interface FoalInput extends FoalDetailsInput {
  readonly damId: string;
  readonly birthYear: number | undefined;
  readonly sex: Sex | undefined;
  /** 沒有相符受胎紀錄時的外部父馬名；有受胎紀錄時使用紀錄上的種牡馬。 */
  readonly sireName: string;
  /** 未選擇時依是否自由配種決定：自由配種待售，其他保留。 */
  readonly disposition: Disposition | undefined;
  readonly acceptedWarnings?: readonly FoalWarningCode[] | undefined;
}

export type FoalWarningCode = 'noConceptionRecord';

export type FoalWarning = ServiceWarning<FoalWarningCode>;

export interface FoalPreview {
  /** 前一年受胎紀錄的配種年；沒有相符紀錄時為 undefined。 */
  readonly breedingYear: number | undefined;
  readonly freeBred: boolean;
  readonly lineage: Lineage | undefined;
  readonly sireLabel: string | undefined;
  readonly trackingName: string | undefined;
}

export interface FoalCheck {
  readonly issues: readonly string[];
  readonly warnings: readonly FoalWarning[];
  /** 有問題時為 undefined。 */
  readonly preview: FoalPreview | undefined;
}

interface FoalPlan extends FoalCheck {
  readonly sireId: string | undefined;
  readonly sireName: string | undefined;
  readonly disposition: Disposition;
  readonly details: FoalDetails;
}

function nameOf(horse: Horse | undefined): string | undefined {
  return horse === undefined ? undefined : horseDisplayName(horse, undefined);
}

function birthYearIssue(birthYear: number | undefined, currentYear: number): string | undefined {
  return birthYear !== undefined &&
    Number.isInteger(birthYear) &&
    birthYear >= MIN_GAME_YEAR &&
    birthYear <= currentYear
    ? undefined
    : `出生年必須是 ${String(MIN_GAME_YEAR)}～${String(currentYear)} 的整數`;
}

function conceptionWarning(breedingYear: number, breeding: Breeding | undefined): FoalWarning {
  const reason =
    breeding === undefined
      ? `${String(breedingYear)} 年沒有繁殖紀錄`
      : breeding.conception === undefined
        ? `${String(breedingYear)} 年的繁殖紀錄尚未登記受胎狀態`
        : `${String(breedingYear)} 年的受胎狀態是「${breeding.conception}」`;
  return {
    code: 'noConceptionRecord',
    message: `${reason}，確認後比照自由配種產駒登記：沒有八系的系與代數，只能待售或已售出，不能成為八系後繼`,
  };
}

/**
 * 登記產駒的核對（需求規格 9.3、11.4）：同一母馬同一出生年只能有一匹；前一年受胎紀錄相符時依紀錄決定父馬、
 * 是否自由配種與系與代數（8.2），沒有相符紀錄時警告並比照自由配種產駒。以交易內外相同的資料計算，
 * 讓寫入時的結果與確認時一致。
 */
function planFoal(game: Game, state: FoalBirthState, input: FoalInput): FoalPlan {
  const issues: string[] = [];
  const yearIssue = birthYearIssue(input.birthYear, game.currentYear);
  if (yearIssue !== undefined) {
    issues.push(yearIssue);
  }
  if (input.sex === undefined) {
    issues.push('請選擇性別');
  }
  const details = detailsFrom(input, issues);
  const { dam, damHorse, existingFoal, breeding, sire } = state;
  if (dam === undefined || damHorse === undefined) {
    issues.push('找不到這匹繁殖牝馬');
  }
  const birthYear = input.birthYear ?? 0;
  if (existingFoal !== undefined) {
    const existingName =
      nameOf(state.existingFoalHorse) ??
      trackingName(damHorse === undefined ? undefined : nameForTracking(damHorse), birthYear) ??
      existingFoal.id;
    issues.push(
      `${String(birthYear)} 年出生的產駒已有「${existingName}」，同一母馬同一出生年只能有一匹`,
    );
  }
  const conceived = breeding?.conception === '受胎';
  if (conceived && breeding.foalId !== undefined && existingFoal === undefined) {
    issues.push(`${String(birthYear - 1)} 年的繁殖紀錄已連結其他產駒`);
  }
  const warnings: FoalWarning[] = [];
  let freeBred = true;
  let lineage: Lineage | undefined;
  let sireId: string | undefined;
  let sireName: string | undefined;
  if (conceived) {
    freeBred = breeding.breedingType === 'free';
    sireId = breeding.stallionId;
    sireName = breeding.stallionName;
    if (!freeBred) {
      const sireLineage = sire === undefined ? undefined : stallionLineage(sire.duties, sire.foal);
      const damGeneration = dam === undefined ? undefined : mareGeneration(dam.group);
      if (sireLineage === undefined || damGeneration === undefined) {
        issues.push('無法推導產駒的系與代數：種牡馬沒有系位置，或母馬尚未指定用途');
      } else {
        lineage = offspringLineage(sireLineage, damGeneration);
      }
    }
  } else if (yearIssue === undefined) {
    warnings.push(conceptionWarning(birthYear - 1, breeding));
    const name = input.sireName.trim();
    sireName = name === '' ? undefined : name;
  }
  const disposition = input.disposition ?? defaultDisposition(freeBred);
  if (!isDispositionAllowed(freeBred, disposition)) {
    issues.push('自由配種產駒只能待售或已售出，不能保留');
  }
  const preview: FoalPreview | undefined =
    issues.length > 0
      ? undefined
      : {
          breedingYear: conceived ? breeding.gameYear : undefined,
          freeBred,
          lineage,
          sireLabel: nameOf(sire?.horse) ?? sireName,
          trackingName: trackingName(
            damHorse === undefined ? undefined : nameForTracking(damHorse),
            birthYear,
          ),
        };
  return { issues, warnings, preview, sireId, sireName, disposition, details };
}

async function planFromDatabase(context: ServiceContext, input: FoalInput) {
  const game = await requireCurrentGame(context);
  const state = await loadFoalBirthState(
    context.database,
    game.id,
    input.damId,
    input.birthYear ?? 0,
  );
  return { game, plan: planFoal(game, state, input) };
}

export async function checkRegisterFoal(
  context: ServiceContext,
  input: FoalInput,
): Promise<FoalCheck> {
  const { plan } = await planFromDatabase(context, input);
  return { issues: plan.issues, warnings: plan.warnings, preview: plan.preview };
}

export interface RegisteredFoal {
  readonly horse: Horse;
  readonly foal: Foal;
  readonly trackingName: string | undefined;
}

function lineageValue(lineage: Lineage): JsonObject {
  return { position: lineage.position, generation: lineage.generation };
}

/**
 * 登記產駒（需求規格 9.3、BRD-01）：建立馬匹與產駒並連回前一年的受胎紀錄。追蹤名由母馬名與出生年推導，
 * 不保存；父系取內部種牡馬的父系，牝系沿用母馬。
 */
export async function registerFoal(
  context: ServiceContext,
  input: FoalInput,
): Promise<RegisteredFoal> {
  const { game, plan } = await planFromDatabase(context, input);
  if (plan.issues.length > 0) {
    throw new ServiceError('invalidInput', plan.issues.join('；'));
  }
  requireAcceptedWarnings(plan.warnings, input.acceptedWarnings ?? []);
  const { damId } = input;
  const birthYear = input.birthYear ?? 0;
  const now = context.now().toISOString();
  const records = await trackWrite(context, () =>
    insertFoal(context.database, {
      gameId: game.id,
      damId,
      birthYear,
      touch: gameTouch(context, now),
      build: (stored, state) => {
        const current = planFoal(stored, state, input);
        if (current.issues.length > 0) {
          throw new ServiceError('invalidInput', current.issues.join('；'));
        }
        requireAcceptedWarnings(current.warnings, input.acceptedWarnings ?? []);
        const { preview, sireId, sireName, disposition, details, warnings } = current;
        if (preview === undefined || input.sex === undefined) {
          throw new ServiceError('invalidInput', '產駒資料不完整');
        }
        const id = context.newId();
        const sireSubsystem = state.sire?.horse?.sireSubsystem;
        const femaleLine = state.damHorse?.femaleLine;
        const horse: Horse = {
          id,
          sex: input.sex,
          birthYear,
          ...(sireId === undefined ? {} : { sireId }),
          ...(sireName === undefined ? {} : { sireName }),
          damId,
          ...(sireSubsystem === undefined ? {} : { sireSubsystem }),
          ...(femaleLine === undefined ? {} : { femaleLine }),
          stageNumbers: [],
          aliases: [],
        };
        const { lineage, freeBred } = preview;
        const foal: Foal = {
          id,
          damId,
          birthYear,
          ...(lineage === undefined ? {} : { lineage }),
          freeBred,
          disposition,
          ...details,
        };
        const breeding =
          preview.breedingYear === undefined || state.breeding === undefined
            ? undefined
            : { ...state.breeding, foalId: id };
        const events: HistoryEvent[] = [
          userEvent(context, {
            subjectId: id,
            type: 'horseCreated',
            gameYear: stored.currentYear,
            occurredAt: now,
            after: { sex: input.sex, birthYear, damId },
          }),
          userEvent(context, {
            subjectId: id,
            type: 'foalBorn',
            gameYear: birthYear,
            timing: BIRTH_TIMING,
            occurredAt: now,
            after: {
              damId,
              freeBred,
              disposition,
              ...(lineage === undefined ? {} : { lineage: lineageValue(lineage) }),
              ...(preview.breedingYear === undefined ? {} : { breedingYear: preview.breedingYear }),
              ...(warnings.length === 0
                ? {}
                : { confirmations: warnings.map((warning) => warning.code) }),
            },
          }),
        ];
        return { horse, foal, breeding, events };
      },
    }),
  );
  return { horse: records.horse, foal: records.foal, trackingName: plan.preview?.trackingName };
}

async function requireFoalHorse(context: ServiceContext, gameId: string, foalId: string) {
  const horse = await getHorse(context.database, gameId, foalId);
  if (horse === undefined) {
    throw new ServiceError('invalidInput', '找不到這匹產駒');
  }
  return horse;
}

export interface FoalNameInput {
  readonly foalId: string;
  /** 空白表示清空正式馬名，回退顯示追蹤名。 */
  readonly officialName: string;
}

function officialNameValue(horse: Horse): JsonObject {
  return horse.officialName === undefined ? {} : { officialName: horse.officialName };
}

/**
 * 補登、取代或清空正式馬名（需求規格 9.4、BRD-08、BRD-10）：只改馬匹的名稱欄位，識別、母馬、出生年、
 * 能力與牧場處置不變。被取代的正式馬名保留為別名，清空後回退顯示追蹤名。已轉入母馬群者馬名唯讀（6.4）。
 */
export async function nameFoal(context: ServiceContext, input: FoalNameInput): Promise<Horse> {
  const game = await requireCurrentGame(context);
  await requireFoalHorse(context, game.id, input.foalId);
  const name = input.officialName.trim();
  const now = context.now().toISOString();
  const result = await trackWrite(context, () =>
    modifyFoal(context.database, {
      gameId: game.id,
      foalId: input.foalId,
      touch: gameTouch(context, now),
      apply: ({ game: stored, horse, mare }) => {
        if (mare !== undefined) {
          throw new ServiceError(
            'invalidInput',
            '繁殖牝馬馬名唯讀，已轉入母馬群的母駒不能修改正式馬名',
          );
        }
        const previous = horse.officialName;
        if ((previous ?? '') === name) {
          throw new ServiceError('invalidInput', '正式馬名沒有變更');
        }
        const keepsAlias =
          previous !== undefined &&
          name !== '' &&
          !horse.aliases.some((alias) => alias.name === previous);
        const aliases: readonly HorseAlias[] = keepsAlias
          ? [...horse.aliases, { kind: 'manual', name: previous, gameYear: stored.currentYear }]
          : horse.aliases;
        const named: Horse = Object.fromEntries(
          Object.entries({
            ...horse,
            officialName: name === '' ? undefined : name,
            aliases,
          }).filter(([, value]) => value !== undefined),
        ) as unknown as Horse;
        const event = userEvent(context, {
          subjectId: horse.id,
          type: 'horseNamed',
          gameYear: stored.currentYear,
          occurredAt: now,
          before: officialNameValue(horse),
          after: officialNameValue(named),
        });
        return { horse: named, events: [event] };
      },
    }),
  );
  return result.horse;
}

export interface FoalUpdateInput extends FoalDetailsInput {
  readonly foalId: string;
  readonly disposition: Disposition;
}

const FOAL_DETAIL_FIELDS = [
  'disposition',
  'sp',
  'st',
  'subParams',
  'turf',
  'dirt',
  'distanceText',
  'kodashi',
  'note',
] as const;

function foalDetailValue(foal: Foal): JsonObject {
  const value: Record<string, JsonValue> = {};
  for (const field of FOAL_DETAIL_FIELDS) {
    const item = foal[field];
    if (item !== undefined) {
      value[field] = item;
    }
  }
  return value;
}

/** 更正能力、適性、牧場處置與備註（需求規格 9.3）：只寫回產駒紀錄並保存前後值，名稱與父母不變。 */
export async function updateFoal(context: ServiceContext, input: FoalUpdateInput): Promise<Foal> {
  const game = await requireCurrentGame(context);
  await requireFoalHorse(context, game.id, input.foalId);
  const issues: string[] = [];
  const details = detailsFrom(input, issues);
  if (issues.length > 0) {
    throw new ServiceError('invalidInput', issues.join('；'));
  }
  const now = context.now().toISOString();
  const result = await trackWrite(context, () =>
    modifyFoal(context.database, {
      gameId: game.id,
      foalId: input.foalId,
      touch: gameTouch(context, now),
      apply: ({ game: stored, foal, mare }) => {
        if (!isDispositionAllowed(foal.freeBred, input.disposition)) {
          throw new ServiceError('invalidInput', '自由配種產駒只能待售或已售出，不能保留');
        }
        if (mare !== undefined && input.disposition !== 'keep') {
          throw new ServiceError('invalidInput', '已轉入母馬群的母駒牧場處置固定為保留');
        }
        const { id, damId, birthYear, lineage, freeBred } = foal;
        const next: Foal = {
          id,
          damId,
          birthYear,
          ...(lineage === undefined ? {} : { lineage }),
          freeBred,
          disposition: input.disposition,
          ...details,
        };
        const before = foalDetailValue(foal);
        const after = foalDetailValue(next);
        if (JSON.stringify(before) === JSON.stringify(after)) {
          throw new ServiceError('invalidInput', '產駒資料沒有變更');
        }
        const event = userEvent(context, {
          subjectId: id,
          type: 'foalChanged',
          gameYear: stored.currentYear,
          occurredAt: now,
          before,
          after,
        });
        return { foal: next, events: [event] };
      },
    }),
  );
  return result.foal;
}

/** 產駒卡與密集清單的一列（需求規格 9.3、9.4、13.4）。 */
export interface FoalCard {
  readonly id: string;
  /** 正式馬名或其他名稱；未命名時為追蹤名。 */
  readonly name: string;
  readonly named: boolean;
  readonly trackingName: string | undefined;
  /** 名稱、別名與追蹤名，供關鍵字比對。 */
  readonly searchNames: readonly string[];
  readonly sex: Sex;
  readonly birthYear: number;
  readonly age: number;
  readonly damId: string;
  readonly damName: string | undefined;
  readonly sireName: string | undefined;
  readonly lineage: Lineage | undefined;
  readonly freeBred: boolean;
  readonly disposition: Disposition;
  readonly sp: number | undefined;
  readonly st: number | undefined;
  readonly subParams: SubParams;
  readonly subParamTotal: number | undefined;
  readonly turf: Aptitude | undefined;
  readonly dirt: Aptitude | undefined;
  readonly surface: SurfaceSummary | undefined;
  readonly distanceText: string | undefined;
  readonly kodashi: number | undefined;
  readonly note: string | undefined;
  /** 已轉入為繁殖牝馬。 */
  readonly isMare: boolean;
}

export interface FoalCardSource {
  readonly foal: Foal;
  readonly horse: Horse;
  readonly dam: Horse | undefined;
  readonly sire: Horse | undefined;
  readonly currentYear: number;
  readonly isMare: boolean;
}

export function buildFoalCard(source: FoalCardSource): FoalCard {
  const { foal, horse, dam, sire } = source;
  const tracking = trackingName(
    dam === undefined ? undefined : nameForTracking(dam),
    foal.birthYear,
  );
  const officialName = horseDisplayName(horse, undefined);
  const names = [
    officialName,
    horse.baseName,
    ...horse.aliases.map((alias) => alias.name),
    tracking,
  ].filter((name): name is string => name !== undefined && name !== '');
  return {
    id: foal.id,
    name: officialName ?? tracking ?? '（沒有馬名）',
    named: officialName !== undefined,
    trackingName: tracking,
    searchNames: [...new Set(names)],
    sex: horse.sex,
    birthYear: foal.birthYear,
    age: ageInYear(foal.birthYear, source.currentYear) ?? 0,
    damId: foal.damId,
    damName: dam === undefined ? undefined : horseDisplayName(dam, undefined),
    sireName:
      (sire === undefined ? undefined : horseDisplayName(sire, undefined)) ?? horse.sireName,
    lineage: foal.lineage,
    freeBred: foal.freeBred,
    disposition: foal.disposition,
    sp: foal.sp,
    st: foal.st,
    subParams: foal.subParams ?? {},
    subParamTotal: subParamTotal(foal.subParams),
    turf: foal.turf,
    dirt: foal.dirt,
    surface: surfaceSummary(foal.turf, foal.dirt),
    distanceText: foal.distanceText,
    kodashi: foal.kodashi,
    note: foal.note,
    isMare: source.isMare,
  };
}

async function buildCards(
  context: ServiceContext,
  game: Game,
  foals: readonly Foal[],
): Promise<FoalCard[]> {
  const [mares, horses] = await Promise.all([
    listMares(context.database, game.id),
    getHorsesByIds(
      context.database,
      game.id,
      foals.map((foal) => foal.id),
    ),
  ]);
  const relatedIds = [...horses.values()].flatMap((horse) => [
    ...(horse.damId === undefined ? [] : [horse.damId]),
    ...(horse.sireId === undefined ? [] : [horse.sireId]),
  ]);
  const related = await getHorsesByIds(context.database, game.id, [...new Set(relatedIds)]);
  const mareIds = new Set(mares.map((mare) => mare.id));
  return foals.flatMap((foal) => {
    const horse = horses.get(foal.id);
    if (horse === undefined) {
      return [];
    }
    return [
      buildFoalCard({
        foal,
        horse,
        dam: related.get(foal.damId),
        sire: horse.sireId === undefined ? undefined : related.get(horse.sireId),
        currentYear: game.currentYear,
        isMare: mareIds.has(foal.id),
      }),
    ];
  });
}

export interface FoalList {
  readonly currentYear: number;
  readonly cards: readonly FoalCard[];
}

/** 產駒清單資料：目前遊戲局全部產駒；篩選與排序在記憶體中處理。 */
export async function loadFoalList(context: ServiceContext): Promise<FoalList> {
  const game = await requireCurrentGame(context);
  const foals = await listFoals(context.database, game.id);
  return { currentYear: game.currentYear, cards: await buildCards(context, game, foals) };
}

export type FoalSort = 'birthYearDesc' | 'spDesc' | 'stAsc' | 'stDesc';

export type SexFilter = Sex | 'any';

export interface FoalFilterOptions {
  readonly birthYear: number | undefined;
  readonly sex: SexFilter;
  readonly disposition: Disposition | undefined;
  readonly unnamedOnly: boolean;
  readonly keyword: string;
}

export const DEFAULT_FOAL_FILTER: FoalFilterOptions = {
  birthYear: undefined,
  sex: 'any',
  disposition: undefined,
  unnamedOnly: false,
  keyword: '',
};

export function matchesFoalFilter(card: FoalCard, options: FoalFilterOptions): boolean {
  const keyword = options.keyword.trim();
  return (
    (options.birthYear === undefined || card.birthYear === options.birthYear) &&
    (options.sex === 'any' || card.sex === options.sex) &&
    (options.disposition === undefined || card.disposition === options.disposition) &&
    (!options.unnamedOnly || !card.named) &&
    (keyword === '' || card.searchNames.some((name) => name.includes(keyword)))
  );
}

/** 沒有數值的排在最後。 */
function compareNumbers(a: number | undefined, b: number | undefined, direction: 1 | -1): number {
  if (a === undefined || b === undefined) {
    return (a === undefined ? 1 : 0) - (b === undefined ? 1 : 0);
  }
  return (a - b) * direction;
}

/** 需求規格 9.3、BRD-12：SP 依高低排序；ST 是距離定位，只依數值大小排序，不代表優劣。 */
export function sortFoalCards(cards: readonly FoalCard[], sort: FoalSort): FoalCard[] {
  const primary = (a: FoalCard, b: FoalCard): number => {
    switch (sort) {
      case 'birthYearDesc':
        return b.birthYear - a.birthYear;
      case 'spDesc':
        return compareNumbers(a.sp, b.sp, -1);
      case 'stAsc':
        return compareNumbers(a.st, b.st, 1);
      case 'stDesc':
        return compareNumbers(a.st, b.st, -1);
    }
  };
  return [...cards].sort(
    (a, b) =>
      primary(a, b) ||
      b.birthYear - a.birthYear ||
      a.name.localeCompare(b.name, 'ja') ||
      a.id.localeCompare(b.id),
  );
}

export interface MareFoals {
  readonly currentYear: number;
  /** 新到舊（需求規格 13.4、BRD-04）。 */
  readonly timeline: readonly FoalTimelineEntry[];
  readonly cards: readonly FoalCard[];
}

/** 詳情欄產駒頁籤：產駒卡時間軸，含輪空、未登記與預定出生年度。 */
export async function loadMareFoals(context: ServiceContext, mareId: string): Promise<MareFoals> {
  const game = await requireCurrentGame(context);
  const mare = await getMare(context.database, game.id, mareId);
  if (mare === undefined) {
    throw new ServiceError('invalidInput', '找不到這匹繁殖牝馬');
  }
  const [breedings, foals, events] = await Promise.all([
    listBreedingsForMare(context.database, game.id, mareId),
    listFoalsForDam(context.database, game.id, mareId),
    listEventsForSubject(context.database, game.id, mareId),
  ]);
  const yearsOf = (type: HistoryEvent['type']) =>
    events.filter((event) => event.type === type).map((event) => event.gameYear);
  const joinedYear = Math.min(...yearsOf('mareAdded'), game.currentYear);
  const lastYear =
    mare.status === 'left' ? Math.max(...yearsOf('mareSold'), joinedYear) : game.currentYear;
  return {
    currentYear: game.currentYear,
    timeline: buildFoalTimeline({ breedings, foals, joinedYear, lastYear }),
    cards: await buildCards(context, game, foals),
  };
}
