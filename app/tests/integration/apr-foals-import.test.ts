import { describe, expect, it } from 'vitest';
import type { Breeding } from '../../src/domain/breeding.ts';
import type { Foal } from '../../src/domain/foal.ts';
import type { Horse } from '../../src/domain/horse.ts';
import type { Mare } from '../../src/domain/mare.ts';
import { parseImportFile, type ParsedFile } from '../../src/import/parse.ts';
import {
  aprFoalsImportHandler,
  previewAprFoals,
  summariseAprRows,
  withReviewConfirmed,
  type AprFoalRow,
} from '../../src/services/apr-foals-import.ts';
import type { ServiceContext } from '../../src/services/context.ts';
import { createGame, requireCurrentGame } from '../../src/services/games.ts';
import {
  applyImport,
  prepareImport,
  type ApplyImportOptions,
  type ImportChoice,
} from '../../src/services/imports.ts';
import { listBreedings } from '../../src/storage/breedings.ts';

import { listFoals } from '../../src/storage/foals.ts';
import { getHorse, horseNameKeys } from '../../src/storage/horses.ts';
import { putRecords } from '../../src/storage/records.ts';
import {
  buildSampleBytes,
  syntheticSample,
  type SyntheticSample,
} from '../../scripts/lib/synthetic-samples.ts';
import { useServiceContexts } from './helpers.ts';

const SAMPLE = syntheticSample('aprFoals');
const APR: ImportChoice = { type: 'aprFoals', gameYear: 1968, timing: { month: 4, week: 1 } };

function parsed(sample: SyntheticSample = SAMPLE): ParsedFile {
  const result = parseImportFile(buildSampleBytes(sample), 'aprFoals');
  if (!result.ok) {
    throw new Error(`樣本解析失敗：${result.problems.join('；')}`);
  }
  return result.file;
}

function withRow(
  sample: SyntheticSample,
  index: number,
  changes: Readonly<Record<string, string>>,
): SyntheticSample {
  return {
    ...sample,
    rows: sample.rows.map((row, at) => (at === index ? { ...row, ...changes } : row)),
  };
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

function conceived(id: string, mareId: string, stallionName: string): Breeding {
  return {
    id,
    mareId,
    gameYear: 1967,
    breedingType: 'free',
    stallionName,
    conception: '受胎',
    expectedBirthYear: 1968,
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

/** 兩匹母馬都在管理中，各有 1967 年與檔案父馬相符的受胎紀錄。 */
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

function rowFor(rows: readonly AprFoalRow[], name: string): AprFoalRow {
  const row = rows.find((item) => item.label === name);
  if (row === undefined) {
    throw new Error(`預覽沒有「${name}」`);
  }
  return row;
}

async function setUp(context: ServiceContext): Promise<string> {
  const game = await createGame(context, { name: '四月匯入局', startYear: 1968 });
  return game.id;
}

function preview(context: ServiceContext, gameId: string, file = parsed()) {
  return previewAprFoals(context, { gameId, file, choice: APR });
}

async function runImport(
  context: ServiceContext,
  sample: SyntheticSample = SAMPLE,
  options: ApplyImportOptions = { confirmWarnings: true },
) {
  const handler = aprFoalsImportHandler();
  const prepared = await prepareImport(
    context,
    handler,
    { fileName: sample.fileName, bytes: buildSampleBytes(sample) },
    APR,
  );
  const result = await applyImport(context, handler, prepared, options);
  return { prepared, result };
}

describe('四月誕生幼駒總表（需求規格 11.4）', () => {
  const openContext = useServiceContexts();

  it('[APR-04] 馬主番号、繋養牧場番号、`年` 或 `性` 不符時整份停止', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seedHerd(context, gameId);

    for (const changes of [{ owner: '12' }, { farm: '60' }, { age: '1' }, { sex: 'せ' }]) {
      await expect(
        preview(context, gameId, parsed(withRow(SAMPLE, 0, changes))),
      ).rejects.toMatchObject({ code: 'importHalted' });
    }
  });

  it('[APR-01][APR-06] 63 欄、0 歲，依性別統計；`SP` 與 `サ` 取括號前主值', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seedHerd(context, gameId);

    const file = parsed();
    expect(file.header).toHaveLength(63);

    const rows = await preview(context, gameId, file);
    expect(summariseAprRows(rows)).toMatchObject({ total: 2, create: 2, male: 1, female: 1 });
    const row = rowFor(rows, 'テストメス001の0歳');
    expect(row.values).toMatchObject({ age: 0, sex: 'male', sp: 72, subParamTotal: 72 });
  });

  it('[APR-02][BRD-14] 母馬、父馬與前年受胎唯一相符 → 建立幼駒，追蹤名用出生年，距離適性保存原文', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seedHerd(context, gameId);

    const row = rowFor(await preview(context, gameId), 'テストメス001の0歳');
    expect(row.disposition).toBe('create');
    expect(row.outcome).toBe('apply');
    expect(row.damId).toBe('d-1');
    expect(row.breeding?.id).toBe('b-1');
    // 追蹤名是母馬名加完整出生年（需求規格 9.4）；檔案的「母馬名の0歳」不是正式馬名也不是追蹤名。
    expect(row.plan?.preview?.trackingName).toBe('テストメス0011968');
    expect(row.values?.distanceText).toBe('中距離');
  });

  it('[APR-03] 母馬不在管理資料 → 待核對；確認後比照自由配種產駒建立', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    // 只有第二匹母馬在管理中。
    await seed(context, gameId, 'horses', [horse({ id: 'd-2', fullName: 'テストメス002' })]);
    await seed(context, gameId, 'mares', [producing('d-2')]);
    await seed(context, gameId, 'breedings', [conceived('b-2', 'd-2', '(外)テストウマ002')]);

    const rows = await preview(context, gameId);
    const row = rowFor(rows, 'テストメス001の0歳');
    expect(row.disposition).toBe('review');
    expect(row.outcome).toBe('review');
    expect(row.confirmable).toBe(false);
    expect(row.issues.map((issue) => issue.code)).toContain('damNotFound');
  });

  it('[APR-03] 沒有相符受胎紀錄 → 待核對；確認後建立並連結母馬', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seed(context, gameId, 'horses', [horse({ id: 'd-1', fullName: 'テストメス001' })]);
    await seed(context, gameId, 'mares', [producing('d-1')]);

    const rows = await preview(context, gameId);
    const row = rowFor(rows, 'テストメス001の0歳');
    expect(row.disposition).toBe('review');
    expect(row.confirmable).toBe(true);
    expect(row.issues.map((issue) => issue.code)).toContain('noConception');

    const game = await requireCurrentGame(context);
    const confirmed = withReviewConfirmed(rows, new Set([row.key]), game);
    const after = rowFor(confirmed, 'テストメス001の0歳');
    expect(after.disposition).toBe('confirmed');
    expect(after.outcome).toBe('warn');
    // 比照自由配種產駒：沒有系與代數，處置為待售（需求規格 9.5、APR-03、APR-08）。
    expect(after.plan?.preview?.freeBred).toBe(true);
    expect(after.plan?.preview?.lineage).toBeUndefined();
    expect(after.plan?.disposition).toBe('forSale');
  });

  it('[APR-05] 前年受胎但檔案沒有對應幼駒 → 未見產駒，不改受胎結果', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seedHerd(context, gameId);
    await seed(context, gameId, 'horses', [horse({ id: 'd-9', fullName: 'テストメス099' })]);
    await seed(context, gameId, 'mares', [producing('d-9')]);
    await seed(context, gameId, 'breedings', [conceived('b-9', 'd-9', 'テストウマ001')]);

    const rows = await preview(context, gameId);
    expect(summariseAprRows(rows).missing).toBe(1);
    const row = rowFor(rows, 'テストメス099');
    expect(row.disposition).toBe('missing');
    expect(row.outcome).toBe('review');
    expect(row.confirmable).toBe(false);

    // 套用後那筆受胎紀錄原封不動。
    await runImport(context);
    const untouched = (await listBreedings(context.database, gameId)).find(
      (item) => item.id === 'b-9',
    );
    expect(untouched?.conception).toBe('受胎');
    expect(untouched?.foalId).toBeUndefined();
  });

  it('[APR-07] 同母同年已有手動產駒 → 補齊空白，不建立第二匹', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seedHerd(context, gameId);
    await seed(context, gameId, 'horses', [
      horse({ id: 'f-1', sex: 'male', birthYear: 1968, damId: 'd-1' }),
    ]);
    await seed(context, gameId, 'foals', [
      {
        id: 'f-1',
        damId: 'd-1',
        birthYear: 1968,
        freeBred: false,
        disposition: 'keep',
        lineage: { position: 1, generation: 2 },
      } satisfies Foal,
    ]);

    const row = rowFor(await preview(context, gameId), 'テストメス001の0歳');
    expect(row.disposition).toBe('fill');
    expect(row.existing?.id).toBe('f-1');

    await runImport(context);
    const foals = await listFoals(context.database, gameId);
    expect(foals.filter((foal) => foal.damId === 'd-1')).toHaveLength(1);
    // 空白的能力欄位補上，既有的處置與系不動。
    expect(foals.find((foal) => foal.id === 'f-1')).toMatchObject({
      sp: 72,
      st: 68,
      kodashi: 7,
      distanceText: '中距離',
      disposition: 'keep',
      lineage: { position: 1, generation: 2 },
    });
    expect(await getHorse(context.database, gameId, 'f-1')).toMatchObject({
      abilityNo: 0x3001,
      stageNumbers: [{ stage: 'foal', number: 0x4001, gameYear: 1968, source: 'aprFoals' }],
    });
  });

  it('[BRD-11] `サ` 與七項副能力換算不符時警告，仍照檔案保存', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seedHerd(context, gameId);

    const row = rowFor(
      await preview(context, gameId, parsed(withRow(SAMPLE, 0, { subParamTotal: '99' }))),
      'テストメス001の0歳',
    );
    expect(row.subParamMismatch).toBe(true);
    expect(row.outcome).toBe('warn');
    expect(row.issues.map((issue) => issue.code)).toContain('subParamMismatch');
  });

  it('[APR-02] 套用後建立馬匹與產駒並連回繁殖紀錄，保存幼駒馬番号與能力', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seedHerd(context, gameId);

    const { result } = await runImport(context);
    expect(result.appliedRows).toBe(2);

    const foals = await listFoals(context.database, gameId);
    expect(foals).toHaveLength(2);
    const foal = foals.find((item) => item.damId === 'd-1');
    expect(foal).toMatchObject({
      birthYear: 1968,
      freeBred: true,
      sp: 72,
      st: 68,
      distanceText: '中距離',
    });
    expect(await getHorse(context.database, gameId, foal?.id ?? '')).toMatchObject({
      sex: 'male',
      birthYear: 1968,
      damId: 'd-1',
      abilityNo: 0x3001,
      sireName: 'テストウマ001',
      stageNumbers: [{ stage: 'foal', number: 0x4001, gameYear: 1968, source: 'aprFoals' }],
    });
    // 連回前一年的繁殖紀錄（需求規格 11.4）。
    expect(
      (await listBreedings(context.database, gameId)).find((item) => item.id === 'b-1')?.foalId,
    ).toBe(foal?.id);
  });

  it('[APR-08] 自由配種幼駒自動待售、不可成為後繼', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seed(context, gameId, 'horses', [horse({ id: 'd-1', fullName: 'テストメス001' })]);
    await seed(context, gameId, 'mares', [producing('d-1')]);
    await seed(context, gameId, 'breedings', [
      { ...conceived('b-1', 'd-1', 'テストウマ001'), breedingType: 'free' } satisfies Breeding,
    ]);

    await runImport(context);
    const foal = (await listFoals(context.database, gameId)).find((item) => item.damId === 'd-1');
    expect(foal).toMatchObject({ freeBred: true, disposition: 'forSale' });
    expect(foal?.lineage).toBeUndefined();
  });
});
