import { describe, expect, it } from 'vitest';
import type { Foal } from '../../src/domain/foal.ts';
import type { Horse } from '../../src/domain/horse.ts';
import type { StallionDuty } from '../../src/domain/stallion-duty.ts';
import { listGameCheckpoints } from '../../src/services/checkpoints.ts';
import type { ServiceContext } from '../../src/services/context.ts';
import { createGame } from '../../src/services/games.ts';
import {
  applyImport,
  prepareImport,
  type ApplyImportOptions,
  type ImportChoice,
} from '../../src/services/imports.ts';
import { mayStallionsImportHandler } from '../../src/services/may-stallions-import.ts';
import { listEventsForSubject } from '../../src/storage/events.ts';
import { getHorse, horseNameKeys } from '../../src/storage/horses.ts';
import { putRecords } from '../../src/storage/records.ts';
import { listStallionDuties } from '../../src/storage/stallion-duties.ts';
import { listStallionYearly } from '../../src/storage/stallion-yearly.ts';
import {
  buildSampleBytes,
  syntheticSample,
  type SyntheticSample,
} from '../../scripts/lib/synthetic-samples.ts';
import { useServiceContexts } from './helpers.ts';

const SAMPLE = syntheticSample('mayStallions');
const MAY: ImportChoice = { type: 'mayStallions', gameYear: 1968, timing: { month: 5, week: 1 } };

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

/** 隔年的同一份總表：`年` 是馬齡，每過一年要加 1，出生年才會推成同一年。 */
function aged(sample: SyntheticSample, years: number): SyntheticSample {
  return {
    ...sample,
    rows: sample.rows.map((row) => ({
      ...row,
      age: String(Number(row.age ?? '0') + years),
    })),
  };
}

function horse(overrides: Partial<Horse> & Pick<Horse, 'id'>): Horse {
  return { sex: 'male', stageNumbers: [], aliases: [], ...overrides };
}

async function seed(
  context: ServiceContext,
  gameId: string,
  collection: 'horses' | 'foals' | 'stallionDuties',
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

function ownFoal(id: string, damId: string, birthYear: number): Foal {
  return {
    id,
    damId,
    birthYear,
    freeBred: false,
    disposition: 'keep',
    lineage: { position: 1, generation: 1 },
  };
}

function onDuty(id: string, horseId: string, generation: number): StallionDuty {
  return {
    id,
    position: 1,
    generation,
    horseId,
    role: 'current',
    dutyStatus: 'onDuty',
    startYear: 1965,
  };
}

async function setUp(context: ServiceContext): Promise<string> {
  const game = await createGame(context, { name: '種牡馬套用局', startYear: 1968 });
  return game.id;
}

async function runImport(
  context: ServiceContext,
  sample: SyntheticSample = SAMPLE,
  choice: ImportChoice = MAY,
  options: ApplyImportOptions = {},
) {
  const handler = mayStallionsImportHandler();
  const prepared = await prepareImport(
    context,
    handler,
    { fileName: sample.fileName, bytes: buildSampleBytes(sample) },
    choice,
  );
  const result = await applyImport(context, handler, prepared, options);
  return { prepared, result };
}

describe('五月種牡馬總表的套用（需求規格 11.8）', () => {
  const openContext = useServiceContexts();

  it('[STL-08] 未配對者建立種牡馬紀錄，保存能力番号、出生年與種牡馬馬番号', async () => {
    const context = await openContext();
    const gameId = await setUp(context);

    const { result } = await runImport(context);
    expect(result.appliedRows).toBe(3);

    const yearly = await listStallionYearly(context.database, gameId);
    expect(yearly).toHaveLength(3);
    const created = yearly.find((record) => record.studFee === 2450);
    expect(created).toBeDefined();
    const stallion = await getHorse(context.database, gameId, created?.horseId ?? '');
    expect(stallion).toMatchObject({
      sex: 'male',
      abilityNo: 0,
      birthYear: 1960,
      fullName: 'テストウマ001',
      sireName: 'テストウマ900',
      damName: 'テストメス900',
      sireSubsystem: 'エクリプス',
      stallionListing: { lastSeenYear: 1968 },
    });
    expect(stallion?.stageNumbers).toEqual([
      { stage: 'stallion', number: 0, gameYear: 1968, source: 'mayStallions' },
    ]);
  });

  it('[IMP-12] 種牡馬總表是年度總表，套用後自動建立檢查點', async () => {
    const context = await openContext();
    await setUp(context);

    const { result } = await runImport(context);
    expect(result.checkpointId).toBeDefined();
    const checkpoints = await listGameCheckpoints(context);
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]?.timing).toEqual({ month: 5, week: 1 });
  });

  it('[STL-09] 自家生產的馬沿用內部識別，保存種牡馬馬番号並留下成為種牡馬的去向', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seed(context, gameId, 'horses', [
      horse({ id: 'dam-1', sex: 'female', fullName: 'テストメス900' }),
      horse({ id: 'own-1', abilityNo: 0x0000, birthYear: 1960, fullName: 'テストウマ001' }),
    ]);
    await seed(context, gameId, 'foals', [ownFoal('own-1', 'dam-1', 1960)]);

    await runImport(context);

    const stallion = await getHorse(context.database, gameId, 'own-1');
    expect(stallion?.fate).toEqual({ kind: 'becameStallion', gameYear: 1968 });
    expect(stallion?.stageNumbers).toEqual([
      { stage: 'stallion', number: 0, gameYear: 1968, source: 'mayStallions' },
    ]);
    const events = await listEventsForSubject(context.database, gameId, 'own-1');
    expect(events.map((event) => event.type)).toContain('becameStallion');
    // 產駒紀錄本身不動，母馬的產駒頁籤是由去向推導出來的。
    expect(
      (await listStallionYearly(context.database, gameId)).some((r) => r.horseId === 'own-1'),
    ).toBe(true);
  });

  it('[STL-11] 年度資料與前一份相同時不重複保存；不同時保存新快照，舊年度仍查得到', async () => {
    const context = await openContext();
    const gameId = await setUp(context);

    await runImport(context);
    const first = await listStallionYearly(context.database, gameId);
    const horseId = first.find((record) => record.studFee === 2450)?.horseId ?? '';

    // 隔年同樣內容：不再寫一筆。
    await runImport(
      context,
      aged(SAMPLE, 1),
      { ...MAY, gameYear: 1969 },
      { confirmAdvanceYear: true },
    );
    const afterSame = await listStallionYearly(context.database, gameId);
    expect(afterSame.filter((record) => record.horseId === horseId)).toHaveLength(1);

    // 再隔年種付料變了：寫新的一份，1968 年那一份還在。
    await runImport(
      context,
      withRow(aged(SAMPLE, 2), 0, { studFee: '3,000' }),
      { ...MAY, gameYear: 1970 },
      { confirmAdvanceYear: true },
    );
    const afterChange = (await listStallionYearly(context.database, gameId))
      .filter((record) => record.horseId === horseId)
      .sort((a, b) => a.gameYear - b.gameYear);
    expect(afterChange.map((record) => [record.gameYear, record.studFee])).toEqual([
      [1968, 2450],
      [1970, 3000],
    ]);
  });

  it('[STL-10] 缺席的八系現任確認後標示已引退並結束任期；其他缺席者只標示非現役', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seed(context, gameId, 'horses', [
      horse({
        id: 'duty-1',
        fullName: 'ハチケイゲンニン',
        stallionListing: { lastSeenYear: 1967 },
      }),
      horse({
        id: 'market-1',
        fullName: 'シジョウシュボバ',
        stallionListing: { lastSeenYear: 1967 },
      }),
    ]);
    await seed(context, gameId, 'stallionDuties', [onDuty('d-1', 'duty-1', 0)]);

    // 沒有確認警告時整份不套用（需求規格 5.2）。
    await expect(runImport(context)).rejects.toMatchObject({ code: 'confirmationRequired' });

    await runImport(context, SAMPLE, MAY, { confirmWarnings: true });

    const [duty] = await listStallionDuties(context.database, gameId);
    expect(duty).toMatchObject({ dutyStatus: 'retired', endYear: 1968 });
    expect(await getHorse(context.database, gameId, 'duty-1')).toMatchObject({
      stallionListing: { lastSeenYear: 1967, inactiveSince: 1968 },
    });
    expect(await getHorse(context.database, gameId, 'market-1')).toMatchObject({
      stallionListing: { lastSeenYear: 1967, inactiveSince: 1968 },
    });
    const events = await listEventsForSubject(context.database, gameId, 'duty-1');
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['stallionListingChanged', 'stallionDutyChanged']),
    );
  });

  it('[STL-10] 非現役的馬重新出現在總表時清掉標示', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seed(context, gameId, 'horses', [
      horse({
        id: 'back-1',
        abilityNo: 0x0000,
        birthYear: 1960,
        fullName: 'テストウマ001',
        stallionListing: { lastSeenYear: 1966, inactiveSince: 1967 },
      }),
    ]);

    await runImport(context);

    expect(await getHorse(context.database, gameId, 'back-1')).toMatchObject({
      stallionListing: { lastSeenYear: 1968 },
    });
    const events = await listEventsForSubject(context.database, gameId, 'back-1');
    expect(events.map((event) => event.type)).toContain('stallionListingChanged');
  });

  it('[STL-13] 血統衝突的一筆不寫入，其他筆照常套用', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seed(context, gameId, 'horses', [
      horse({
        id: 'h-2',
        abilityNo: 0x0101,
        birthYear: 1963,
        fullName: '(外)テストウマ002',
        sireSubsystem: 'マッチェム',
      }),
    ]);

    const { result } = await runImport(context);
    expect(result.appliedRows).toBe(2);
    const untouched = await getHorse(context.database, gameId, 'h-2');
    expect(untouched?.sireSubsystem).toBe('マッチェム');
    expect(untouched?.stallionListing).toBeUndefined();
    expect(result.batch.summary).toMatchObject({ apply: 2, skip: 1 });
  });
});
