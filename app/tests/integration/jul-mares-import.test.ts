import { describe, expect, it } from 'vitest';
import type { Breeding } from '../../src/domain/breeding.ts';
import type { Horse } from '../../src/domain/horse.ts';
import type { Line } from '../../src/domain/line.ts';
import type { Mare } from '../../src/domain/mare.ts';
import type { MareYearly } from '../../src/domain/mare-yearly.ts';
import type { StallionDuty } from '../../src/domain/stallion-duty.ts';
import { parseImportFile, type ParsedFile } from '../../src/import/parse.ts';
import type { ServiceContext } from '../../src/services/context.ts';
import { createGame } from '../../src/services/games.ts';
import type { ImportChoice } from '../../src/services/imports.ts';
import {
  previewJulMares,
  summariseJulRows,
  type JulMareRow,
} from '../../src/services/jul-mares-import.ts';
import { horseNameKeys } from '../../src/storage/horses.ts';
import { putRecords } from '../../src/storage/records.ts';
import {
  buildSampleBytes,
  syntheticSample,
  type SyntheticSample,
} from '../../scripts/lib/synthetic-samples.ts';
import { useServiceContexts } from './helpers.ts';

const SAMPLE = syntheticSample('julMares');
const JUL: ImportChoice = { type: 'julMares', gameYear: 1968, timing: { month: 7, week: 1 } };

/** 樣本的三匹母馬：能力番号、據點與由馬齡推出的出生年（匯出年 1968）。 */
const HERD = [
  { id: 'h-1', abilityNo: 0x1001, name: 'テストメス001', birthYear: 1962, site: 32 },
  { id: 'h-2', abilityNo: 0x1002, name: 'テストメス002', birthYear: 1959, site: 33 },
  { id: 'h-3', abilityNo: 0x1003, name: '(外)テストメス003', birthYear: 1964, site: 35 },
] as const;

function parsed(sample: SyntheticSample = SAMPLE): ParsedFile {
  const result = parseImportFile(buildSampleBytes(sample), 'broodmare');
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

function producing(id: string, site: number, group?: Mare['group']): Mare {
  return {
    id,
    group: group ?? { kind: 'substitute', position: 1, generation: 1 },
    origin: 'marketReplenish',
    status: 'producing',
    site: site as Mare['site'],
  };
}

async function seed(
  context: ServiceContext,
  gameId: string,
  collection: 'horses' | 'mares' | 'breedings' | 'mareYearly' | 'lines' | 'stallionDuties',
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

/** 三匹母馬都在圈，據點與檔案一致。 */
async function seedHerd(context: ServiceContext, gameId: string): Promise<void> {
  await seed(
    context,
    gameId,
    'horses',
    HERD.map((mare) =>
      horse({
        id: mare.id,
        abilityNo: mare.abilityNo,
        birthYear: mare.birthYear,
        fullName: mare.name,
      }),
    ),
  );
  await seed(
    context,
    gameId,
    'mares',
    HERD.map((mare) => producing(mare.id, mare.site)),
  );
}

function rowFor(rows: readonly JulMareRow[], name: string): JulMareRow {
  const row = rows.find((item) => item.label === name);
  if (row === undefined) {
    throw new Error(`預覽沒有「${name}」`);
  }
  return row;
}

async function setUp(context: ServiceContext): Promise<string> {
  const game = await createGame(context, { name: '七月匯入局', startYear: 1968 });
  return game.id;
}

function preview(context: ServiceContext, gameId: string, file = parsed()) {
  return previewJulMares(context, { gameId, file, choice: JUL });
}

describe('七月繁殖牝馬總表的預覽（需求規格 11.6）', () => {
  const openContext = useServiceContexts();

  it('[JUL-06] `状態` 出現四種以外的文字時整份停止', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seedHerd(context, gameId);

    await expect(
      preview(context, gameId, parsed(withRow(SAMPLE, 0, { status: '流産' }))),
    ).rejects.toMatchObject({ code: 'importHalted' });
  });

  it('[JUL-01] 依四種狀態統計，受胎與種牡馬列為要保存的正式結果', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seedHerd(context, gameId);

    const rows = await preview(context, gameId);
    const overview = summariseJulRows(rows);
    expect(overview.conceptions).toEqual({ 空胎: 0, 受胎: 2, 不受胎: 1, 未確認: 0 });
    expect(overview.total).toBe(3);
    expect(overview.absent).toBe(0);

    const row = rowFor(rows, 'テストメス001');
    expect(row.conception).toBe('受胎');
    expect(row.stallionName).toBe('テストウマ001');
    expect(row.vitality).toEqual({ state: 'confirmed', value: 62, boosted: false });
  });

  it('[JUL-02] 與五月名單的差異只列出核對，不新增也不移出繁殖牝馬圈', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    // 只有兩匹在圈，另外有一匹五月在圈但七月缺席。
    await seed(context, gameId, 'horses', [
      horse({ id: 'h-1', abilityNo: 0x1001, birthYear: 1962, fullName: 'テストメス001' }),
      horse({ id: 'h-9', abilityNo: 0x1099, birthYear: 1960, fullName: 'テストメス099' }),
    ]);
    await seed(context, gameId, 'mares', [producing('h-1', 32), producing('h-9', 32)]);

    const rows = await preview(context, gameId);
    const overview = summariseJulRows(rows);
    // 檔案有三筆、缺席一筆；兩筆在檔案裡但五月名單沒有 → 待處理。
    expect(overview.total).toBe(4);
    expect(overview.absent).toBe(1);
    expect(overview.unmatched).toBe(2);

    const absent = rowFor(rows, 'テストメス099');
    expect(absent.disposition).toBe('absent');
    expect(absent.outcome).toBe('review');

    const stranger = rowFor(rows, 'テストメス002');
    expect(stranger.disposition).toBe('unmatched');
    expect(stranger.outcome).toBe('review');
    expect(stranger.issues.map((issue) => issue.code)).toContain('identityNew');
  });

  it('[JUL-08] 種牡馬對應不到內部紀錄時自動建立自由配種，名稱照原文保存', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seedHerd(context, gameId);

    const row = rowFor(await preview(context, gameId), 'テストメス001');
    expect(row.disposition).toBe('create');
    expect(row.outcome).toBe('warn');
    expect(row.plan?.breedingType).toBe('free');
    expect(row.stallionId).toBeUndefined();
    expect(row.stallionName).toBe('テストウマ001');
    expect(row.issues.map((issue) => issue.code)).toContain('autoBreeding');
  });

  it('[JUL-07] 種牡馬正是任務指定的現任時自動建立八系指定配種', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seed(context, gameId, 'horses', [
      horse({
        id: 'st-1',
        sex: 'male',
        fullName: 'テストウマ001',
        sireSubsystem: 'ネアルコ',
        stallionListing: { lastSeenYear: 1968 },
      }),
      horse({ id: 'h-1', abilityNo: 0x1001, birthYear: 1962, fullName: 'テストメス001' }),
    ]);
    await seed(context, gameId, 'mares', [
      producing('h-1', 32, { kind: 'starter', position: 1, generation: 0 }),
    ]);
    await seed(context, gameId, 'lines', [
      {
        id: 'line-1',
        position: 1,
        subsystem: 'ネアルコ',
        parentSystem: 'ネアルコ',
        color: '#c62828',
        branch: { targetGeneration: 1, openedYear: 1968 },
        establishedGenerations: [],
      } satisfies Line,
    ]);
    await seed(context, gameId, 'stallionDuties', [
      {
        id: 'd-1',
        position: 1,
        generation: 0,
        horseId: 'st-1',
        role: 'current',
        dutyStatus: 'onDuty',
        startYear: 1968,
      } satisfies StallionDuty,
    ]);

    const row = rowFor(await preview(context, gameId), 'テストメス001');
    expect(row.stallionId).toBe('st-1');
    expect(row.disposition).toBe('create');
    expect(row.plan?.breedingType).toBe('designated');
    expect(row.plan?.ruleSnapshot).toMatchObject({
      sire: { position: 1, generation: 0 },
      target: { position: 1, generation: 1 },
    });
  });

  it('[BRD-03] 七月仍是未確認 → 保留原狀態並警告，不推定結果', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seedHerd(context, gameId);
    await seed(context, gameId, 'breedings', [
      {
        id: 'b-1',
        mareId: 'h-1',
        gameYear: 1968,
        breedingType: 'free',
        stallionName: 'テストウマ001',
        conception: '受胎',
        expectedBirthYear: 1969,
      } satisfies Breeding,
    ]);

    const row = rowFor(
      await preview(context, gameId, parsed(withRow(SAMPLE, 0, { status: '未確認' }))),
      'テストメス001',
    );
    expect(row.conception).toBe('未確認');
    expect(row.outcome).toBe('warn');
    expect(row.issues.map((issue) => issue.code)).toContain('unconfirmed');
  });

  it('[JUL-04] 既有的八系指定配種與實際種牡馬不符 → 列為差異', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seedHerd(context, gameId);
    await seed(context, gameId, 'breedings', [
      {
        id: 'b-1',
        mareId: 'h-1',
        gameYear: 1968,
        breedingType: 'designated',
        stallionId: 'st-planned',
        ruleSnapshot: {
          taskId: 'found:1-0:1-0:1-1',
          phase: 'building',
          kind: 'advance',
          sire: { position: 1, generation: 0 },
          dam: { position: 1, generation: 0 },
          target: { position: 1, generation: 1 },
        },
      } satisfies Breeding,
    ]);

    const row = rowFor(await preview(context, gameId), 'テストメス001');
    expect(row.disposition).toBe('deviate');
    expect(row.outcome).toBe('warn');
    expect(row.issues.map((issue) => issue.code)).toContain('deviated');
  });

  it('[JUL-05] 父母與父系只補空白，不同值為衝突', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seed(context, gameId, 'horses', [
      // 父系空白 → 補上。
      horse({ id: 'h-1', abilityNo: 0x1001, birthYear: 1962, fullName: 'テストメス001' }),
      // 父系與檔案不同 → 衝突。
      horse({
        id: 'h-2',
        abilityNo: 0x1002,
        birthYear: 1959,
        fullName: 'テストメス002',
        sireSubsystem: 'マッチェム',
      }),
    ]);
    await seed(context, gameId, 'mares', [producing('h-1', 32), producing('h-2', 33)]);

    const rows = await preview(context, gameId);
    expect(rowFor(rows, 'テストメス001').fills).toMatchObject({ sireSubsystem: 'エクリプス' });
    const conflict = rowFor(rows, 'テストメス002');
    expect(conflict.disposition).toBe('conflict');
    expect(conflict.outcome).toBe('skip');
    expect(conflict.issues.map((issue) => issue.code)).toContain('bloodConflict');
  });

  it('空胎且沒有既有紀錄時不建立繁殖紀錄，只保存活力快照', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seedHerd(context, gameId);

    const row = rowFor(
      await preview(
        context,
        gameId,
        parsed(withRow(SAMPLE, 1, { status: '空胎', matedStallion: '' })),
      ),
      'テストメス002',
    );
    expect(row.disposition).toBe('vitalityOnly');
    expect(row.outcome).toBe('apply');
  });

  it('[JUL-03] 既有的五月年度資料留著，七月只補活力快照', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seedHerd(context, gameId);
    await seed(context, gameId, 'mareYearly', [
      {
        id: 'y-1',
        horseId: 'h-1',
        gameYear: 1968,
        vitalityMay: { state: 'confirmed', value: 13, boosted: true },
        kodashi: 7,
        breedingYears: 3,
        breedingCount: 2,
      } satisfies MareYearly,
    ]);

    const row = rowFor(await preview(context, gameId), 'テストメス001');
    expect(row.yearly?.id).toBe('y-1');
    expect(row.yearly?.kodashi).toBe(7);
    expect(row.vitality).toEqual({ state: 'confirmed', value: 62, boosted: false });
  });
});
