import { describe, expect, it } from 'vitest';
import type { Breeding } from '../../src/domain/breeding.ts';
import type { Horse } from '../../src/domain/horse.ts';
import type { Mare } from '../../src/domain/mare.ts';
import type { MareYearly } from '../../src/domain/mare-yearly.ts';
import type { ServiceContext } from '../../src/services/context.ts';
import { createGame } from '../../src/services/games.ts';
import {
  applyImport,
  prepareImport,
  type ApplyImportOptions,
  type ImportChoice,
} from '../../src/services/imports.ts';
import { julMaresImportHandler } from '../../src/services/jul-mares-import.ts';
import { listBreedings } from '../../src/storage/breedings.ts';
import { listEventsForSubject } from '../../src/storage/events.ts';
import { getHorse, horseNameKeys } from '../../src/storage/horses.ts';
import { listMareYearly } from '../../src/storage/mare-yearly.ts';
import { getMare } from '../../src/storage/mares.ts';
import { putRecords } from '../../src/storage/records.ts';
import {
  buildSampleBytes,
  syntheticSample,
  type SyntheticSample,
} from '../../scripts/lib/synthetic-samples.ts';
import { useServiceContexts } from './helpers.ts';

const SAMPLE = syntheticSample('julMares');
const JUL: ImportChoice = { type: 'julMares', gameYear: 1968, timing: { month: 7, week: 1 } };

const HERD = [
  { id: 'h-1', abilityNo: 0x1001, name: 'テストメス001', birthYear: 1962, site: 32 },
  { id: 'h-2', abilityNo: 0x1002, name: 'テストメス002', birthYear: 1959, site: 33 },
  { id: 'h-3', abilityNo: 0x1003, name: '(外)テストメス003', birthYear: 1964, site: 35 },
] as const;

function horse(overrides: Partial<Horse> & Pick<Horse, 'id'>): Horse {
  return { sex: 'female', stageNumbers: [], aliases: [], ...overrides };
}

function producing(id: string, site: number): Mare {
  return {
    id,
    group: { kind: 'substitute', position: 1, generation: 1 },
    origin: 'marketReplenish',
    status: 'producing',
    site: site as Mare['site'],
  };
}

async function seed(
  context: ServiceContext,
  gameId: string,
  collection: 'horses' | 'mares' | 'breedings' | 'mareYearly',
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

async function setUp(context: ServiceContext): Promise<string> {
  const game = await createGame(context, { name: '七月套用局', startYear: 1968 });
  return game.id;
}

async function runImport(
  context: ServiceContext,
  sample: SyntheticSample = SAMPLE,
  options: ApplyImportOptions = { confirmWarnings: true },
) {
  const handler = julMaresImportHandler();
  const prepared = await prepareImport(
    context,
    handler,
    { fileName: sample.fileName, bytes: buildSampleBytes(sample) },
    JUL,
  );
  const result = await applyImport(context, handler, prepared, options);
  return { prepared, result };
}

describe('七月繁殖牝馬總表的套用（需求規格 11.6）', () => {
  const openContext = useServiceContexts();

  it('[JUL-09] 自動建立的配種紀錄要確認過才寫入', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seedHerd(context, gameId);

    await expect(runImport(context, SAMPLE, {})).rejects.toMatchObject({
      code: 'confirmationRequired',
    });
    expect(await listBreedings(context.database, gameId)).toEqual([]);

    // 三匹的 `状態` 都不是空胎，所以三筆都會自動建立（需求規格 11.6）。
    await runImport(context);
    expect(await listBreedings(context.database, gameId)).toHaveLength(3);
  });

  it('[JUL-01][JUL-08] 受胎與實際種牡馬存為正式結果；對應不到的種牡馬記外部名稱', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seedHerd(context, gameId);

    await runImport(context);

    const breedings = await listBreedings(context.database, gameId);
    const first = breedings.find((record) => record.mareId === 'h-1');
    expect(first).toMatchObject({
      gameYear: 1968,
      breedingType: 'free',
      stallionName: 'テストウマ001',
      conception: '受胎',
      expectedBirthYear: 1969,
    });
    expect(first?.stallionId).toBeUndefined();
    // 不受胎不建立預定產駒（需求規格 9.1）。
    expect(breedings.find((record) => record.mareId === 'h-2')).toMatchObject({
      conception: '不受胎',
    });
    expect(breedings.find((record) => record.mareId === 'h-2')?.expectedBirthYear).toBeUndefined();

    const events = await listEventsForSubject(context.database, gameId, 'h-1');
    expect(events.map((event) => event.type)).toContain('breedingRecorded');
  });

  it('[JUL-03] 保存 7 月活力快照，不覆寫五月的仔出、繁殖年數與頭數', async () => {
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

    await runImport(context);

    const yearly = (await listMareYearly(context.database, gameId)).find(
      (record) => record.horseId === 'h-1',
    );
    expect(yearly).toMatchObject({
      id: 'y-1',
      vitalityMay: { state: 'confirmed', value: 13, boosted: true },
      vitalityJuly: { state: 'confirmed', value: 62, boosted: false },
      kodashi: 7,
      breedingYears: 3,
      breedingCount: 2,
    });
  });

  it('[JUL-04] 確認後依實際種牡馬保存並標示偏離規則；血統檢查不留給不同的配對', async () => {
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
        pedigreeCheck: {
          activationCount: 8,
          duplicateAncestors: [],
          insufficientPedigree: false,
          gapsOnlyFromBuildingPhase: false,
        },
      } satisfies Breeding,
    ]);

    await runImport(context);

    const record = (await listBreedings(context.database, gameId)).find(
      (item) => item.mareId === 'h-1',
    );
    expect(record).toMatchObject({
      id: 'b-1',
      breedingType: 'designated',
      stallionName: 'テストウマ001',
      conception: '受胎',
      deviated: true,
    });
    // 規則快照留著（看得出依哪個任務登記），但對「原本要配的那匹」算的血統檢查拿掉。
    expect(record?.ruleSnapshot?.taskId).toBe('found:1-0:1-0:1-1');
    expect(record?.pedigreeCheck).toBeUndefined();
    expect(record?.stallionId).toBeUndefined();
  });

  it('[JUL-02] 缺席與待處理的列都不寫入，繁殖牝馬圈不變', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seed(context, gameId, 'horses', [
      horse({ id: 'h-1', abilityNo: 0x1001, birthYear: 1962, fullName: 'テストメス001' }),
      horse({ id: 'h-9', abilityNo: 0x1099, birthYear: 1960, fullName: 'テストメス099' }),
    ]);
    await seed(context, gameId, 'mares', [producing('h-1', 32), producing('h-9', 32)]);

    const { result } = await runImport(context);
    // 只有配對到的那一匹寫入。
    expect(result.appliedRows).toBe(1);
    expect(await listBreedings(context.database, gameId)).toHaveLength(1);
    // 缺席的母馬仍在圈，據點也沒變。
    expect(await getMare(context.database, gameId, 'h-9')).toMatchObject({
      status: 'producing',
      site: 32,
    });
    // 五月名單沒有的母馬沒有被建立。
    expect(await getHorse(context.database, gameId, 'h-2')).toBeUndefined();
  });

  it('[JUL-05] 補上空白的父系並記下繁殖牝馬馬番号；衝突的一筆不寫入', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seed(context, gameId, 'horses', [
      horse({ id: 'h-1', abilityNo: 0x1001, birthYear: 1962, fullName: 'テストメス001' }),
      horse({
        id: 'h-2',
        abilityNo: 0x1002,
        birthYear: 1959,
        fullName: 'テストメス002',
        sireSubsystem: 'マッチェム',
      }),
    ]);
    await seed(context, gameId, 'mares', [producing('h-1', 32), producing('h-2', 33)]);

    await runImport(context);

    expect(await getHorse(context.database, gameId, 'h-1')).toMatchObject({
      sireName: 'テストウマ001',
      sireSubsystem: 'エクリプス',
      stageNumbers: [{ stage: 'broodmare', number: 0x2001, gameYear: 1968, source: 'julMares' }],
    });
    // 衝突的那一匹完全沒被碰過。
    const untouched = await getHorse(context.database, gameId, 'h-2');
    expect(untouched?.sireSubsystem).toBe('マッチェム');
    expect(untouched?.stageNumbers).toEqual([]);
    expect(
      (await listBreedings(context.database, gameId)).some((record) => record.mareId === 'h-2'),
    ).toBe(false);
  });
});
