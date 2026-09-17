import { describe, expect, it } from 'vitest';
import type { Horse } from '../../src/domain/horse.ts';
import type { Mare } from '../../src/domain/mare.ts';
import { listGameCheckpoints } from '../../src/services/checkpoints.ts';
import type { ServiceContext } from '../../src/services/context.ts';
import { changeCurrentYear, createGame } from '../../src/services/games.ts';
import {
  applyImport,
  prepareImport,
  type ApplyImportOptions,
  type ImportChoice,
} from '../../src/services/imports.ts';
import { mayMaresImportHandler } from '../../src/services/may-mares-import.ts';
import { openLine } from '../../src/services/lines.ts';
import { saveBreeding } from '../../src/services/breedings.ts';
import { nameFoal, registerFoal } from '../../src/services/foals.ts';
import { listEventsForSubject } from '../../src/storage/events.ts';
import { listLines } from '../../src/storage/lines.ts';
import { listStallionDuties } from '../../src/storage/stallion-duties.ts';
import { addStarter, foalInput } from './stud-fixture.ts';
import { getHorse, horseNameKeys } from '../../src/storage/horses.ts';
import { listMareYearly } from '../../src/storage/mare-yearly.ts';
import { getMare, listMares } from '../../src/storage/mares.ts';
import { putRecords } from '../../src/storage/records.ts';
import {
  buildSampleBytes,
  syntheticSample,
  type SyntheticSample,
} from '../../scripts/lib/synthetic-samples.ts';
import { useServiceContexts } from './helpers.ts';

const SAMPLE = syntheticSample('mayMares');
const MAY: ImportChoice = { type: 'mayMares', gameYear: 1968, timing: { month: 5, week: 1 } };

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

function producing(id: string, site: number): Mare {
  return {
    id,
    group: { kind: 'substitute', position: 1, generation: 1 },
    origin: 'marketReplenish',
    status: 'producing',
    site: site as Mare['site'],
  };
}

async function seedHorses(
  context: ServiceContext,
  gameId: string,
  horses: readonly Horse[],
): Promise<void> {
  await putRecords(
    context.database,
    gameId,
    'horses',
    horses.map((item) => ({ ...item, nameKeys: horseNameKeys(gameId, item) })),
  );
}

async function seedMares(
  context: ServiceContext,
  gameId: string,
  mares: readonly Mare[],
): Promise<void> {
  await putRecords(
    context.database,
    gameId,
    'mares',
    mares.map((mare) => ({ ...mare })),
  );
}

async function setUp(context: ServiceContext): Promise<string> {
  const game = await createGame(context, { name: '五月套用局', startYear: 1968 });
  return game.id;
}

async function runImport(
  context: ServiceContext,
  sample: SyntheticSample = SAMPLE,
  choice: ImportChoice = MAY,
  options: ApplyImportOptions = {},
) {
  const handler = mayMaresImportHandler();
  const prepared = await prepareImport(
    context,
    handler,
    { fileName: sample.fileName, bytes: buildSampleBytes(sample) },
    choice,
  );
  const result = await applyImport(context, handler, prepared, options);
  return { prepared, result };
}

describe('五月繁殖牝馬總表的套用（需求規格 11.5）', () => {
  const openContext = useServiceContexts();

  it('[MAY-07][MAY-08] 保存 5 月活力、仔出、繁殖年數與頭數；活力 0 是已確認的 0', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seedHorses(context, gameId, [
      horse({ id: 'h-1', abilityNo: 0x1001, birthYear: 1962, fullName: 'テストメス001' }),
    ]);
    await seedMares(context, gameId, [producing('h-1', 32)]);

    await runImport(context, withRow(SAMPLE, 0, { vitality: '0' }));

    const record = (await listMareYearly(context.database, gameId)).find(
      (item) => item.horseId === 'h-1',
    );
    expect(record).toMatchObject({
      gameYear: 1968,
      vitalityMay: { state: 'confirmed', value: 0, boosted: false },
      kodashi: 7,
      breedingYears: 3,
      breedingCount: 2,
    });
  });

  it('[MARE-14] `*13` 是 13 且増強中，不帶 `*` 的 100 不是増強', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seedHorses(context, gameId, [
      horse({ id: 'h-1', abilityNo: 0x1001, birthYear: 1962, fullName: 'テストメス001' }),
      horse({ id: 'h-3', abilityNo: 0x1003, birthYear: 1964, fullName: '(外)テストメス003' }),
    ]);
    await seedMares(context, gameId, [producing('h-1', 32), producing('h-3', 35)]);

    await runImport(context);
    const yearly = await listMareYearly(context.database, gameId);
    expect(yearly.find((item) => item.horseId === 'h-1')?.vitalityMay).toEqual({
      state: 'confirmed',
      value: 13,
      boosted: true,
    });
    expect(yearly.find((item) => item.horseId === 'h-3')?.vitalityMay).toEqual({
      state: 'confirmed',
      value: 100,
      boosted: false,
    });
  });

  it('[MAY-05][MAY-06] 補齊空白的父母與父系；同一個馬番号只記一次歷程', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seedHorses(context, gameId, [
      horse({ id: 'h-1', abilityNo: 0x1001, birthYear: 1962, fullName: 'テストメス001' }),
    ]);
    await seedMares(context, gameId, [producing('h-1', 32)]);

    await runImport(context);
    const filled = await getHorse(context.database, gameId, 'h-1');
    expect(filled).toMatchObject({
      sireName: 'テストウマ001',
      sireSubsystem: 'エクリプス',
      damName: 'テストメス900',
      femaleLine: 'テスト牝系',
    });
    expect(filled?.stageNumbers).toEqual([
      { stage: 'broodmare', number: 0x2001, gameYear: 1968, source: 'mayMares' },
    ]);

    // 隔年同一匹母馬、同一個馬番号再出現，不重複增加歷程（MAY-06）。
    await changeCurrentYear(context, 1969);
    await runImport(context, withRow(SAMPLE, 0, { age: '7' }), { ...MAY, gameYear: 1969 });
    expect((await getHorse(context.database, gameId, 'h-1'))?.stageNumbers).toHaveLength(1);
    // 舊年度的年度資料仍在（MAY-07）。
    const years = (await listMareYearly(context.database, gameId))
      .filter((item) => item.horseId === 'h-1')
      .map((item) => item.gameYear)
      .sort();
    expect(years).toEqual([1968, 1969]);
  });

  it('轉場更新據點並保存事件', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seedHorses(context, gameId, [
      horse({ id: 'h-2', abilityNo: 0x1002, birthYear: 1959, fullName: 'テストメス002' }),
    ]);
    await seedMares(context, gameId, [producing('h-2', 34)]);

    await runImport(context);
    expect((await getMare(context.database, gameId, 'h-2'))?.site).toBe(33);
    expect(
      (await listEventsForSubject(context.database, gameId, 'h-2')).map((event) => event.type),
    ).toContain('mareTransferred');
  });

  it('[ID-04] 已離圈的母馬回歸，沿用母馬群並建立回歸事件', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seedHorses(context, gameId, [
      horse({ id: 'h-1', abilityNo: 0x1001, birthYear: 1962, fullName: 'テストメス001' }),
    ]);
    await seedMares(context, gameId, [
      { ...producing('h-1', 32), status: 'left', leftReason: 'sold' },
    ]);

    await runImport(context);
    const mare = await getMare(context.database, gameId, 'h-1');
    expect(mare).toMatchObject({
      status: 'producing',
      group: { kind: 'substitute', position: 1, generation: 1 },
    });
    expect(mare?.leftReason).toBeUndefined();
    expect(
      (await listEventsForSubject(context.database, gameId, 'h-1')).map((event) => event.type),
    ).toContain('mareReturned');
  });

  it('[MARE-09] 缺席者依預設處置離圈並留下事件', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seedHorses(context, gameId, [
      horse({ id: 'old', abilityNo: 0x1098, birthYear: 1942, fullName: 'テストロウバ' }),
      horse({ id: 'young', abilityNo: 0x1099, birthYear: 1960, fullName: 'テストワカ' }),
    ]);
    await seedMares(context, gameId, [producing('old', 32), producing('young', 32)]);

    await runImport(context);
    expect(await getMare(context.database, gameId, 'old')).toMatchObject({
      status: 'left',
      leftReason: 'retired',
    });
    expect(await getMare(context.database, gameId, 'young')).toMatchObject({
      status: 'left',
      leftReason: 'sold',
    });
    expect(
      (await listEventsForSubject(context.database, gameId, 'old')).map((event) => event.type),
    ).toContain('mareRetired');
  });

  it('[MAY-03] 新進（其他）建立生產中、待指定用途的母馬', async () => {
    const context = await openContext();
    const gameId = await setUp(context);

    await runImport(context);
    const mares = await listMares(context.database, gameId);
    expect(mares).toHaveLength(3);
    for (const mare of mares) {
      expect(mare).toMatchObject({ status: 'producing', group: { kind: 'unassigned' } });
    }
  });

  it('[MAY-05] 血統衝突的列整筆略過，據點與年度資料都不動', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seedHorses(context, gameId, [
      horse({
        id: 'h-2',
        abilityNo: 0x1002,
        birthYear: 1959,
        fullName: 'テストメス002',
        sireName: 'ベツノウマ',
      }),
    ]);
    await seedMares(context, gameId, [producing('h-2', 34)]);

    await runImport(context);
    expect((await getHorse(context.database, gameId, 'h-2'))?.sireName).toBe('ベツノウマ');
    expect((await getMare(context.database, gameId, 'h-2'))?.site).toBe(34);
    expect(
      (await listMareYearly(context.database, gameId)).some((item) => item.horseId === 'h-2'),
    ).toBe(false);
  });

  it('[IMP-12][CKPT-01] 五月是年度總表，套用後自動建立含時點的檢查點', async () => {
    const context = await openContext();
    await setUp(context);
    const { prepared, result } = await runImport(context);

    expect(prepared.createsCheckpoint).toBe(true);
    expect(result.checkpointId).toBeDefined();
    expect((await listGameCheckpoints(context))[0]?.timing).toEqual({ month: 5, week: 1 });
  });

  it('[MAY-09] 八系指定配種所生的母駒自動入群，該代隨之成立', async () => {
    const context = await openContext();
    const game = await createGame(context, { name: '自家母駒局', startYear: 1968 });
    await openLine(context, {
      position: 1,
      subsystem: 'ネアルコ',
      parentSystem: 'ネアルコ',
      color: '#c62828',
      founder: {
        fullName: 'テストシュボバ',
        abilityNo: '',
        birthYear: 1950,
        sireName: '',
        damName: '',
      },
    });
    const [duty] = await listStallionDuties(context.database, game.id);
    const damId = await addStarter(context, 'テストハハウマ');
    await saveBreeding(context, {
      mareId: damId,
      gameYear: 1968,
      breedingType: 'designated',
      stallionId: duty?.horseId ?? '',
      stallionName: '',
      conception: '受胎',
    });
    await changeCurrentYear(context, 1969);
    const foal = await registerFoal(context, foalInput(damId, 1969, { sex: 'female' }));
    await nameFoal(context, { foalId: foal.horse.id, officialName: 'テストメス001' });
    await changeCurrentYear(context, 1973);

    // 只留一列：1969 年生的母駒，1973 年的五月總表上是 4 歲。
    const [first] = SAMPLE.rows;
    if (first === undefined) {
      throw new Error('樣本資料不足');
    }
    // 自身父系要和出生時由父馬決定的值一致，否則是血統衝突而不是新進。
    const sample: SyntheticSample = {
      ...SAMPLE,
      rows: [{ ...first, age: '4', sireSystem: 'ネアルコ系' }],
    };
    await runImport(context, sample, { ...MAY, gameYear: 1973 });

    const mare = await getMare(context.database, game.id, foal.horse.id);
    expect(mare).toMatchObject({
      status: 'producing',
      origin: 'ownRetired',
      // 零代種牡馬 × 起點母馬群 → 產出第 1 系 1 代。
      group: { kind: 'own', position: 1, generation: 1 },
      // 該代還沒有姊妹在圈，所以是暫定保留（需求規格 8.9）。
      succession: 'provisional',
    });
    const [line] = await listLines(context.database, game.id);
    expect(line?.establishedGenerations).toEqual([{ generation: 1, gameYear: 1973 }]);
    expect(
      (await listEventsForSubject(context.database, game.id, foal.horse.id)).map(
        (event) => event.type,
      ),
    ).toContain('mareAdded');
  });

  it('[MAY-10] 自由配種所生的母駒不入八系母馬群', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seedHorses(context, gameId, [
      horse({ id: 'f-1', abilityNo: 0x1001, birthYear: 1962, fullName: 'テストメス001' }),
    ]);
    await putRecords(context.database, gameId, 'foals', [
      { id: 'f-1', damId: 'dam-1', birthYear: 1962, freeBred: true, disposition: 'keep' },
    ]);

    await runImport(context);
    expect(await getMare(context.database, gameId, 'f-1')).toMatchObject({
      status: 'producing',
      group: { kind: 'unassigned' },
    });
  });
});
