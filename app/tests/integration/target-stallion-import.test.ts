import { describe, expect, it } from 'vitest';
import type { Horse } from '../../src/domain/horse.ts';
import type { Line } from '../../src/domain/line.ts';
import type { StallionDuty } from '../../src/domain/stallion-duty.ts';
import type { ServiceContext } from '../../src/services/context.ts';
import { createGame } from '../../src/services/games.ts';
import {
  applyImport,
  listImportHistory,
  prepareImport,
  type ApplyImportOptions,
  type ImportChoice,
} from '../../src/services/imports.ts';
import { assignCurrentStallion } from '../../src/services/stallions.ts';
import {
  targetStallionImportHandler,
  type TargetStallionTarget,
} from '../../src/services/target-stallion-import.ts';
import { listEventsForSubject } from '../../src/storage/events.ts';
import { getHorse, horseNameKeys } from '../../src/storage/horses.ts';
import { listLines } from '../../src/storage/lines.ts';
import { putRecords } from '../../src/storage/records.ts';
import { listStallionDuties } from '../../src/storage/stallion-duties.ts';
import { listSystemMapEntries } from '../../src/storage/system-map.ts';
import {
  buildSampleBytes,
  syntheticSample,
  type SyntheticSample,
} from '../../scripts/lib/synthetic-samples.ts';
import { raiseStud } from './stud-fixture.ts';
import { useServiceContexts } from './helpers.ts';

const SAMPLE = syntheticSample('targetStallion');
const CHOICE: ImportChoice = {
  type: 'targetStallion',
  gameYear: 1968,
  timing: { month: 5, week: 1 },
};

function withRows(
  sample: SyntheticSample,
  rows: SyntheticSample['rows'],
  fileName = sample.fileName,
): SyntheticSample {
  return { ...sample, fileName, rows };
}

function withRow(changes: Readonly<Record<string, string>>): SyntheticSample {
  return { ...SAMPLE, rows: SAMPLE.rows.map((row) => ({ ...row, ...changes })) };
}

function horse(overrides: Partial<Horse> & Pick<Horse, 'id'>): Horse {
  return { sex: 'male', stageNumbers: [], aliases: [], ...overrides };
}

function line(position: number, subsystem: string, generations: readonly number[]): Line {
  return {
    id: `line-${String(position)}`,
    position: position as Line['position'],
    subsystem,
    parentSystem: subsystem,
    color: '#c62828',
    branch: { targetGeneration: 1, openedYear: 1960 },
    establishedGenerations: generations.map((generation) => ({ generation, gameYear: 1965 })),
  };
}

function founderDuty(
  id: string,
  position: number,
  horseId: string,
  retired: boolean,
): StallionDuty {
  return {
    id,
    position: position as Line['position'],
    generation: 0,
    horseId,
    role: 'current',
    dutyStatus: retired ? 'retired' : 'onDuty',
    startYear: 1960,
    ...(retired ? { endYear: 1967 } : {}),
  };
}

async function seed(
  context: ServiceContext,
  gameId: string,
  collection: 'horses' | 'lines' | 'stallionDuties' | 'systemMap',
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

async function setUp(context: ServiceContext): Promise<string> {
  const game = await createGame(context, { name: '目標種牡馬局', startYear: 1968 });
  return game.id;
}

async function runImport(
  context: ServiceContext,
  target: TargetStallionTarget,
  sample: SyntheticSample = SAMPLE,
  options: ApplyImportOptions = {},
) {
  const handler = targetStallionImportHandler(target);
  const prepared = await prepareImport(
    context,
    handler,
    { fileName: sample.fileName, bytes: buildSampleBytes(sample) },
    CHOICE,
  );
  const result = await applyImport(context, handler, prepared, options);
  return { prepared, result };
}

describe('目標種牡馬 TXT（需求規格 11.9）', () => {
  const openContext = useServiceContexts();

  it('[STL-01] 開啟建立新系的分支並匯入 → 建立該系零代種牡馬並連結分支', async () => {
    const context = await openContext();
    const gameId = await setUp(context);

    const { result } = await runImport(context, {
      kind: 'openLine',
      position: 1,
      // 子系統留白時取檔案的 `父系`（去掉結尾「系」）。
      subsystem: '',
      parentSystem: 'ヘロド',
      color: '#c62828',
    });
    expect(result.appliedRows).toBe(1);
    // 不是年度總表：不建立檢查點、不推進遊戲年（需求規格 11.1）。
    expect(result.checkpointId).toBeUndefined();
    expect(result.advancedToYear).toBeUndefined();

    const [created] = await listLines(context.database, gameId);
    expect(created).toMatchObject({
      position: 1,
      subsystem: 'ヘロド',
      parentSystem: 'ヘロド',
      branch: { targetGeneration: 1, openedYear: 1968 },
    });

    const [duty] = await listStallionDuties(context.database, gameId);
    expect(duty).toMatchObject({
      position: 1,
      generation: 0,
      role: 'current',
      dutyStatus: 'onDuty',
    });
    const founder = await getHorse(context.database, gameId, duty?.horseId ?? '');
    expect(founder).toMatchObject({
      sex: 'male',
      abilityNo: 0x0303,
      birthYear: 1962,
      fullName: 'テストウマ004',
      sireName: '(外)テストウマ002',
      damName: 'テストメス903',
      sireSubsystem: 'ヘロド',
    });
    expect(founder?.stageNumbers).toEqual([
      { stage: 'stallion', number: 0x0303, gameYear: 1968, source: 'targetStallion' },
    ]);
    // 子系統還沒登錄時一併寫進系統對照表（需求規格 7.2）。
    expect(await listSystemMapEntries(context.database, gameId)).toMatchObject([
      { subsystem: 'ヘロド', parentSystem: 'ヘロド' },
    ]);
  });

  it('[STL-04] 整份 0 匹或 2 匹以上時停止，不寫入', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    const target: TargetStallionTarget = {
      kind: 'openLine',
      position: 1,
      subsystem: '',
      parentSystem: 'ヘロド',
      color: '#c62828',
    };

    await expect(runImport(context, target, withRows(SAMPLE, []))).rejects.toMatchObject({
      code: 'importHalted',
    });
    const two = [...SAMPLE.rows, { ...SAMPLE.rows[0], abilityNo: '0x0404', horseNo: '0x0404' }];
    await expect(
      runImport(context, target, withRows(SAMPLE, two as SyntheticSample['rows'])),
    ).rejects.toMatchObject({ code: 'importHalted' });

    expect(await listLines(context.database, gameId)).toEqual([]);
    expect(await listImportHistory(context)).toEqual([]);
  });

  it('[STL-05] 同一層的兩條建立新系分支各自匯入自己的檔案，互不影響', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    // 第 1、2 系都已成立到 2 代 → 產出 3 代時第 3、4 系是同一層的兩條分支（需求規格 7.3）。
    await seed(context, gameId, 'lines', [
      line(1, 'ネアルコ', [1, 2]),
      line(2, 'ナスルーラ', [1, 2]),
    ]);

    await runImport(context, {
      kind: 'openLine',
      position: 3,
      subsystem: 'ヘロド',
      parentSystem: 'ヘロド',
      color: '#1565c0',
    });
    await runImport(
      context,
      {
        kind: 'openLine',
        position: 4,
        subsystem: 'エクリプス',
        parentSystem: 'エクリプス',
        color: '#2e7d32',
      },
      withRow({
        name: 'テストウマ005',
        abilityNo: '0x0404',
        horseNo: '0x0404',
        baseName: 'テストウマ005',
      }),
    );

    const lines = (await listLines(context.database, gameId)).sort(
      (a, b) => a.position - b.position,
    );
    expect(lines.map((item) => [item.position, item.subsystem])).toEqual([
      [1, 'ネアルコ'],
      [2, 'ナスルーラ'],
      [3, 'ヘロド'],
      [4, 'エクリプス'],
    ]);
    const duties = await listStallionDuties(context.database, gameId);
    expect(duties).toHaveLength(2);
    expect(new Set(duties.map((duty) => duty.position))).toEqual(new Set([3, 4]));
  });

  it('[STL-06] 替換提前引退的零代種牡馬：位置、分支與已成立的世代不變，前任紀錄仍連結原種牡馬', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seed(context, gameId, 'horses', [horse({ id: 'old-1', fullName: 'シジツインタイ' })]);
    await seed(context, gameId, 'lines', [line(3, 'ヘロド', [3])]);
    await seed(context, gameId, 'systemMap', [
      { id: 'sm-1', subsystem: 'ヘロド', parentSystem: 'ヘロド' },
    ]);
    await seed(context, gameId, 'stallionDuties', [founderDuty('d-old', 3, 'old-1', true)]);

    await runImport(context, { kind: 'replaceFounder', position: 3 });

    const [updated] = await listLines(context.database, gameId);
    expect(updated).toMatchObject({
      position: 3,
      subsystem: 'ヘロド',
      branch: { targetGeneration: 1, openedYear: 1960 },
      establishedGenerations: [{ generation: 3, gameYear: 1965 }],
    });

    const duties = await listStallionDuties(context.database, gameId);
    expect(duties).toHaveLength(2);
    // 前任的任期原封不動，仍連結原來的那一匹。
    expect(duties.find((duty) => duty.id === 'd-old')).toMatchObject({
      horseId: 'old-1',
      dutyStatus: 'retired',
      endYear: 1967,
    });
    const successor = duties.find((duty) => duty.id !== 'd-old');
    expect(successor).toMatchObject({
      position: 3,
      generation: 0,
      role: 'current',
      dutyStatus: 'onDuty',
      startYear: 1968,
    });
    expect(await getHorse(context.database, gameId, successor?.horseId ?? '')).toMatchObject({
      fullName: 'テストウマ004',
      sireSubsystem: 'ヘロド',
    });
  });

  it('[STL-07] 替換的子系統與該系不同 → 警告並確認，確認後更新目前子系統名稱並保存歷程', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seed(context, gameId, 'horses', [horse({ id: 'old-1', fullName: 'シジツインタイ' })]);
    await seed(context, gameId, 'lines', [line(3, 'マッチェム', [3])]);
    await seed(context, gameId, 'systemMap', [
      { id: 'sm-1', subsystem: 'ヘロド', parentSystem: 'ヘロド' },
    ]);
    await seed(context, gameId, 'stallionDuties', [founderDuty('d-old', 3, 'old-1', true)]);

    const target: TargetStallionTarget = { kind: 'replaceFounder', position: 3 };
    // 沒有確認就不套用（需求規格 5.2、7.7）。
    await expect(runImport(context, target)).rejects.toMatchObject({
      code: 'confirmationRequired',
    });

    await runImport(context, target, SAMPLE, { confirmWarnings: true });

    const [updated] = await listLines(context.database, gameId);
    expect(updated?.subsystem).toBe('ヘロド');
    // 親系統不變，只有目前子系統改名；歷程保存舊名（需求規格 7.1、LINE-06）。
    expect(updated?.parentSystem).toBe('マッチェム');
    const events = await listEventsForSubject(context.database, gameId, 'line-3');
    expect(events.map((event) => event.type)).toContain('lineSystemsChanged');
    expect(events.find((event) => event.type === 'lineSystemsChanged')?.before).toMatchObject({
      subsystem: 'マッチェム',
    });
  });

  it('[STL-06] 零代種牡馬還在崗時不讓匯入替換', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seed(context, gameId, 'horses', [horse({ id: 'old-1', fullName: 'ザイコウ' })]);
    await seed(context, gameId, 'lines', [line(3, 'ヘロド', [3])]);
    await seed(context, gameId, 'stallionDuties', [founderDuty('d-old', 3, 'old-1', false)]);

    await expect(runImport(context, { kind: 'replaceFounder', position: 3 })).rejects.toMatchObject(
      { code: 'importHalted' },
    );
    expect(await listStallionDuties(context.database, gameId)).toHaveLength(1);
  });

  it('五月總表已建立的紀錄以能力番号＋出生年配對沿用，不另建一匹', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await seed(context, gameId, 'horses', [
      horse({
        id: 'from-may',
        abilityNo: 0x0303,
        birthYear: 1962,
        fullName: 'テストウマ004',
        stallionListing: { lastSeenYear: 1968 },
      }),
    ]);

    await runImport(context, {
      kind: 'openLine',
      position: 1,
      subsystem: '',
      parentSystem: 'ヘロド',
      color: '#c62828',
    });

    const [duty] = await listStallionDuties(context.database, gameId);
    expect(duty?.horseId).toBe('from-may');
    // 沿用時不重複寫「建立馬匹」事件。
    const events = await listEventsForSubject(context.database, gameId, 'from-may');
    expect(events.map((event) => event.type)).not.toContain('horseCreated');
    expect(events.map((event) => event.type)).toContain('stallionDutyStarted');
  });

  it('[STL-03] 自家種牡馬接任從既有馬匹選取，不需要匯入', async () => {
    const context = await openContext();
    const stud = await raiseStud(context);

    const duty = await assignCurrentStallion(context, { horseId: stud.elderId, stallionNo: '' });
    expect(duty).toMatchObject({ generation: 1, role: 'current', dutyStatus: 'onDuty' });
    expect(duty.horseId).toBe(stud.elderId);
    // 整個過程沒有任何匯入紀錄。
    expect(await listImportHistory(context)).toEqual([]);
  });
});
