import type { Breeding } from '../domain/breeding.ts';
import { trackingName, type Foal } from '../domain/foal.ts';
import type { HistoryEvent } from '../domain/history-event.ts';
import {
  formatAbilityNo,
  horseDisplayName,
  isStallionHorse,
  nameForTracking,
  toBaseName,
  withStageNumber,
  type Horse,
  type HorseAlias,
} from '../domain/horse.ts';
import { findDuplicateAbilityNos, inferBirthYear } from '../domain/identity.ts';
import type { PreviewIssue, PreviewOutcome, PreviewRow } from '../domain/import-batch.ts';
import type { Timing } from '../domain/timing.ts';
import { readJan2yoRow, type Jan2yoValues } from '../import/jan2yo.ts';
import type { ParsedFile } from '../import/parse.ts';
import { isPrefixOnlyName } from '../import/values.ts';
import { listBreedings } from '../storage/breedings.ts';
import { listFoals } from '../storage/foals.ts';
import { getHorsesByIds } from '../storage/horses.ts';
import type { CollectionRecord } from '../storage/imports.ts';
import { listMares } from '../storage/mares.ts';
import type { ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import { userEvent } from './events.ts';
import { officialNameValue } from './foals.ts';
import { importedStageNumber } from './import-identity.ts';
import type { ImportChoice, ImportHandler } from './imports.ts';
import { matchStallionNames } from './stallion-names.ts';

/** 一月總表的一列對到的自家產駒。 */
export interface JanFoal {
  readonly foal: Foal;
  readonly horse: Horse;
  /** 正式馬名或追蹤名。 */
  readonly label: string;
  readonly damLabel: string | undefined;
  readonly sireLabel: string | undefined;
  /** 已轉入母馬群或成為種牡馬：馬名唯讀（需求規格 6.4）。 */
  readonly readOnlyName: boolean;
}

/**
 * 預覽的處置（需求規格 11.3）。
 *
 * 只有唯一配對的列會寫入；零筆或多筆候選列為待核對，使用者從候選中選定一匹後才寫入（JAN-03）。
 */
export type JanDisposition =
  /** 唯一配對：填入正式馬名與基本馬名、保存競走馬馬番号、補入缺少的能力番号。 */
  | 'name'
  /** 已配對，而且名稱、能力番号與馬番号都已是最新。 */
  | 'unchanged'
  /** 零筆或多筆候選、父母不符：人工確認。 */
  | 'review'
  /** 馬名唯讀而總表名稱不同：衝突並略過（需求規格 6.4、ID-08）。 */
  | 'conflict'
  /** 這一局的產駒沒有出現在總表。 */
  | 'unseen'
  /** 非管理的二歲馬：不建立，也不列在管理清單（JAN-02）。 */
  | 'unmanaged'
  /** 馬名空白或只有前綴：略過（需求規格 6.4）。 */
  | 'invalid';

/** 唯一配對的依據：能力番号＋出生年、父馬＋母馬＋出生年（舊產駒），或人工確認。 */
export type JanMatch = 'abilityNo' | 'parents' | 'confirmed';

export interface Jan2yoRow extends PreviewRow {
  readonly disposition: JanDisposition;
  /** 檔案列才有；未出現在總表的產駒沒有。 */
  readonly values: Jan2yoValues | undefined;
  readonly birthYear: number;
  /** 要補名的產駒。 */
  readonly target: JanFoal | undefined;
  readonly matchedBy: JanMatch | undefined;
  /** 人工確認時可選的產駒；空陣列表示沒有可選的候選。 */
  readonly candidates: readonly JanFoal[];
}

export interface Jan2yoOverview {
  readonly birthYear: number;
  readonly fileRows: number;
  readonly name: number;
  /** 取代既有正式馬名的列（BRD-09）。 */
  readonly replaced: number;
  readonly unchanged: number;
  readonly review: number;
  readonly conflict: number;
  readonly unseen: number;
  readonly unmanaged: number;
  readonly invalid: number;
}

const ISSUES = {
  noName: {
    code: 'noName',
    message: '馬名欄空白，略過這一筆',
    handling: 'confirm',
  },
  prefixOnlyName: {
    code: 'prefixOnlyName',
    message: '只有 (外) 或 [地] 前綴、沒有馬名，略過這一筆',
    handling: 'confirm',
  },
  replacesName: {
    code: 'replacesName',
    message: '總表的名稱取代原本的正式馬名，原名稱保留為別名',
    handling: 'confirm',
  },
  parentMismatch: {
    code: 'parentMismatch',
    message: '能力番号與出生年相符，但父母不符；請確認是不是同一匹',
    handling: 'confirm',
  },
  ambiguous: {
    code: 'ambiguousFoals',
    message: '父馬、母馬與出生年相符的產駒不只一匹，請選定是哪一匹',
    handling: 'confirm',
  },
  sharedCandidate: {
    code: 'sharedCandidate',
    message: '總表有其他列也對應到同一匹產駒，請確認是哪一列',
    handling: 'confirm',
  },
  noCandidate: {
    code: 'noCandidate',
    message:
      '母馬是這一局的繁殖牝馬，但沒有父馬、母馬與出生年都相符且未登記能力番号的產駒；請人工核對',
    handling: 'confirm',
  },
  readOnlyName: {
    code: 'readOnlyName',
    message: '已轉入母馬群或成為種牡馬，馬名唯讀；總表的名稱不同，列為衝突並略過',
    handling: 'confirm',
  },
  unseen: {
    code: 'unseenFoal',
    message: '這一局的產駒沒有出現在這份總表；請人工補名或核對',
    handling: 'confirm',
  },
  confirmed: {
    code: 'confirmedCandidate',
    message: '已人工確認對應的產駒',
    handling: 'confirm',
  },
} as const satisfies Record<string, PreviewIssue>;

function halted(problem: string): ServiceError {
  return new ServiceError('importHalted', `匯入停止，資料不變：${problem}`);
}

function lineList(rows: readonly Jan2yoValues[]): string {
  return rows
    .slice(0, 5)
    .map((row) => String(row.lineNumber))
    .join('、');
}

/** `年` 全部是 2（附錄 A.1），能力番号不重複（需求規格 6.2、ID-06），否則整份停止。 */
function checkFile(rows: readonly Jan2yoValues[]): void {
  const problems: string[] = [];
  const ages = rows.filter((row) => row.age !== 2);
  if (ages.length > 0) {
    problems.push(`${String(ages.length)} 筆的 \`年\` 不是 2（第 ${lineList(ages)} 行）`);
  }
  const duplicated = findDuplicateAbilityNos(rows);
  if (duplicated.length > 0) {
    problems.push(`檔案內有重複的能力番号：${duplicated.map(formatAbilityNo).join('、')}`);
  }
  if (problems.length > 0) {
    throw halted(`一月二歲馬總表：${problems.join('；')}`);
  }
}

/**
 * 名稱比對的鍵：去除前後空白（需求規格 11.3），也比對去除 `(外)`、`[地]` 前綴後的基本馬名，
 * 因為同一匹馬在不同檔案或手動輸入時可能一邊有前綴、一邊沒有。
 */
function nameKeys(names: readonly (string | undefined)[]): Set<string> {
  const keys = new Set<string>();
  for (const name of names) {
    if (name === undefined) {
      continue;
    }
    for (const key of [name.trim(), toBaseName(name).trim()]) {
      if (key !== '') {
        keys.add(key);
      }
    }
  }
  return keys;
}

function horseNameKeys(horse: Horse | undefined): Set<string> {
  return horse === undefined
    ? new Set()
    : nameKeys([
        horse.fullName,
        horse.baseName,
        horse.officialName,
        ...horse.aliases.map((alias) => alias.name),
      ]);
}

function matchesName(name: string | undefined, keys: ReadonlySet<string>): boolean {
  return name !== undefined && [...nameKeys([name])].some((key) => keys.has(key));
}

interface FoalKeys {
  readonly entry: JanFoal;
  readonly damKeys: ReadonlySet<string>;
  readonly sireKeys: ReadonlySet<string>;
}

interface Matcher {
  /** 檔案的父馬名稱唯一對應到的內部種牡馬（需求規格 11.8、STL-12）。 */
  readonly stallionIds: ReadonlyMap<string, string>;
}

function damMatches(values: Jan2yoValues, keys: FoalKeys): boolean {
  return matchesName(values.damName, keys.damKeys);
}

function sireMatches(values: Jan2yoValues, keys: FoalKeys, matcher: Matcher): boolean {
  const sireId = keys.entry.horse.sireId;
  const mapped =
    values.sireName === undefined ? undefined : matcher.stallionIds.get(values.sireName.trim());
  return (sireId !== undefined && mapped === sireId) || matchesName(values.sireName, keys.sireKeys);
}

/** 需求規格 6.2：能力番号與出生年都相同，但父母明顯不符。雙方都有名稱可比時才算不符。 */
function parentsConflict(values: Jan2yoValues, keys: FoalKeys, matcher: Matcher): boolean {
  const damDiffers =
    values.damName !== undefined && keys.damKeys.size > 0 && !damMatches(values, keys);
  const sireDiffers =
    values.sireName !== undefined &&
    (keys.sireKeys.size > 0 || keys.entry.horse.sireId !== undefined) &&
    !sireMatches(values, keys, matcher);
  return damDiffers || sireDiffers;
}

/**
 * 補名後的馬匹（需求規格 9.4、11.3）：正式馬名與基本馬名取自總表並標示來源，被取代的名稱留為別名；
 * 補入缺少的能力番号，保存競走馬馬番号（幼駒馬番号留在歷程，JAN-05）。馬名唯讀的馬只補番号。
 * 預覽與套用共用，套用在寫入交易內只能做同步運算。
 */
export function namedHorse(
  horse: Horse,
  values: Jan2yoValues,
  gameYear: number,
  readOnlyName: boolean,
): Horse {
  let next = horse;
  const fullName = values.fullName;
  if (!readOnlyName && fullName !== undefined) {
    const previous = horse.officialName;
    const keepsAlias =
      previous !== undefined &&
      previous !== fullName &&
      !horse.aliases.some((alias) => alias.name === previous);
    const alias: HorseAlias | undefined = keepsAlias
      ? {
          kind: horse.officialNameSource === 'jan2yo' ? 'imported' : 'manual',
          name: previous,
          gameYear,
        }
      : undefined;
    next = {
      ...horse,
      officialName: fullName,
      officialNameSource: 'jan2yo',
      baseName: values.baseName ?? toBaseName(fullName),
      aliases: alias === undefined ? horse.aliases : [...horse.aliases, alias],
    };
  }
  if (next.abilityNo === undefined && values.abilityNo !== undefined) {
    next = { ...next, abilityNo: values.abilityNo };
  }
  return values.horseNo === undefined
    ? next
    : withStageNumber(next, importedStageNumber('jan2yo', values.horseNo, gameYear));
}

function changed(before: Horse, after: Horse): boolean {
  return (
    before.officialName !== after.officialName ||
    before.officialNameSource !== after.officialNameSource ||
    before.baseName !== after.baseName ||
    before.abilityNo !== after.abilityNo ||
    before.aliases.length !== after.aliases.length ||
    before.stageNumbers.length !== after.stageNumbers.length
  );
}

interface Planned {
  readonly disposition: JanDisposition;
  readonly outcome: PreviewOutcome;
  readonly issues: readonly PreviewIssue[];
}

/** 對到一匹產駒之後要做什麼：補名、已是最新、名稱不合法，或唯讀馬名的衝突。 */
function planNaming(values: Jan2yoValues, target: JanFoal, gameYear: number): Planned {
  if (values.fullName === undefined) {
    return { disposition: 'invalid', outcome: 'skip', issues: [ISSUES.noName] };
  }
  if (isPrefixOnlyName(values.fullName)) {
    return { disposition: 'invalid', outcome: 'skip', issues: [ISSUES.prefixOnlyName] };
  }
  const { horse, readOnlyName } = target;
  if (readOnlyName && !matchesName(values.fullName, horseNameKeys(horse))) {
    return { disposition: 'conflict', outcome: 'review', issues: [ISSUES.readOnlyName] };
  }
  const next = namedHorse(horse, values, gameYear, readOnlyName);
  if (!changed(horse, next)) {
    return { disposition: 'unchanged', outcome: 'skip', issues: [] };
  }
  const replaces =
    !readOnlyName && horse.officialName !== undefined && horse.officialName !== values.fullName;
  return { disposition: 'name', outcome: 'apply', issues: replaces ? [ISSUES.replacesName] : [] };
}

interface FirstPass {
  readonly values: Jan2yoValues;
  /** 能力番号＋出生年相符的產駒。 */
  readonly exact: FoalKeys | undefined;
  /** 父馬＋母馬＋出生年相符、未登記能力番号的產駒（只在沒有 exact 時）。 */
  readonly candidates: readonly FoalKeys[];
}

export interface PreviewJan2yoInput {
  readonly gameId: string;
  readonly file: ParsedFile;
  readonly choice: ImportChoice;
}

/** 前一年有配種、尚未連到產駒的母馬：她的二歲馬可能還沒登記產駒。 */
function awaitingFoal(breeding: Breeding, birthYear: number): boolean {
  return (
    breeding.gameYear === birthYear - 1 &&
    breeding.foalId === undefined &&
    breeding.conception !== '空胎' &&
    breeding.conception !== '不受胎'
  );
}

/**
 * 一月二歲馬總表的預覽（需求規格 11.3）：總表含當年全部 2 歲馬，只和這一局的自家產駒配對。
 *
 * 1. 能力番号＋出生年相符 → 同一匹；父母明顯不符時交給使用者（6.2）。
 * 2. 能力番号未登記的舊產駒，才以父馬、母馬、出生年唯一配對；同一匹產駒被兩列以上對到也不算唯一。
 * 3. 對不到任何產駒：母馬是這一局的繁殖牝馬、而且她那一年的產駒還沒被其他列對到時列為待核對，
 *    其他都是非管理的馬，略過（JAN-02）。
 */
export async function previewJan2yo(
  context: ServiceContext,
  input: PreviewJan2yoInput,
): Promise<Jan2yoRow[]> {
  const { gameId, file, choice } = input;
  const values = file.rows.map(readJan2yoRow);
  checkFile(values);
  // 出生年＝匯出年減 2（需求規格 6.3）。
  const birthYear = inferBirthYear('jan2yo', choice.gameYear, undefined) ?? choice.gameYear - 2;

  const [foalList, mareList, breedingList] = await Promise.all([
    listFoals(context.database, gameId),
    listMares(context.database, gameId),
    listBreedings(context.database, gameId),
  ]);
  const foals = foalList.filter((foal) => foal.birthYear === birthYear);
  const awaiting = breedingList.filter((breeding) => awaitingFoal(breeding, birthYear));
  const foalHorses = await getHorsesByIds(
    context.database,
    gameId,
    foals.map((foal) => foal.id),
  );
  const related = await getHorsesByIds(context.database, gameId, [
    ...new Set([
      ...foals.map((foal) => foal.damId),
      ...[...foalHorses.values()].flatMap((horse) =>
        horse.sireId === undefined ? [] : [horse.sireId],
      ),
      ...awaiting.map((breeding) => breeding.mareId),
    ]),
  ]);
  const mareIds = new Set(mareList.map((mare) => mare.id));

  const entries: FoalKeys[] = foals.flatMap((foal) => {
    const horse = foalHorses.get(foal.id);
    if (horse === undefined) {
      return [];
    }
    const dam = related.get(foal.damId);
    const sire = horse.sireId === undefined ? undefined : related.get(horse.sireId);
    const tracking = trackingName(dam === undefined ? undefined : nameForTracking(dam), birthYear);
    const entry: JanFoal = {
      foal,
      horse,
      label: horseDisplayName(horse, tracking) ?? foal.id,
      damLabel: dam === undefined ? undefined : horseDisplayName(dam, undefined),
      sireLabel:
        (sire === undefined ? undefined : horseDisplayName(sire, undefined)) ?? horse.sireName,
      readOnlyName: mareIds.has(horse.id) || isStallionHorse(horse),
    };
    return [
      {
        entry,
        damKeys: horseNameKeys(dam),
        sireKeys: sire === undefined ? nameKeys([horse.sireName]) : horseNameKeys(sire),
      },
    ];
  });

  // 這一年可能有二歲馬的母馬：有這一年的產駒，或前一年配種、還沒連到產駒。
  const dams = new Map<string, ReadonlySet<string>>();
  for (const mareId of [...foals.map((foal) => foal.damId), ...awaiting.map((b) => b.mareId)]) {
    dams.set(mareId, horseNameKeys(related.get(mareId)));
  }
  const ourDamKeys = new Set([...dams.values()].flatMap((keys) => [...keys]));

  const byAbilityNo = new Map(
    entries.flatMap((keys) =>
      keys.entry.horse.abilityNo === undefined ? [] : [[keys.entry.horse.abilityNo, keys] as const],
    ),
  );
  const unregistered = entries.filter((keys) => keys.entry.horse.abilityNo === undefined);
  // 只有可能是自家產駒的列才查父馬名稱對照，免得一千多列各查一次。
  const relevantSires = values
    .filter(
      (item) =>
        (item.abilityNo !== undefined && byAbilityNo.has(item.abilityNo)) ||
        matchesName(item.damName, ourDamKeys),
    )
    .flatMap((item) => (item.sireName === undefined ? [] : [item.sireName]));
  const matcher: Matcher = {
    stallionIds: await matchStallionNames(context.database, gameId, relevantSires),
  };

  const passes: FirstPass[] = values.map((item) => {
    const exact = item.abilityNo === undefined ? undefined : byAbilityNo.get(item.abilityNo);
    if (exact !== undefined) {
      return { values: item, exact, candidates: [] };
    }
    const candidates = unregistered.filter(
      (keys) => damMatches(item, keys) && sireMatches(item, keys, matcher),
    );
    return { values: item, exact: undefined, candidates };
  });

  const claims = new Map<string, number>();
  for (const pass of passes) {
    for (const keys of pass.candidates) {
      const id = keys.entry.foal.id;
      claims.set(id, (claims.get(id) ?? 0) + 1);
    }
  }
  const taken = new Set([
    ...passes.flatMap((pass) => (pass.exact === undefined ? [] : [pass.exact.entry.foal.id])),
    ...claims.keys(),
  ]);
  const foalOfDam = new Map(entries.map((keys) => [keys.entry.foal.damId, keys.entry.foal.id]));
  const concernsUs = (item: Jan2yoValues) =>
    [...dams.entries()].some(([mareId, keys]) => {
      if (!matchesName(item.damName, keys)) {
        return false;
      }
      const foalId = foalOfDam.get(mareId);
      return foalId === undefined || !taken.has(foalId);
    });

  const rows: Jan2yoRow[] = passes.map((pass) => {
    const item = pass.values;
    const base = {
      key: String(item.lineNumber),
      lineNumber: item.lineNumber,
      label: item.fullName ?? `第 ${String(item.lineNumber)} 行`,
      values: item,
      birthYear,
    } as const;
    const review = (issue: PreviewIssue, candidates: readonly FoalKeys[]): Jan2yoRow => ({
      ...base,
      outcome: 'review',
      issues: [issue],
      disposition: 'review',
      target: undefined,
      matchedBy: undefined,
      candidates: candidates.map((keys) => keys.entry),
    });
    const matched = (keys: FoalKeys, matchedBy: JanMatch): Jan2yoRow => {
      const planned = planNaming(item, keys.entry, choice.gameYear);
      return {
        ...base,
        ...planned,
        target: keys.entry,
        matchedBy,
        candidates: [],
      };
    };

    if (pass.exact !== undefined) {
      return parentsConflict(item, pass.exact, matcher)
        ? review(ISSUES.parentMismatch, [pass.exact])
        : matched(pass.exact, 'abilityNo');
    }
    const [only] = pass.candidates;
    if (pass.candidates.length === 1 && only !== undefined) {
      return (claims.get(only.entry.foal.id) ?? 0) > 1
        ? review(ISSUES.sharedCandidate, pass.candidates)
        : matched(only, 'parents');
    }
    if (pass.candidates.length > 1) {
      return review(ISSUES.ambiguous, pass.candidates);
    }
    if (concernsUs(item)) {
      return review(ISSUES.noCandidate, []);
    }
    return {
      ...base,
      outcome: 'skip',
      issues: [],
      disposition: 'unmanaged',
      target: undefined,
      matchedBy: undefined,
      candidates: [],
    };
  });

  const seen = new Set([
    ...rows.flatMap((row) => (row.target === undefined ? [] : [row.target.foal.id])),
    ...rows.flatMap((row) => row.candidates.map((candidate) => candidate.foal.id)),
  ]);
  const unseen = entries
    .filter((keys) => !seen.has(keys.entry.foal.id))
    .map(({ entry }): Jan2yoRow => ({
      key: `foal:${entry.foal.id}`,
      label: entry.label,
      outcome: 'review',
      issues: [ISSUES.unseen],
      disposition: 'unseen',
      values: undefined,
      birthYear,
      target: entry,
      matchedBy: undefined,
      candidates: [],
    }));
  return [...rows, ...unseen];
}

/**
 * 人工確認（需求規格 11.3、JAN-03）：從待核對列的候選中選定一匹產駒後比照唯一配對補名。
 * 同一匹產駒只能給一列，已經被唯一配對的產駒也不能再選。
 */
export function withCandidatesChosen(
  rows: readonly Jan2yoRow[],
  choices: ReadonlyMap<string, string>,
  gameYear: number,
): Jan2yoRow[] {
  const taken = new Set(
    rows.flatMap((row) =>
      row.disposition === 'name' && row.target !== undefined ? [row.target.foal.id] : [],
    ),
  );
  return rows.map((row) => {
    const foalId = choices.get(row.key);
    const target = row.candidates.find((candidate) => candidate.foal.id === foalId);
    if (
      row.disposition !== 'review' ||
      row.values === undefined ||
      target === undefined ||
      taken.has(target.foal.id)
    ) {
      return row;
    }
    const planned = planNaming(row.values, target, gameYear);
    if (planned.disposition !== 'name') {
      return row;
    }
    taken.add(target.foal.id);
    return {
      ...row,
      disposition: 'name',
      // 人工確認的結果要在套用前再確認一次（需求規格 5.2「警告並確認」）。
      outcome: 'warn',
      issues: [ISSUES.confirmed, ...planned.issues],
      target,
      matchedBy: 'confirmed',
    };
  });
}

export function summariseJanRows(rows: readonly Jan2yoRow[]): Jan2yoOverview {
  const count = (disposition: JanDisposition) =>
    rows.filter((row) => row.disposition === disposition).length;
  return {
    birthYear: rows[0]?.birthYear ?? 0,
    fileRows: rows.filter((row) => row.values !== undefined).length,
    name: count('name'),
    replaced: rows.filter(
      (row) => row.disposition === 'name' && row.issues.some((i) => i.code === 'replacesName'),
    ).length,
    unchanged: count('unchanged'),
    review: count('review'),
    conflict: count('conflict'),
    unseen: count('unseen'),
    unmanaged: count('unmanaged'),
    invalid: count('invalid'),
  };
}

interface BuildContext {
  readonly gameYear: number;
  readonly timing: Timing;
  readonly newId: () => string;
  readonly occurredAt: string;
}

/** 這次匯入會寫到的資料表：只有馬匹的名稱、能力番号與馬番号（需求規格 11.2）。 */
export const JAN2YO_COLLECTIONS = ['horses'] as const;

export function buildJan2yo(
  rows: readonly Jan2yoRow[],
  build: BuildContext,
): { readonly records: readonly CollectionRecord[]; readonly events: readonly HistoryEvent[] } {
  const records: CollectionRecord[] = [];
  const events: HistoryEvent[] = [];
  for (const row of rows) {
    const { target, values } = row;
    if (row.disposition !== 'name' || target === undefined || values === undefined) {
      continue;
    }
    const { horse, readOnlyName } = target;
    const next = namedHorse(horse, values, build.gameYear, readOnlyName);
    records.push({ collection: 'horses', record: next });
    if (
      next.officialName !== horse.officialName ||
      next.officialNameSource !== horse.officialNameSource
    ) {
      events.push(
        userEvent(
          { newId: build.newId },
          {
            subjectId: horse.id,
            type: 'horseNamed',
            gameYear: build.gameYear,
            timing: build.timing,
            occurredAt: build.occurredAt,
            before: officialNameValue(horse),
            after: officialNameValue(next),
          },
        ),
      );
    }
  }
  return { records, events };
}

/**
 * 一月二歲馬總表（需求規格 11.3）：替既有產駒補正式馬名，保存競走馬馬番号。
 * 不新增非管理馬匹、不變更持有或售出狀態、不改寫父母與出生年（11.2）。
 */
export function jan2yoImportHandler(): ImportHandler<Jan2yoRow> {
  return {
    type: 'jan2yo',
    collections: [...JAN2YO_COLLECTIONS],
    preview: (context, game, file, choice) =>
      previewJan2yo(context, { gameId: game.id, file, choice }),
    build: ({ rows, choice, newId, occurredAt }) =>
      buildJan2yo(rows, { gameYear: choice.gameYear, timing: choice.timing, newId, occurredAt }),
  };
}
