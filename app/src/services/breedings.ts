import {
  BIRTH_TIMING,
  BREEDING_TYPES,
  CONCEPTIONS,
  expectedBirthYearFor,
  type Breeding,
  type BreedingType,
  type Conception,
} from '../domain/breeding.ts';
import { stallionLineage, trackingName } from '../domain/foal.ts';
import { horseDisplayName, nameForTracking } from '../domain/horse.ts';
import { MIN_GAME_YEAR } from '../domain/game.ts';
import type { JsonObject } from '../domain/json.ts';
import type { Lineage } from '../domain/lineage.ts';
import type { PedigreeWarningCode } from '../domain/pedigree-check.ts';
import type { Timing } from '../domain/timing.ts';
import { getBreeding, listBreedingsForMare, writeBreeding } from '../storage/breedings.ts';
import { getFoal, listFoalsForDam } from '../storage/foals.ts';
import { getHorse, getHorsesByIds } from '../storage/horses.ts';
import { getMare } from '../storage/mares.ts';
import { listStallionDuties } from '../storage/stallion-duties.ts';
import { trackWrite, type ServiceContext } from './context.ts';
import { loadHorseNames } from './horse-names.ts';
import { resolveTaskBreeding } from './tasks.ts';
import { ServiceError } from './errors.ts';
import { userEvent } from './events.ts';
import { gameTouch, requireCurrentGame } from './games.ts';

/** 介面用的選項與常數（ui 不能引用 domain 的值）。 */
export const CONCEPTION_OPTIONS: readonly Conception[] = CONCEPTIONS;
export const BREEDING_TYPE_OPTIONS: readonly BreedingType[] = BREEDING_TYPES;
export const FOAL_BIRTH_TIMING: Timing = BIRTH_TIMING;

export interface StallionOption {
  readonly id: string;
  readonly name: string;
  /** 任期所在的系與代數。 */
  readonly lineage: Lineage;
}

/** 配種表單的內部種牡馬選項：擔任過現任的種牡馬（依系位置、代數與馬名排序）。 */
export async function listStallionOptions(context: ServiceContext): Promise<StallionOption[]> {
  const game = await requireCurrentGame(context);
  const duties = (await listStallionDuties(context.database, game.id)).filter(
    (duty) => duty.role === 'current',
  );
  const names = await loadHorseNames(
    context.database,
    game.id,
    duties.map((duty) => duty.horseId),
  );
  const options = new Map<string, StallionOption>();
  for (const duty of duties) {
    const name = names.get(duty.horseId);
    if (name !== undefined && !options.has(duty.horseId)) {
      options.set(duty.horseId, {
        id: duty.horseId,
        name,
        lineage: { position: duty.position, generation: duty.generation },
      });
    }
  }
  return [...options.values()].sort(
    (a, b) =>
      a.lineage.position - b.lineage.position ||
      a.lineage.generation - b.lineage.generation ||
      a.name.localeCompare(b.name, 'ja'),
  );
}

export interface BreedingInput {
  readonly mareId: string;
  readonly gameYear: number | undefined;
  readonly breedingType: BreedingType;
  /** 內部種牡馬；與 stallionName 擇一。 */
  readonly stallionId: string | undefined;
  /** 外部種牡馬名稱；空白表示未填。 */
  readonly stallionName: string;
  /** undefined＝尚未登記受胎狀態（事先登記）。 */
  readonly conception: Conception | undefined;
  /** 依任務看板登記的八系指定配種才有；保存規則快照（需求規格 7.4）。 */
  readonly taskId?: string | undefined;
  /** 使用者已確認的血統警告（需求規格 5.2、10.2）。 */
  readonly acceptedWarnings?: readonly PedigreeWarningCode[] | undefined;
}

const RECORD_FIELDS = [
  'breedingType',
  'stallionId',
  'stallionName',
  'conception',
  'expectedBirthYear',
  'foalId',
] as const;

/** 事件保存的前後值：紀錄中有值的欄位（不含 id、母馬與年份）；規則快照以任務代號表示。 */
export function breedingValue(record: Breeding): JsonObject {
  const value: Record<string, string | number> = {};
  for (const field of RECORD_FIELDS) {
    const item = record[field];
    if (item !== undefined) {
      value[field] = item;
    }
  }
  if (record.ruleSnapshot !== undefined) {
    value.taskId = record.ruleSnapshot.taskId;
  }
  if (record.pedigreeCheck !== undefined) {
    value.activationCount = record.pedigreeCheck.activationCount;
  }
  if (record.deviated === true) {
    value.deviated = '是';
  }
  if (record.confirmations !== undefined) {
    value.confirmations = record.confirmations.join('、');
  }
  return value;
}

function sameContent(a: Breeding | undefined, b: Breeding): boolean {
  return a !== undefined && JSON.stringify(breedingValue(a)) === JSON.stringify(breedingValue(b));
}

/** 已連結產駒的紀錄不能改變受胎、配種類型與種牡馬，否則產駒的父馬與系會對不上。 */
function checkLinkedFoal(stored: Breeding | undefined, next: Breeding): void {
  if (stored?.foalId === undefined) {
    return;
  }
  if (
    next.conception !== '受胎' ||
    next.breedingType !== stored.breedingType ||
    next.stallionId !== stored.stallionId ||
    next.stallionName !== stored.stallionName
  ) {
    throw new ServiceError(
      'invalidInput',
      '這筆繁殖紀錄已連結產駒，不能改變受胎狀態、配種類型或種牡馬',
    );
  }
}

/**
 * 登記或更正一匹母馬某年的繁殖紀錄（需求規格 9.1）：四種受胎狀態原樣保存，受胎時預定隔年 4 月 1 週出生，
 * 其他狀態不建立預定產駒。沒有進行受胎作業（空胎）以外都要有種牡馬；八系指定配種的種牡馬必須有系位置，
 * 產駒的系與代數才能推導（8.2）。
 */
export async function saveBreeding(
  context: ServiceContext,
  input: BreedingInput,
): Promise<Breeding> {
  const game = await requireCurrentGame(context);
  const { mareId, gameYear, breedingType, conception } = input;
  const stallionName = input.stallionName.trim();
  const stallionId = input.stallionId === '' ? undefined : input.stallionId;
  const issues: string[] = [];
  if (
    gameYear === undefined ||
    !Number.isInteger(gameYear) ||
    gameYear < MIN_GAME_YEAR ||
    gameYear > game.currentYear
  ) {
    issues.push(`配種年必須是 ${String(MIN_GAME_YEAR)}～${String(game.currentYear)} 的整數`);
  }
  if (stallionId !== undefined && stallionName !== '') {
    issues.push('種牡馬請選擇內部馬匹或填寫外部馬名，只能擇一');
  }
  if (stallionId === undefined && stallionName === '' && conception !== '空胎') {
    issues.push('請選擇或填寫種牡馬（沒有進行受胎作業時登記為空胎）');
  }
  if (stallionId !== undefined) {
    const [stallion, duties, ownFoal] = await Promise.all([
      getHorse(context.database, game.id, stallionId),
      listStallionDuties(context.database, game.id),
      getFoal(context.database, game.id, stallionId),
    ]);
    if (stallion?.sex !== 'male') {
      issues.push('找不到這匹種牡馬');
    } else if (
      breedingType === 'designated' &&
      stallionLineage(
        duties.filter((duty) => duty.horseId === stallionId),
        ownFoal,
      ) === undefined
    ) {
      issues.push('八系指定配種的種牡馬必須有系位置與代數');
    }
  } else if (breedingType === 'designated' && stallionName !== '') {
    issues.push('八系指定配種必須選擇有系位置的內部種牡馬');
  }
  const mare = await getMare(context.database, game.id, mareId);
  if (mare === undefined) {
    issues.push('找不到這匹繁殖牝馬');
  } else if (breedingType === 'designated' && mare.group.kind === 'unassigned') {
    issues.push('待指定用途的母馬不能登記八系指定配種');
  }
  if (input.taskId !== undefined && breedingType !== 'designated') {
    issues.push('只有八系指定配種可以依任務登記');
  }
  if (issues.length > 0 || gameYear === undefined) {
    throw new ServiceError('invalidInput', issues.join('；'));
  }
  // 規則快照在登記當下解析；之後規則改變不重算已保存的快照（需求規格 7.4、LINE-16）。
  // 系與代數不符時在這裡阻止，血統警告未確認時要求確認（需求規格 10.2、10.3）。
  const resolved =
    input.taskId === undefined
      ? undefined
      : await resolveTaskBreeding(context, {
          taskId: input.taskId,
          mareId,
          stallionId,
          acceptedWarnings: input.acceptedWarnings,
        });
  const fields = {
    breedingType,
    ...(stallionId === undefined ? {} : { stallionId }),
    ...(stallionName === '' ? {} : { stallionName }),
    ...(conception === undefined ? {} : { conception }),
  };
  const draft = (stored: Breeding | undefined): Breeding => {
    const expectedBirthYear = expectedBirthYearFor(gameYear, conception);
    // 沒有指定任務時沿用既有快照與檢查結果，讓後續更正受胎狀態不會抹掉登記當下的規則。
    const designated = breedingType === 'designated';
    const ruleSnapshot = designated ? (resolved?.ruleSnapshot ?? stored?.ruleSnapshot) : undefined;
    const pedigreeCheck = designated
      ? resolved === undefined
        ? stored?.pedigreeCheck
        : resolved.pedigreeCheck
      : undefined;
    const confirmations = designated
      ? resolved === undefined
        ? stored?.confirmations
        : resolved.confirmations
      : undefined;
    return {
      id: stored?.id ?? '',
      mareId,
      gameYear,
      ...fields,
      ...(expectedBirthYear === undefined ? {} : { expectedBirthYear }),
      ...(stored?.foalId === undefined ? {} : { foalId: stored.foalId }),
      ...(ruleSnapshot === undefined ? {} : { ruleSnapshot }),
      ...(pedigreeCheck === undefined ? {} : { pedigreeCheck }),
      ...(confirmations === undefined || confirmations.length === 0 ? {} : { confirmations }),
    };
  };
  const existing = await getBreeding(context.database, game.id, mareId, gameYear);
  checkLinkedFoal(existing, draft(existing));
  if (sameContent(existing, draft(existing))) {
    throw new ServiceError('invalidInput', '繁殖紀錄沒有變更');
  }
  const now = context.now().toISOString();
  return trackWrite(context, () =>
    writeBreeding(context.database, {
      gameId: game.id,
      mareId,
      gameYear,
      touch: gameTouch(context, now),
      apply: ({ game: stored, mare: storedMare, record, nextYearFoalId }) => {
        if (storedMare === undefined) {
          throw new ServiceError('invalidInput', '找不到這匹繁殖牝馬');
        }
        if (conception === '受胎' && record?.foalId === undefined && nextYearFoalId !== undefined) {
          // 產駒已比照自由配種登記，改登受胎會留下無法確認出生、也無法連結的受胎紀錄。
          throw new ServiceError(
            'invalidInput',
            `${String(gameYear + 1)} 年已登記沒有連結繁殖紀錄的產駒，不能把 ${String(gameYear)} 年改登記為受胎`,
          );
        }
        if (gameYear > stored.currentYear) {
          throw new ServiceError(
            'invalidInput',
            `配種年必須是 ${String(MIN_GAME_YEAR)}～${String(stored.currentYear)} 的整數`,
          );
        }
        const next = { ...draft(record), id: record?.id ?? context.newId() };
        checkLinkedFoal(record, next);
        if (sameContent(record, next)) {
          throw new ServiceError('invalidInput', '繁殖紀錄沒有變更');
        }
        const event = userEvent(context, {
          subjectId: mareId,
          type: 'breedingRecorded',
          gameYear: stored.currentYear,
          occurredAt: now,
          before: record === undefined ? undefined : { gameYear, ...breedingValue(record) },
          after: { gameYear, ...breedingValue(next) },
        });
        return { record: next, events: [event] };
      },
    }),
  );
}

export interface BreedingRow {
  readonly record: Breeding;
  /** 內部種牡馬的馬名或外部馬名；空胎且沒有種牡馬時為 undefined。 */
  readonly stallionLabel: string | undefined;
  /** 已連結產駒的顯示名稱。 */
  readonly foalName: string | undefined;
  /** 受胎、尚未連結產駒且預定生產年已到（BRD-01：確認出生後才建立產駒）。 */
  readonly canConfirmBirth: boolean;
}

export interface MareBreedings {
  readonly currentYear: number;
  /** 新到舊。 */
  readonly rows: readonly BreedingRow[];
  readonly stallionOptions: readonly StallionOption[];
}

/** 詳情欄配種頁籤：這匹母馬全部年度的繁殖紀錄與種牡馬選項。 */
export async function loadMareBreedings(
  context: ServiceContext,
  mareId: string,
): Promise<MareBreedings> {
  const game = await requireCurrentGame(context);
  const [records, stallionOptions, foals] = await Promise.all([
    listBreedingsForMare(context.database, game.id, mareId),
    listStallionOptions(context),
    listFoalsForDam(context.database, game.id, mareId),
  ]);
  const birthYears = new Set(foals.map((foal) => foal.birthYear));
  const horses = await getHorsesByIds(
    context.database,
    game.id,
    records.flatMap((record) => (record.foalId === undefined ? [] : [record.foalId])),
  );
  const stallionNames = await loadHorseNames(
    context.database,
    game.id,
    records.flatMap((record) => (record.stallionId === undefined ? [] : [record.stallionId])),
  );
  const mareHorse = await getHorse(context.database, game.id, mareId);
  const nameOf = (id: string | undefined, fallback: string | undefined) =>
    (id === undefined ? undefined : stallionNames.get(id)) ?? fallback;
  const rows = records
    .sort((a, b) => b.gameYear - a.gameYear)
    .map((record): BreedingRow => {
      const foal = record.foalId === undefined ? undefined : horses.get(record.foalId);
      return {
        record,
        stallionLabel: nameOf(record.stallionId, record.stallionName),
        foalName:
          foal === undefined
            ? undefined
            : horseDisplayName(
                foal,
                trackingName(
                  mareHorse === undefined ? undefined : nameForTracking(mareHorse),
                  record.gameYear + 1,
                ),
              ),
        canConfirmBirth:
          record.conception === '受胎' &&
          record.foalId === undefined &&
          record.expectedBirthYear !== undefined &&
          record.expectedBirthYear <= game.currentYear &&
          !birthYears.has(record.expectedBirthYear),
      };
    });
  return { currentYear: game.currentYear, rows, stallionOptions };
}
