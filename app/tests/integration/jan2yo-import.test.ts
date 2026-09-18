import { describe, expect, it } from 'vitest';
import type { Breeding } from '../../src/domain/breeding.ts';
import type { Foal } from '../../src/domain/foal.ts';
import type { Horse } from '../../src/domain/horse.ts';
import type { Mare } from '../../src/domain/mare.ts';
import { parseImportFile, type ParsedFile } from '../../src/import/parse.ts';
import { aprFoalsImportHandler } from '../../src/services/apr-foals-import.ts';
import type { ServiceContext } from '../../src/services/context.ts';
import { nameFoal } from '../../src/services/foals.ts';
import { createGame } from '../../src/services/games.ts';
import {
  applyImport,
  prepareImport,
  type ApplyImportOptions,
  type ImportChoice,
} from '../../src/services/imports.ts';
import {
  jan2yoImportHandler,
  previewJan2yo,
  summariseJanRows,
  withCandidatesChosen,
  type Jan2yoRow,
} from '../../src/services/jan2yo-import.ts';
import { mayMaresImportHandler } from '../../src/services/may-mares-import.ts';
import { listEventsForSubject } from '../../src/storage/events.ts';
import { listFoals } from '../../src/storage/foals.ts';
import { getHorse, horseNameKeys, listHorses } from '../../src/storage/horses.ts';
import { putRecords } from '../../src/storage/records.ts';
import {
  buildSampleBytes,
  syntheticSample,
  type SyntheticSample,
} from '../../scripts/lib/synthetic-samples.ts';
import { useServiceContexts } from './helpers.ts';

const SAMPLE = syntheticSample('jan2yo');
const JAN: ImportChoice = { type: 'jan2yo', gameYear: 1970, timing: { month: 1, week: 1 } };
const APR: ImportChoice = { type: 'aprFoals', gameYear: 1968, timing: { month: 4, week: 1 } };
const APPLY: ApplyImportOptions = { confirmAdvanceYear: true, confirmWarnings: true };

function parsed(sample: SyntheticSample = SAMPLE): ParsedFile {
  const result = parseImportFile(buildSampleBytes(sample), 'jan2yo');
  if (!result.ok) {
    throw new Error(`樣本解析失敗：${result.problems.join('；')}`);
  }
  return result.file;
}

function withRows(
  sample: SyntheticSample,
  rows: readonly Readonly<Record<string, string>>[],
): SyntheticSample {
  return { ...sample, rows };
}

function row(index: number, changes: Readonly<Record<string, string>> = {}) {
  const base = SAMPLE.rows[index];
  if (base === undefined) {
    throw new Error(`樣本沒有第 ${String(index)} 列`);
  }
  return { ...base, ...changes };
}

function horse(overrides: Partial<Horse> & Pick<Horse, 'id'>): Horse {
  return { sex: 'female', stageNumbers: [], aliases: [], ...overrides };
}

function producing(id: string): Mare {
  return {
    id,
    group: { kind: 'substitute', position: 1, generation: 1 },
    origin: 'marketReplenish',
    status: 'producing',
    site: 32,
  };
}

function conceived(id: string, mareId: string, stallionName: string, gameYear = 1967): Breeding {
  return {
    id,
    mareId,
    gameYear,
    breedingType: 'free',
    stallionName,
    conception: '受胎',
    expectedBirthYear: gameYear + 1,
  };
}

async function seed(
  context: ServiceContext,
  gameId: string,
  collection: 'horses' | 'mares' | 'breedings' | 'foals',
  records: readonly object[],
): Promise<void> {
  await putRecords(
    context.database,
    gameId,
    collection,
    records.map((record) =>
      collection === 'horses'
        ? { ...record, nameKeys: horseNameKeys(gameId, record) }
        : { ...record },
    ),
  );
}

/** 兩匹管理中的母馬，各有 1967 年與四月樣本父馬相符的受胎紀錄。 */
async function seedHerd(context: ServiceContext, gameId: string): Promise<void> {
  await seed(context, gameId, 'horses', [
    horse({ id: 'd-1', fullName: 'テストメス001' }),
    horse({ id: 'd-2', fullName: 'テストメス002' }),
  ]);
  await seed(context, gameId, 'mares', [producing('d-1'), producing('d-2')]);
  await seed(context, gameId, 'breedings', [
    conceived('b-1', 'd-1', 'テストウマ001'),
    conceived('b-2', 'd-2', '(外)テストウマ002'),
  ]);
}

/** 手動登記、未填能力番号的舊產駒（自由配種，免得需要系與代數）。 */
async function seedFoal(
  context: ServiceContext,
  gameId: string,
  input: {
    readonly id: string;
    readonly damId: string;
    readonly birthYear: number;
    readonly sireName: string;
    readonly sex?: Horse['sex'];
    readonly officialName?: string;
    readonly disposition?: Foal['disposition'];
  },
): Promise<void> {
  await seed(context, gameId, 'horses', [
    horse({
      id: input.id,
      sex: input.sex ?? 'male',
      birthYear: input.birthYear,
      damId: input.damId,
      sireName: input.sireName,
      ...(input.officialName === undefined ? {} : { officialName: input.officialName }),
    }),
  ]);
  await seed(context, gameId, 'foals', [
    {
      id: input.id,
      damId: input.damId,
      birthYear: input.birthYear,
      freeBred: true,
      disposition: input.disposition ?? 'forSale',
    } satisfies Foal,
  ]);
}

async function setUp(context: ServiceContext): Promise<string> {
  const game = await createGame(context, { name: '一月匯入局', startYear: 1968 });
  await seedHerd(context, game.id);
  return game.id;
}

/** 以四月樣本建立 1968 年出生的兩匹產駒（能力番号 0x3001、0x3002）。 */
async function importApril(context: ServiceContext): Promise<void> {
  const sample = syntheticSample('aprFoals');
  const handler = aprFoalsImportHandler();
  const prepared = await prepareImport(
    context,
    handler,
    { fileName: sample.fileName, bytes: buildSampleBytes(sample) },
    APR,
  );
  await applyImport(context, handler, prepared, { confirmWarnings: true });
}

async function foalIdByAbilityNo(
  context: ServiceContext,
  gameId: string,
  abilityNo: number,
): Promise<string> {
  const found = (await listHorses(context.database, gameId)).find(
    (item) => item.abilityNo === abilityNo,
  );
  if (found === undefined) {
    throw new Error(`沒有能力番号 ${String(abilityNo)} 的馬`);
  }
  return found.id;
}

function preview(context: ServiceContext, gameId: string, file = parsed()) {
  return previewJan2yo(context, { gameId, file, choice: JAN });
}

async function runJan(
  context: ServiceContext,
  sample: SyntheticSample = SAMPLE,
  options: ApplyImportOptions = APPLY,
  choices: ReadonlyMap<string, string> = new Map(),
) {
  const handler = jan2yoImportHandler();
  const prepared = await prepareImport(
    context,
    handler,
    { fileName: sample.fileName, bytes: buildSampleBytes(sample) },
    JAN,
  );
  const rows = withCandidatesChosen(prepared.rows, choices, JAN.gameYear);
  return applyImport(context, handler, { ...prepared, rows }, options);
}

function rowFor(rows: readonly Jan2yoRow[], label: string): Jan2yoRow {
  const found = rows.find((item) => item.label === label);
  if (found === undefined) {
    throw new Error(`預覽沒有「${label}」`);
  }
  return found;
}

async function requireHorse(context: ServiceContext, gameId: string, id: string): Promise<Horse> {
  const found = await getHorse(context.database, gameId, id);
  if (found === undefined) {
    throw new Error(`找不到馬匹 ${id}`);
  }
  return found;
}

describe('一月二歲馬總表的匯入（需求規格 11.3）', () => {
  const open = useServiceContexts();

  it('[JAN-01] 以 CP932 讀取 78 欄，出生年為匯出年減 2', async () => {
    const context = await open();
    const gameId = await setUp(context);
    const file = parsed();
    expect(file.encoding).toBe('cp932');
    expect(file.header).toHaveLength(78);
    const rows = await preview(context, gameId, file);
    expect(rows.filter((item) => item.values !== undefined)).toHaveLength(SAMPLE.rows.length);
    expect(new Set(rows.map((item) => item.birthYear))).toEqual(new Set([1968]));
    expect(summariseJanRows(rows).birthYear).toBe(1968);
  });

  it('[JAN-02] 非管理的二歲馬不建立，也不出現在管理清單', async () => {
    const context = await open();
    const gameId = await setUp(context);
    await importApril(context);
    const before = await listHorses(context.database, gameId);
    const rows = await preview(context, gameId);
    const other = rowFor(rows, '[地]テストウマ011');
    expect(other.disposition).toBe('unmanaged');
    expect(other.outcome).toBe('skip');
    expect(other.issues).toEqual([]);

    await runJan(context);
    const after = await listHorses(context.database, gameId);
    expect(after).toHaveLength(before.length);
    expect(after.some((item) => item.abilityNo === 0x3003)).toBe(false);
    expect(after.flatMap((item) => [item.fullName, item.officialName])).not.toContain(
      '[地]テストウマ011',
    );
  });

  it('[JAN-05] 配對成功 → 補正式馬名，保存競走馬馬番号，幼駒馬番号留在歷程', async () => {
    const context = await open();
    const gameId = await setUp(context);
    await importApril(context);
    const colt = await foalIdByAbilityNo(context, gameId, 0x3001);
    const rows = await preview(context, gameId);
    const named = rowFor(rows, 'テストウマ010');
    expect(named.disposition).toBe('name');
    expect(named.matchedBy).toBe('abilityNo');
    expect(named.outcome).toBe('apply');

    const result = await runJan(context);
    expect(result.advancedToYear).toBe(1970);
    const stored = await requireHorse(context, gameId, colt);
    expect(stored.officialName).toBe('テストウマ010');
    expect(stored.officialNameSource).toBe('jan2yo');
    expect(stored.baseName).toBe('テストウマ010');
    expect(stored.stageNumbers).toEqual([
      { stage: 'foal', number: 0x4001, gameYear: 1968, source: 'aprFoals' },
      { stage: 'racehorse', number: 0x7001, gameYear: 1970, source: 'jan2yo' },
    ]);
    const events = await listEventsForSubject(context.database, gameId, colt);
    expect(events.filter((event) => event.type === 'horseNamed')).toEqual([
      expect.objectContaining({
        gameYear: 1970,
        timing: { month: 1, week: 1 },
        before: {},
        after: { officialName: 'テストウマ010', officialNameSource: 'jan2yo' },
      }),
    ]);
  });

  it('[JAN-05] 只改名稱與番号：持有、售出、父母與出生年不變（需求規格 11.2）', async () => {
    const context = await open();
    const gameId = await setUp(context);
    await importApril(context);
    const filly = await foalIdByAbilityNo(context, gameId, 0x3002);
    const beforeHorse = await requireHorse(context, gameId, filly);
    const beforeFoals = await listFoals(context.database, gameId);

    await runJan(context);
    const afterHorse = await requireHorse(context, gameId, filly);
    expect(afterHorse.sex).toBe(beforeHorse.sex);
    expect(afterHorse.birthYear).toBe(beforeHorse.birthYear);
    expect(afterHorse.sireId).toBe(beforeHorse.sireId);
    expect(afterHorse.sireName).toBe(beforeHorse.sireName);
    expect(afterHorse.damId).toBe(beforeHorse.damId);
    expect(await listFoals(context.database, gameId)).toEqual(beforeFoals);
  });

  it('再匯入同一份內容的更正檔：已是最新的列略過，不重複記錄馬番号', async () => {
    const context = await open();
    const gameId = await setUp(context);
    await importApril(context);
    await runJan(context);
    const rows = await preview(context, gameId);
    expect(rowFor(rows, 'テストウマ010').disposition).toBe('unchanged');
    expect(rowFor(rows, 'テストウマ010').outcome).toBe('skip');
  });

  it('[JAN-03] 能力番号未登記的舊產駒 → 以父馬、母馬、出生年唯一配對並補入能力番号', async () => {
    const context = await open();
    const gameId = await setUp(context);
    await seedFoal(context, gameId, {
      id: 'f-old',
      damId: 'd-1',
      birthYear: 1968,
      sireName: 'テストウマ001',
    });
    const rows = await preview(context, gameId);
    const matched = rowFor(rows, 'テストウマ010');
    expect(matched.disposition).toBe('name');
    expect(matched.matchedBy).toBe('parents');

    await runJan(context);
    const stored = await requireHorse(context, gameId, 'f-old');
    expect(stored.abilityNo).toBe(0x3001);
    expect(stored.officialName).toBe('テストウマ010');
  });

  it('[JAN-03] 父母與出生年相符的候選有多筆 → 人工確認，選定後才補名', async () => {
    const context = await open();
    const gameId = await setUp(context);
    // 兩匹同名的母馬各有一匹同父、同年的產駒：總表那一列無法唯一配對。
    await seed(context, gameId, 'horses', [horse({ id: 'd-9', fullName: 'テストメス001' })]);
    await seed(context, gameId, 'mares', [producing('d-9')]);
    await seedFoal(context, gameId, {
      id: 'f-a',
      damId: 'd-1',
      birthYear: 1968,
      sireName: 'テストウマ001',
    });
    await seedFoal(context, gameId, {
      id: 'f-b',
      damId: 'd-9',
      birthYear: 1968,
      sireName: 'テストウマ001',
    });
    const rows = await preview(context, gameId);
    const pending = rowFor(rows, 'テストウマ010');
    expect(pending.disposition).toBe('review');
    expect(pending.issues.map((issue) => issue.code)).toEqual(['ambiguousFoals']);
    expect(pending.candidates.map((item) => item.foal.id).sort()).toEqual(['f-a', 'f-b']);

    // 沒選就不寫入。
    await runJan(context, withRows(SAMPLE, [row(0)]));
    expect((await requireHorse(context, gameId, 'f-a')).officialName).toBeUndefined();
    expect((await requireHorse(context, gameId, 'f-b')).officialName).toBeUndefined();
  });

  it('[JAN-03] 人工確認選定的候選 → 警告列，確認後補名；同一匹不能給兩列', async () => {
    const context = await open();
    const gameId = await setUp(context);
    await seed(context, gameId, 'horses', [horse({ id: 'd-9', fullName: 'テストメス001' })]);
    await seed(context, gameId, 'mares', [producing('d-9')]);
    await seedFoal(context, gameId, {
      id: 'f-a',
      damId: 'd-1',
      birthYear: 1968,
      sireName: 'テストウマ001',
    });
    await seedFoal(context, gameId, {
      id: 'f-b',
      damId: 'd-9',
      birthYear: 1968,
      sireName: 'テストウマ001',
    });
    const rows = await preview(context, gameId);
    const key = rowFor(rows, 'テストウマ010').key;
    const chosen = withCandidatesChosen(rows, new Map([[key, 'f-b']]), 1970);
    const confirmed = rowFor(chosen, 'テストウマ010');
    expect(confirmed.disposition).toBe('name');
    expect(confirmed.outcome).toBe('warn');
    expect(confirmed.matchedBy).toBe('confirmed');

    await expect(
      runJan(context, SAMPLE, { confirmAdvanceYear: true }, new Map([[key, 'f-b']])),
    ).rejects.toThrow('警告');
    await runJan(context, SAMPLE, APPLY, new Map([[key, 'f-b']]));
    expect((await requireHorse(context, gameId, 'f-b')).officialName).toBe('テストウマ010');
    expect((await requireHorse(context, gameId, 'f-a')).officialName).toBeUndefined();
  });

  it('[JAN-03] 兩列都對到同一匹舊產駒 → 都不算唯一，列入人工確認', async () => {
    const context = await open();
    const gameId = await setUp(context);
    await seedFoal(context, gameId, {
      id: 'f-old',
      damId: 'd-1',
      birthYear: 1968,
      sireName: 'テストウマ001',
    });
    const twin = row(0, {
      name: 'テストウマ012',
      baseName: 'テストウマ012',
      abilityNo: '0x3010',
      horseNo: '0x7010',
    });
    const rows = await preview(context, gameId, parsed(withRows(SAMPLE, [row(0), twin])));
    expect(rowFor(rows, 'テストウマ010').issues.map((issue) => issue.code)).toEqual([
      'sharedCandidate',
    ]);
    expect(rowFor(rows, 'テストウマ012').disposition).toBe('review');
  });

  it('[JAN-03] 母馬是這一局的繁殖牝馬但找不到相符的產駒 → 零筆候選，人工確認', async () => {
    const context = await open();
    const gameId = await setUp(context);
    // 父馬不同：母馬、出生年相符也不配對。
    await seedFoal(context, gameId, {
      id: 'f-old',
      damId: 'd-1',
      birthYear: 1968,
      sireName: 'テストウマ999',
    });
    const rows = await preview(context, gameId);
    const pending = rowFor(rows, 'テストウマ010');
    expect(pending.disposition).toBe('review');
    expect(pending.issues.map((issue) => issue.code)).toEqual(['noCandidate']);
    expect(pending.candidates).toEqual([]);
    // 產駒本身沒有被任何一列對到，另外列出來。
    const unseen = rows.find((item) => item.key === 'foal:f-old');
    expect(unseen?.disposition).toBe('unseen');
  });

  it('[JAN-04] 同父同母但不同出生年的產駒 → 不會互相填錯名稱', async () => {
    const context = await open();
    const gameId = await setUp(context);
    await seedFoal(context, gameId, {
      id: 'f-1967',
      damId: 'd-1',
      birthYear: 1967,
      sireName: 'テストウマ001',
    });
    await seedFoal(context, gameId, {
      id: 'f-1968',
      damId: 'd-1',
      birthYear: 1968,
      sireName: 'テストウマ001',
    });
    await runJan(context);
    expect((await requireHorse(context, gameId, 'f-1968')).officialName).toBe('テストウマ010');
    const older = await requireHorse(context, gameId, 'f-1967');
    expect(older.officialName).toBeUndefined();
    expect(older.abilityNo).toBeUndefined();
  });

  it('[JAN-06] 第 77 欄基本馬名依位置讀取，不因與第 1 欄同名而讀錯', async () => {
    const context = await open();
    const gameId = await setUp(context);
    await importApril(context);
    const colt = await foalIdByAbilityNo(context, gameId, 0x3001);
    const sample = withRows(SAMPLE, [
      row(0, { name: '(外)テストウマ010', baseName: 'テストウマ010基本' }),
    ]);
    const rows = await preview(context, gameId, parsed(sample));
    expect(rows[0]?.values?.fullName).toBe('(外)テストウマ010');
    expect(rows[0]?.values?.baseName).toBe('テストウマ010基本');
    await runJan(context, sample);
    const stored = await requireHorse(context, gameId, colt);
    expect(stored.officialName).toBe('(外)テストウマ010');
    expect(stored.baseName).toBe('テストウマ010基本');
  });

  it('[JAN-07] 史実番号 0x7FFF 不作為識別', async () => {
    const context = await open();
    const gameId = await setUp(context);
    await importApril(context);
    // 全部列的史実番号都是 0x7FFF 也不算重複；史実番号碰巧等於產駒的能力番号也不配對。
    const sample = withRows(SAMPLE, [
      row(0, {
        abilityNo: '0x3999',
        historicalNo: '0x3001',
        dam: 'テストメス905',
        sire: 'テストウマ905',
      }),
      row(1),
      row(2),
    ]);
    const rows = await preview(context, gameId, parsed(sample));
    expect(rows.find((item) => item.lineNumber === 2)?.disposition).toBe('unmanaged');
    expect(rowFor(rows, 'テストメス010').disposition).toBe('name');
  });

  it('[ID-06] 同一份一月總表內能力番号重複 → 整份停止', async () => {
    const context = await open();
    const gameId = await setUp(context);
    const sample = withRows(SAMPLE, [row(0), row(1, { abilityNo: '0x3001' })]);
    await expect(preview(context, gameId, parsed(sample))).rejects.toThrow('0x3001');
  });

  it('`年` 不是 2 的列 → 整份停止', async () => {
    const context = await open();
    const gameId = await setUp(context);
    const sample = withRows(SAMPLE, [row(0, { age: '3' })]);
    await expect(preview(context, gameId, parsed(sample))).rejects.toThrow('不是 2');
  });

  it('[BRD-09] 一月總表唯一配對的名稱取代手動名稱，手動名稱保留為別名與歷程', async () => {
    const context = await open();
    const gameId = await setUp(context);
    await seedFoal(context, gameId, {
      id: 'f-old',
      damId: 'd-1',
      birthYear: 1968,
      sireName: 'テストウマ001',
      officialName: 'テスト手動名',
    });
    const rows = await preview(context, gameId);
    expect(rowFor(rows, 'テストウマ010').issues.map((issue) => issue.code)).toEqual([
      'replacesName',
    ]);
    await runJan(context);
    const stored = await requireHorse(context, gameId, 'f-old');
    expect(stored.officialName).toBe('テストウマ010');
    expect(stored.aliases).toEqual([{ kind: 'manual', name: 'テスト手動名', gameYear: 1970 }]);
    const events = await listEventsForSubject(context.database, gameId, 'f-old');
    expect(events.find((event) => event.type === 'horseNamed')).toMatchObject({
      before: { officialName: 'テスト手動名' },
      after: { officialName: 'テストウマ010', officialNameSource: 'jan2yo' },
    });
  });

  it('總表的名稱手動改掉後，總表名稱留為匯入別名；清空時回退追蹤名（BRD-10）', async () => {
    const context = await open();
    const gameId = await setUp(context);
    await importApril(context);
    const colt = await foalIdByAbilityNo(context, gameId, 0x3001);
    await runJan(context);

    const renamed = await nameFoal(context, { foalId: colt, officialName: 'テスト改名' });
    expect(renamed.officialNameSource).toBeUndefined();
    expect(renamed.aliases).toEqual([{ kind: 'imported', name: 'テストウマ010', gameYear: 1970 }]);

    const other = await foalIdByAbilityNo(context, gameId, 0x3002);
    const cleared = await nameFoal(context, { foalId: other, officialName: '' });
    expect(cleared.officialName).toBeUndefined();
    expect(cleared.baseName).toBeUndefined();
    expect(cleared.officialNameSource).toBeUndefined();
  });

  it('[STL-12] 一月的父馬唯一對應到種牡馬紀錄 → 以內部識別比對；外部名稱照樣比對，父母不改寫', async () => {
    const context = await open();
    const gameId = await setUp(context);
    await seed(context, gameId, 'horses', [
      horse({
        id: 's-1',
        sex: 'male',
        fullName: 'テストウマ001',
        stallionListing: { lastSeenYear: 1969 },
      }),
    ]);
    await seed(context, gameId, 'horses', [
      horse({ id: 'f-int', sex: 'male', birthYear: 1968, damId: 'd-1', sireId: 's-1' }),
      horse({
        id: 'f-ext',
        sex: 'female',
        birthYear: 1968,
        damId: 'd-2',
        sireName: '(外)テストウマ002',
      }),
    ]);
    await seed(context, gameId, 'foals', [
      { id: 'f-int', damId: 'd-1', birthYear: 1968, freeBred: true, disposition: 'forSale' },
      { id: 'f-ext', damId: 'd-2', birthYear: 1968, freeBred: true, disposition: 'forSale' },
    ]);
    const rows = await preview(context, gameId);
    expect(rowFor(rows, 'テストウマ010')).toMatchObject({
      disposition: 'name',
      matchedBy: 'parents',
    });
    expect(rowFor(rows, 'テストメス010')).toMatchObject({
      disposition: 'name',
      matchedBy: 'parents',
    });

    await runJan(context);
    const internal = await requireHorse(context, gameId, 'f-int');
    expect(internal.sireId).toBe('s-1');
    expect(internal.sireName).toBeUndefined();
    const external = await requireHorse(context, gameId, 'f-ext');
    expect(external.sireId).toBeUndefined();
    expect(external.sireName).toBe('(外)テストウマ002');
  });

  it('能力番号相符但父母明顯不符 → 衝突，交給使用者確認（需求規格 6.2）', async () => {
    const context = await open();
    const gameId = await setUp(context);
    await importApril(context);
    const sample = withRows(SAMPLE, [row(0, { dam: 'テストメス777' })]);
    const rows = await preview(context, gameId, parsed(sample));
    const pending = rowFor(rows, 'テストウマ010');
    expect(pending.disposition).toBe('review');
    expect(pending.issues.map((issue) => issue.code)).toEqual(['parentMismatch']);
    expect(pending.candidates).toHaveLength(1);
  });

  it('[ID-01] 同一匹馬依序出現在四月、一月、五月總表 → 只有一筆馬匹，歷程有三個階段的馬番号', async () => {
    const context = await open();
    const gameId = await setUp(context);
    await importApril(context);
    await runJan(context);
    const filly = await foalIdByAbilityNo(context, gameId, 0x3002);

    const may = syntheticSample('mayMares');
    const herd = may.rows.slice(0, 2);
    const mayFile: SyntheticSample = {
      ...may,
      fileName: '1971年 5月1週_繁殖牝馬.txt',
      rows: [
        ...herd,
        {
          ...herd[1],
          name: 'テストメス010',
          baseName: 'テストメス010',
          age: '3',
          farm: '32',
          sire: '(外)テストウマ002',
          dam: 'テストメス002',
          abilityNo: '0x3002',
          horseNo: '0x8001',
          breedingYears: '0',
          breedingCount: '0',
        },
      ],
    };
    const handler = mayMaresImportHandler();
    const prepared = await prepareImport(
      context,
      handler,
      { fileName: mayFile.fileName, bytes: buildSampleBytes(mayFile) },
      { type: 'mayMares', gameYear: 1971, timing: { month: 5, week: 1 } },
    );
    await applyImport(context, handler, prepared, APPLY);

    const same = (await listHorses(context.database, gameId)).filter(
      (item) => item.abilityNo === 0x3002 && item.birthYear === 1968,
    );
    expect(same.map((item) => item.id)).toEqual([filly]);
    expect(same[0]?.stageNumbers.map((item) => [item.stage, item.number])).toEqual([
      ['foal', 0x4002],
      ['racehorse', 0x7002],
      ['broodmare', 0x8001],
    ]);
  });
});
