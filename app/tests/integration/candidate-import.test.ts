import { describe, expect, it } from 'vitest';
import type { Horse } from '../../src/domain/horse.ts';
import {
  candidateImportHandler,
  type CandidateRow,
  type CandidateTarget,
} from '../../src/services/candidate-import.ts';
import { listGameCheckpoints } from '../../src/services/checkpoints.ts';
import type { ServiceContext } from '../../src/services/context.ts';
import { createGame, switchGame } from '../../src/services/games.ts';
import {
  applyImport,
  prepareImport,
  type ApplyImportOptions,
  type ImportChoice,
} from '../../src/services/imports.ts';
import { listMares } from '../../src/storage/mares.ts';
import { readRecords } from '../../src/storage/records.ts';
import {
  buildSampleBytes,
  syntheticSample,
  type SyntheticSample,
} from '../../scripts/lib/synthetic-samples.ts';
import { useServiceContexts } from './helpers.ts';

const SAMPLE = syntheticSample('candidateFile');

/** 候選 TXT 不限月份（MARE-06）；這裡刻意用 9 月 3 週。 */
const CHOICE: ImportChoice = {
  type: 'candidateFile',
  gameYear: 1968,
  timing: { month: 9, week: 3 },
};

const UNASSIGNED: CandidateTarget = { group: undefined, site: 32, origin: 'marketMixed' };

function source(sample: SyntheticSample = SAMPLE) {
  return { fileName: sample.fileName, bytes: buildSampleBytes(sample) };
}

async function setUp(context: ServiceContext): Promise<string> {
  const game = await createGame(context, { name: '候選測試局', startYear: 1968 });
  return game.id;
}

async function run(
  context: ServiceContext,
  target: CandidateTarget = UNASSIGNED,
  options: ApplyImportOptions = {},
  sample: SyntheticSample = SAMPLE,
) {
  const handler = candidateImportHandler(target);
  const prepared = await prepareImport(context, handler, source(sample), CHOICE);
  const result = await applyImport(context, handler, prepared, options);
  return { prepared, result };
}

async function horsesByName(context: ServiceContext, gameId: string): Promise<Map<string, Horse>> {
  const records = await readRecords(context.database, gameId, 'horses');
  const horses = records as unknown as Horse[];
  return new Map(horses.map((horse) => [horse.fullName ?? horse.id, horse]));
}

describe('候選 TXT 匯入（需求規格 11.7）', () => {
  const openContext = useServiceContexts();

  it('以 61 欄格式解析並分類，可套用的筆數等於檔案筆數（CAND-01）', async () => {
    const context = await openContext();
    await setUp(context);
    const handler = candidateImportHandler(UNASSIGNED);
    const prepared = await prepareImport(context, handler, source(), CHOICE);

    expect(prepared.rows).toHaveLength(30);
    expect(prepared.summary).toEqual({ apply: 30, skip: 0, review: 0, warn: 0, error: 0 });
    const [first] = prepared.rows;
    expect(first?.values.fullName).toBe('(外)テスト候補001');
    expect(first?.values.baseName).toBe('テスト候補001');
    // 年 3 歲、匯出年 1968 → 出生年 1965（需求規格 6.3）。
    expect(first?.birthYear).toBe(1965);
  });

  it('只建立勾選的母馬（CAND-02）', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    const { result } = await run(context, UNASSIGNED, { selectedLineNumbers: [2, 3, 5] });

    expect(result.appliedRows).toBe(3);
    const mares = await listMares(context.database, gameId);
    expect(mares).toHaveLength(3);
  });

  it('已在圈的馬再次出現時略過，不重複匯入（CAND-03）', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await run(context, UNASSIGNED, { selectedLineNumbers: [2, 3] });

    // 換一個時點重新匯同一份檔案：前兩筆已在圈，其餘照樣可套用。
    const handler = candidateImportHandler(UNASSIGNED);
    const again = await prepareImport(context, handler, source(), {
      ...CHOICE,
      timing: { month: 10, week: 1 },
    });
    expect(again.summary).toEqual({ apply: 28, skip: 2, review: 0, warn: 0, error: 0 });
    const skipped = again.rows.filter((row: CandidateRow) => row.outcome === 'skip');
    expect(skipped.map((row) => row.issues[0]?.code)).toEqual(['alreadyInHerd', 'alreadyInHerd']);

    await applyImport(context, handler, again);
    expect(await listMares(context.database, gameId)).toHaveLength(30);
  });

  it('原牧場只記為來源，據點由使用者選（CAND-04）', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await run(
      context,
      { group: undefined, site: 34, origin: 'marketMixed' },
      {
        selectedLineNumbers: [2],
      },
    );

    const [mare] = await listMares(context.database, gameId);
    expect(mare?.site).toBe(34);
    // 樣本第一筆的牧場是 60。
    expect(mare?.originNote).toBe('候選 TXT 原牧場 60');
    expect(mare?.origin).toBe('marketMixed');
  });

  it('候選匯入不建立檢查點，也不算年度總表（CAND-05）', async () => {
    const context = await openContext();
    await setUp(context);
    const { prepared, result } = await run(context, UNASSIGNED, { selectedLineNumbers: [2] });

    expect(prepared.createsCheckpoint).toBe(false);
    expect(result.checkpointId).toBeUndefined();
    expect(await listGameCheckpoints(context)).toHaveLength(0);
  });

  it('指定母馬群時記為替代第 q 系 N 代，未指定時為待指定用途（MARE-05）', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await run(
      context,
      { group: { position: 3, generation: 6 }, site: 33, origin: 'marketReplenish' },
      { selectedLineNumbers: [2] },
    );
    const [assigned] = await listMares(context.database, gameId);
    expect(assigned?.group).toEqual({ kind: 'substitute', position: 3, generation: 6 });
    expect(assigned?.origin).toBe('marketReplenish');

    const otherGame = await createGame(context, { name: '第二局', startYear: 1968 });
    await switchGame(context, otherGame.id);
    await run(context, UNASSIGNED, { selectedLineNumbers: [2] });
    const [unassigned] = await listMares(context.database, otherGame.id);
    expect(unassigned?.group).toEqual({ kind: 'unassigned' });
  });

  it('父馬、母馬、父系與牝系立即保存，父系去掉結尾「系」（MARE-21、IMP-17）', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    await run(context, UNASSIGNED, { selectedLineNumbers: [2, 3] });

    const horses = await horsesByName(context, gameId);
    const first = horses.get('(外)テスト候補001');
    expect(first).toMatchObject({
      sex: 'female',
      baseName: 'テスト候補001',
      sireName: 'テストウマ001',
      sireSubsystem: 'エクリプス',
      damName: 'テストメス910',
    });
    // 牝系欄空白視為未取得，不寫成「不屬於具名牝系」。
    expect(first?.femaleLine).toBeUndefined();
    expect(horses.get('テスト候補002')?.femaleLine).toBe('テスト牝系1');
    // 繁殖牝馬馬番号記在歷程（需求規格 6.4）。
    expect(first?.stageNumbers).toEqual([
      { stage: 'broodmare', number: 0x6000, gameYear: 1968, source: 'candidateFile' },
    ]);
  });

  it('檔案內能力番号重複時整份拒絕（需求規格 11.7、ID-06）', async () => {
    const context = await openContext();
    const gameId = await setUp(context);
    const [first, second, ...rest] = SAMPLE.rows;
    if (first === undefined || second === undefined) {
      throw new Error('樣本資料不足');
    }
    const broken: SyntheticSample = {
      ...SAMPLE,
      rows: [first, { ...second, abilityNo: first.abilityNo ?? '' }, ...rest],
    };

    await expect(
      prepareImport(context, candidateImportHandler(UNASSIGNED), source(broken), CHOICE),
    ).rejects.toMatchObject({ code: 'importHalted' });
    expect(await listMares(context.database, gameId)).toHaveLength(0);
  });
});
