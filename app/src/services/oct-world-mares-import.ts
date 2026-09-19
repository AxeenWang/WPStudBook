import { trackingName } from '../domain/foal.ts';
import type { HistoryEvent } from '../domain/history-event.ts';
import {
  formatAbilityNo,
  horseDisplayName,
  nameForTracking,
  withStageNumber,
  type Horse,
} from '../domain/horse.ts';
import { findDuplicateAbilityNos, inferBirthYear } from '../domain/identity.ts';
import type { PreviewIssue, PreviewOutcome, PreviewRow } from '../domain/import-batch.ts';
import { isMareSite } from '../domain/mare.ts';
import type { Timing } from '../domain/timing.ts';
import { readBroodmareRow, type BroodmareValues } from '../import/broodmare.ts';
import type { ParsedFile } from '../import/parse.ts';
import { listFoals } from '../storage/foals.ts';
import { getHorsesByIds } from '../storage/horses.ts';
import type { CollectionRecord } from '../storage/imports.ts';
import { listMares } from '../storage/mares.ts';
import type { ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import { userEvent } from './events.ts';
import { importedStageNumber } from './import-identity.ts';
import { mapInBatches, type ImportProgressReporter } from './import-progress.ts';
import type { ImportChoice, ImportHandler } from './imports.ts';
import { horseNameKeys, matchesName } from './name-keys.ts';

/**
 * 預覽的處置（需求規格 11.10）。只有配對到在其他牧場的自家產駒會寫入；
 * 自家牧場與其他母馬一律略過，只計入筆數。
 */
export type OctDisposition =
  /** 第一次出現：建立「在其他牧場成為繁殖牝馬」事件，保存牧場與繁殖牝馬馬番号（OCT-02）。 */
  | 'new'
  /** 持續在表、牧場相同：更新最後確認年（OCT-05）。 */
  | 'continuing'
  /** 持續在表、牧場不同：更新所在牧場並保存變更歷程（OCT-05）。 */
  | 'moved'
  /** 已經記錄過這一年（重匯）或檔案比最後確認年舊：不寫入。 */
  | 'unchanged'
  /** 能力番号與出生年相符，但性別、馬名或母馬明顯不符：交給使用者（6.2）。 */
  | 'conflict'
  /** 自家牧場 32～35 的列：略過，繁殖牝馬圈只由五月總表負責（OCT-04）。 */
  | 'ownFarm'
  /** 不是自家產駒：不建立、不保存，只計入略過筆數（OCT-03）。 */
  | 'other';

export interface OctMareRow extends PreviewRow {
  readonly disposition: OctDisposition;
  readonly values: BroodmareValues;
  readonly birthYear: number | undefined;
  /** 配對到的自家產駒（預覽時的狀態）；略過的列沒有。 */
  readonly horse: Horse | undefined;
  /** 自家產駒在本程式裡的名稱：正式馬名或追蹤名。 */
  readonly foalLabel: string | undefined;
}

export interface OctOverview {
  readonly total: number;
  readonly ownFarm: number;
  readonly other: number;
  readonly new: number;
  /** 持續在表（含已記錄過的重匯）。 */
  readonly continuing: number;
  readonly moved: number;
  readonly conflict: number;
}

const ISSUES = {
  notFemale: {
    code: 'notFemale',
    message: '能力番号與出生年相符的自家產駒不是牝馬，列為衝突，不寫入',
    handling: 'confirm',
  },
  nameMismatch: {
    code: 'nameMismatch',
    message: '能力番号與出生年相符，但馬名不符，列為衝突，不寫入',
    handling: 'confirm',
  },
  damMismatch: {
    code: 'damMismatch',
    message: '能力番号與出生年相符，但母馬不符，列為衝突，不寫入',
    handling: 'confirm',
  },
  otherFate: {
    code: 'otherFate',
    message: '這匹自家產駒已記錄為其他去向（例如成為種牡馬），列為衝突，不寫入',
    handling: 'confirm',
  },
  noFarm: {
    code: 'noFarm',
    message: '牧場欄空白，無法記錄所在牧場，不寫入',
    handling: 'confirm',
  },
  olderFile: {
    code: 'olderFile',
    message: '這份檔案比最後確認年舊，不改所在牧場與最後確認年',
    handling: 'confirm',
  },
  stillInHerd: {
    code: 'stillInHerd',
    message: '這匹在繁殖牝馬圈裡仍是生產中；十月總表不改繁殖牝馬圈，請確認是否已經賣出',
    handling: 'confirm',
  },
} as const satisfies Record<string, PreviewIssue>;

function halted(problem: string): ServiceError {
  return new ServiceError('importHalted', `匯入停止，資料不變：${problem}`);
}

/** 能力番号重複時整份停止（需求規格 6.2、ID-06）；`牧場` 不套用範圍檢查（11.10）。 */
function checkFile(rows: readonly BroodmareValues[]): void {
  const duplicated = findDuplicateAbilityNos(rows);
  if (duplicated.length > 0) {
    throw halted(
      `十月全世界繁殖牝馬總表內有重複的能力番号：${duplicated.map(formatAbilityNo).join('、')}`,
    );
  }
}

interface OwnFoal {
  readonly horse: Horse;
  readonly label: string;
  readonly damKeys: ReadonlySet<string>;
  /** 在繁殖牝馬圈裡仍是生產中。 */
  readonly producing: boolean;
}

function identityKey(abilityNo: number, birthYear: number): string {
  return `${String(abilityNo)}:${String(birthYear)}`;
}

interface Classified {
  readonly disposition: OctDisposition;
  readonly outcome: PreviewOutcome;
  readonly issues: readonly PreviewIssue[];
  readonly own: OwnFoal | undefined;
}

function classify(
  values: BroodmareValues,
  birthYear: number | undefined,
  exportYear: number,
  own: ReadonlyMap<string, OwnFoal>,
): Classified {
  const skip = (disposition: OctDisposition): Classified => ({
    disposition,
    outcome: 'skip',
    issues: [],
    own: undefined,
  });
  const { farmNo, abilityNo } = values;
  if (farmNo !== undefined && isMareSite(farmNo)) {
    return skip('ownFarm');
  }
  const match =
    abilityNo === undefined || birthYear === undefined
      ? undefined
      : own.get(identityKey(abilityNo, birthYear));
  if (match === undefined) {
    return skip('other');
  }
  const conflict = (issue: PreviewIssue): Classified => ({
    disposition: 'conflict',
    outcome: 'review',
    issues: [issue],
    own: match,
  });
  const { horse } = match;
  if (horse.sex !== 'female') {
    return conflict(ISSUES.notFemale);
  }
  // 需求規格 6.2：能力番号與出生年都相同，但馬名或父母明顯不符。雙方都有名稱可比時才算不符。
  const names = horseNameKeys(horse);
  if (
    names.size > 0 &&
    !matchesName(values.fullName, names) &&
    !matchesName(values.baseName, names)
  ) {
    return conflict(ISSUES.nameMismatch);
  }
  if (values.damName !== undefined && match.damKeys.size > 0) {
    if (!matchesName(values.damName, match.damKeys)) {
      return conflict(ISSUES.damMismatch);
    }
  }
  if (farmNo === undefined) {
    return conflict(ISSUES.noFarm);
  }
  const extra = match.producing ? [ISSUES.stillInHerd] : [];
  const { fate } = horse;
  if (fate === undefined) {
    return { disposition: 'new', outcome: 'apply', issues: extra, own: match };
  }
  // 成為種牡馬只會記在公馬上，走到這裡的一定是牝馬；留著是為了去向日後多一種時不會默默覆寫。
  if (fate.kind !== 'mareElsewhere') {
    return conflict(ISSUES.otherFate);
  }
  if (exportYear < fate.lastSeenYear) {
    return { disposition: 'unchanged', outcome: 'skip', issues: [ISSUES.olderFile], own: match };
  }
  if (fate.farmNo !== farmNo) {
    return { disposition: 'moved', outcome: 'apply', issues: extra, own: match };
  }
  const numbered =
    values.horseNo === undefined
      ? horse
      : withStageNumber(horse, importedStageNumber('octWorldMares', values.horseNo, exportYear));
  return fate.lastSeenYear === exportYear && numbered === horse
    ? { disposition: 'unchanged', outcome: 'skip', issues: [], own: match }
    : { disposition: 'continuing', outcome: 'apply', issues: extra, own: match };
}

export interface PreviewOctWorldMaresInput {
  readonly gameId: string;
  readonly file: ParsedFile;
  readonly choice: ImportChoice;
  readonly progress?: ImportProgressReporter | undefined;
}

/**
 * 十月全世界繁殖牝馬總表的預覽（需求規格 11.10）：含日本、美國、歐洲全部現役繁殖牝馬，
 * 以能力番号＋出生年只和自家產駒配對。數千筆分批處理並回報進度（12.5、OCT-08）。
 */
export async function previewOctWorldMares(
  context: ServiceContext,
  input: PreviewOctWorldMaresInput,
): Promise<OctMareRow[]> {
  const { gameId, file, choice } = input;
  const values = file.rows.map(readBroodmareRow);
  checkFile(values);
  const exportYear = choice.gameYear;

  const [foals, mares] = await Promise.all([
    listFoals(context.database, gameId),
    listMares(context.database, gameId),
  ]);
  const horses = await getHorsesByIds(context.database, gameId, [
    ...new Set([...foals.map((foal) => foal.id), ...foals.map((foal) => foal.damId)]),
  ]);
  const producing = new Set(
    mares.filter((mare) => mare.status === 'producing').map((mare) => mare.id),
  );
  const own = new Map<string, OwnFoal>();
  for (const foal of foals) {
    const horse = horses.get(foal.id);
    const birthYear = horse?.birthYear ?? foal.birthYear;
    if (horse?.abilityNo === undefined) {
      continue;
    }
    const dam = horses.get(foal.damId);
    const tracking = trackingName(dam === undefined ? undefined : nameForTracking(dam), birthYear);
    own.set(identityKey(horse.abilityNo, birthYear), {
      horse,
      label: horseDisplayName(horse, tracking) ?? horse.id,
      damKeys: horseNameKeys(dam),
      producing: producing.has(horse.id),
    });
  }

  return mapInBatches(
    values,
    (item): OctMareRow => {
      const birthYear = inferBirthYear('octWorldMares', exportYear, item.age);
      const classified = classify(item, birthYear, exportYear, own);
      return {
        key: String(item.lineNumber),
        lineNumber: item.lineNumber,
        label: item.fullName ?? `第 ${String(item.lineNumber)} 行`,
        outcome: classified.outcome,
        issues: classified.issues,
        disposition: classified.disposition,
        values: item,
        birthYear,
        horse: classified.own?.horse,
        foalLabel: classified.own?.label,
      };
    },
    input.progress ?? (() => undefined),
  );
}

export function summariseOctRows(rows: readonly OctMareRow[]): OctOverview {
  const count = (...dispositions: OctDisposition[]) =>
    rows.filter((row) => dispositions.includes(row.disposition)).length;
  return {
    total: rows.length,
    ownFarm: count('ownFarm'),
    other: count('other'),
    new: count('new'),
    continuing: count('continuing', 'unchanged'),
    moved: count('moved'),
    conflict: count('conflict'),
  };
}

/** 預覽只列出配對到的自家產駒（需求規格 11.10、OCT-08），略過的列只算筆數。 */
export function matchedOctRows(rows: readonly OctMareRow[]): OctMareRow[] {
  return rows.filter((row) => row.horse !== undefined);
}

interface BuildContext {
  readonly gameYear: number;
  readonly timing: Timing;
  readonly newId: () => string;
  readonly occurredAt: string;
}

interface Written {
  readonly horse: Horse;
  readonly events: HistoryEvent[];
}

function applyRow(row: OctMareRow, build: BuildContext): Written | undefined {
  const { horse, values } = row;
  const farmNo = values.farmNo;
  if (horse === undefined || farmNo === undefined) {
    return undefined;
  }
  const event = (type: HistoryEvent['type'], payload: Pick<HistoryEvent, 'before' | 'after'>) =>
    userEvent(
      { newId: build.newId },
      {
        subjectId: horse.id,
        type,
        gameYear: build.gameYear,
        timing: build.timing,
        occurredAt: build.occurredAt,
        before: payload.before,
        after: payload.after,
      },
    );
  const numbered = (next: Horse): Horse =>
    values.horseNo === undefined
      ? next
      : withStageNumber(next, importedStageNumber('octWorldMares', values.horseNo, build.gameYear));
  const { fate } = horse;
  switch (row.disposition) {
    case 'new':
      return {
        horse: numbered({
          ...horse,
          fate: {
            kind: 'mareElsewhere',
            gameYear: build.gameYear,
            farmNo,
            lastSeenYear: build.gameYear,
          },
        }),
        events: [
          event('becameMareElsewhere', {
            after: {
              farmNo,
              ...(values.horseNo === undefined ? {} : { horseNo: values.horseNo }),
            },
          }),
        ],
      };
    case 'moved':
    case 'continuing': {
      if (fate?.kind !== 'mareElsewhere') {
        return undefined;
      }
      const next = numbered({
        ...horse,
        fate: { ...fate, farmNo, lastSeenYear: Math.max(fate.lastSeenYear, build.gameYear) },
      });
      return {
        horse: next,
        // 最後確認年每年更新不寫事件；牧場不同時才保存變更歷程（需求規格 11.10、OCT-05）。
        events:
          row.disposition === 'moved'
            ? [event('mareElsewhereMoved', { before: { farmNo: fate.farmNo }, after: { farmNo } })]
            : [],
      };
    }
    default:
      return undefined;
  }
}

/** 這次匯入會寫到的資料表：只有自家產駒的去向與馬番号（需求規格 11.2）。 */
export const OCT_WORLD_MARES_COLLECTIONS = ['horses'] as const;

export function buildOctWorldMares(
  rows: readonly OctMareRow[],
  build: BuildContext,
): { readonly records: readonly CollectionRecord[]; readonly events: readonly HistoryEvent[] } {
  const records: CollectionRecord[] = [];
  const events: HistoryEvent[] = [];
  for (const row of rows) {
    const written = applyRow(row, build);
    if (written !== undefined) {
      records.push({ collection: 'horses', record: written.horse });
      events.push(...written.events);
    }
  }
  return { records, events };
}

/**
 * 十月全世界繁殖牝馬總表（需求規格 11.10，選用）：找出在其他牧場成為繁殖牝馬的自家產駒，
 * 保存去向事件、繁殖牝馬馬番号、所在牧場與最後確認年。不建立或保存非自家產駒的馬，
 * 不處理自家牧場的母馬，不改寫繁殖牝馬圈、年度資料、血統或受胎紀錄（11.2）。
 */
export function octWorldMaresImportHandler(): ImportHandler<OctMareRow> {
  return {
    type: 'octWorldMares',
    collections: [...OCT_WORLD_MARES_COLLECTIONS],
    preview: (context, game, file, choice, progress) =>
      previewOctWorldMares(context, { gameId: game.id, file, choice, progress }),
    build: ({ rows, choice, newId, occurredAt }) =>
      buildOctWorldMares(rows, {
        gameYear: choice.gameYear,
        timing: choice.timing,
        newId,
        occurredAt,
      }),
  };
}
